import fs from "fs-extra";
import ignore from "ignore";
import { execa } from "execa";
import path from "node:path";
import {
  admitBatchMetadata,
  allocateFairBatch,
  type BatchOperandOutcome,
  type BatchOperandStatus,
} from "../../core/batch-planning";
import {
  resolveAllowanceSettings,
  resolveRequestAllowance,
} from "../../core/config/allowance";
import type { FailureOutcome } from "../../core/operation-outcome";
import { getTokenCount } from "../../utils/read-utils";
import {
  resolveWorkspace,
  type ResolvedWorkspace,
  type WorkspaceContext,
} from "../../utils/workspace";
import { validateCommandArguments } from "./proxy-path-security";
import { filterEligibleLsEntries } from "./proxy-ls";
import { getIgnorePatterns } from "../../core/config";
import { isWhitelisted } from "../../utils/security";
import { formatProxyOutput } from "./proxy-output";
import { redactSecrets } from "./proxy-secret-redaction";

export interface ListBatchSuccess {
  status: "success" | "partial_result";
  content: string;
  truncated: boolean;
  operands: BatchOperandOutcome[];
}

export interface ListBatchFailure {
  status: "failure";
  message: string;
  exitCode: number;
  failure?: FailureOutcome;
}

export type ListBatchOutcome = ListBatchSuccess | ListBatchFailure;

export interface ListBatchOptions {
  allowance: number;
  increaseHint: string;
  runLs: (operand: string) => Promise<{ stdout: string; exitCode: number }>;
}

interface ListSlot {
  operand: string;
  position: number;
  status: BatchOperandStatus;
  available: boolean;
  names?: string[];
  entries?: string[];
}

const EMPTY_LISTING = "No eligible entries in this listing.";
const METADATA_REJECTION =
  "output_limit_exceeded: Batch outcome metadata exceeds the response budget. Split the batch into fewer directories.";

export class RtkListingUnavailableError extends Error {}

export function listAllowanceIncreaseHint(limit: number): string {
  const ceiling = resolveAllowanceSettings("list").ceilingTokens;
  return ceiling > limit
    ? ` A larger allowance up to ${ceiling} tokens is supported.`
    : "";
}

/** Reserve the CLI heading and truncation badge before budgeting the shared body. */
export function listContentAllowance(limit: number): number {
  const wrapper = formatProxyOutput("ls", "", { truncated: true });
  return Math.max(1, limit - getTokenCount(`${wrapper}\n`));
}

function quoteName(name: string): string {
  return JSON.stringify(name).replace(/`/g, "\\u0060");
}

function row(slot: ListSlot, status: BatchOperandStatus): string {
  if (status === "unavailable")
    return `Operand ${slot.position}: unavailable; unavailable_access\n`;
  if (status === "unattempted")
    return `Operand ${slot.position}: unattempted; workspace unavailable; retry in an available workspace\n`;
  if (status === "internal_failure")
    return `Operand ${slot.position}: internal_failure; listing failed\n`;
  const label = quoteName(slot.operand);
  if (status === "incomplete")
    return `Operand ${slot.position}: incomplete; output_limit_exceeded; ${label}\n`;
  return `Operand ${slot.position}: returned; ${label}\n`;
}

function render(
  slots: ListSlot[],
  counts: readonly number[],
  increaseHint: string,
): string {
  const incomplete = slots.some(
    (slot, index) =>
      slot.status === "returned" && counts[index] < (slot.entries?.length ?? 0),
  );
  const partial =
    incomplete || slots.some((slot) => slot.status !== "returned");
  const lines = slots.map((slot, index) => {
    const status =
      slot.status === "returned" && counts[index] < (slot.entries?.length ?? 0)
        ? "incomplete"
        : slot.status;
    let output = row(slot, status);
    if (slot.status === "returned") {
      const entries = slot.entries ?? [];
      output +=
        entries.length === 0
          ? `${EMPTY_LISTING}\n`
          : entries.slice(0, counts[index]).join("\n") +
            (counts[index] > 0 ? "\n" : "");
    }
    return output;
  });
  if (incomplete) {
    lines.push(
      `Listing incomplete. List a narrower directory${increaseHint ? " or request a larger allowance" : ""}.${increaseHint}\n`,
    );
  }
  return `Batch: ${partial ? "partial_result" : "success"}\n` + lines.join("");
}

function reserveMetadata(slots: ListSlot[], increaseHint: string): string {
  const rows = slots
    .map((slot) => {
      const candidates: BatchOperandStatus[] = [
        "returned",
        "incomplete",
        "unavailable",
        "unattempted",
        "internal_failure",
      ];
      const longest = candidates
        .map((status) => row(slot, status))
        .sort((a, b) => Buffer.byteLength(b) - Buffer.byteLength(a))[0];
      return longest + (slot.available ? `${EMPTY_LISTING}\n` : "");
    })
    .join("");
  return (
    "Batch: partial_result\n" +
    rows +
    `Listing incomplete. List a narrower directory${increaseHint ? " or request a larger allowance" : ""}.${increaseHint}\n`
  );
}

async function resolveListDirectory(
  operand: string,
  workspace: ResolvedWorkspace,
  context: WorkspaceContext | undefined,
): Promise<boolean> {
  try {
    validateCommandArguments([operand], context);
    const target = path.resolve(workspace.root, operand);
    const canonical = await fs.realpath(target);
    const relative = path.relative(workspace.canonicalRoot, canonical);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      !(await fs.stat(canonical)).isDirectory()
    )
      return false;
    const relativeDirectory = path
      .relative(workspace.canonicalRoot, canonical)
      .split(path.sep)
      .join("/");
    const patterns = await getIgnorePatterns(workspace.canonicalRoot);
    const ignorePath = relativeDirectory ? `${relativeDirectory}/` : "";
    if (
      ignorePath &&
      patterns.length > 0 &&
      ignore().add(patterns).ignores(ignorePath) &&
      !isWhitelisted(relativeDirectory, patterns)
    )
      return false;
    if (ignorePath) {
      try {
        await execa("git", ["check-ignore", "-q", "--", ignorePath], {
          cwd: workspace.canonicalRoot,
        });
        if (!isWhitelisted(relativeDirectory, patterns)) return false;
      } catch {
        // A missing git executable or a non-ignored path does not deny access.
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function resolveListAllowance(raw: unknown): {
  allowance?: number;
  failure?: FailureOutcome;
} {
  const result = resolveRequestAllowance("list", raw);
  if (result.status === "ok")
    return { allowance: result.requested ?? result.settings.defaultTokens };
  const ceiling = result.settings.ceilingTokens;
  return result.status === "over_ceiling"
    ? {
        failure: {
          status: "output_limit_exceeded",
          message: `output_limit_exceeded: Requested allowance ${result.requested} exceeds the configured ceiling of ${ceiling} tokens. Request ${ceiling} or fewer, or list fewer directories.`,
        },
      }
    : {
        failure: {
          status: "usage_error",
          message: `usage_error: Allowance must be a positive whole number of tokens no greater than ${ceiling}. Use spekta help ls.`,
        },
      };
}

export async function getListBatchOutcome(
  operands: string[],
  workspace: WorkspaceContext | undefined,
  options: ListBatchOptions,
): Promise<ListBatchOutcome> {
  const supplied = operands.length === 0 ? ["."] : operands;
  const slots: ListSlot[] = supplied.map((operand, index) => ({
    operand,
    position: index + 1,
    status: "unattempted",
    available: false,
  }));
  let resolved: ResolvedWorkspace | undefined;
  try {
    resolved = await resolveWorkspace(workspace);
  } catch {
    // All slots remain unattempted and are rendered without operand text.
  }
  if (resolved) {
    for (const slot of slots) {
      slot.available = await resolveListDirectory(
        slot.operand,
        resolved,
        workspace,
      );
      if (!slot.available) slot.status = "unavailable";
    }
  }

  if (
    !admitBatchMetadata(
      Buffer.byteLength(reserveMetadata(slots, options.increaseHint), "utf8"),
      options.allowance,
    )
  ) {
    const message = METADATA_REJECTION + options.increaseHint;
    return {
      status: "failure",
      message,
      exitCode: 1,
      failure: { status: "output_limit_exceeded", message },
    };
  }

  let attempted = 0;
  let missingRtk = false;
  if (resolved) {
    for (const slot of slots) {
      if (!slot.available) continue;
      attempted++;
      try {
        const result = await options.runLs(slot.operand);
        if (result.exitCode !== 0) {
          slot.status = "internal_failure";
          continue;
        }
        const filtered = await filterEligibleLsEntries(
          result.stdout,
          slot.operand,
          resolved,
        );
        if (filtered.status !== "success") {
          slot.status = "internal_failure";
          continue;
        }
        slot.names = filtered.names;
        slot.entries = filtered.names.map((name) =>
          redactSecrets(quoteName(name)),
        );
        slot.status = "returned";
      } catch (error: unknown) {
        if (error instanceof RtkListingUnavailableError) {
          attempted--;
          missingRtk = true;
        } else {
          slot.status = "internal_failure";
        }
      }
    }
  }

  if (attempted === 0 && (!resolved || missingRtk)) {
    return {
      status: "failure",
      message: "RTK listing failed before output could be checked.",
      exitCode: 1,
    };
  }

  const fits = (counts: readonly number[]) =>
    getTokenCount(render(slots, counts, options.increaseHint)) <=
    options.allowance;
  const counts = allocateFairBatch(
    slots.map((slot) => slot.entries?.length ?? 0),
    (position, count) =>
      getTokenCount(
        row(slots[position], "returned") +
          (slots[position].entries ?? []).slice(0, count).join("\n"),
      ),
    fits,
  );
  // Completing a listing removes its incomplete row and shared guidance. If
  // that reclaimed metadata makes the whole remaining listing fit, commit it
  // as one completion step after fair unit allocation reaches a fixed point.
  for (let changed = true; changed;) {
    changed = false;
    for (let position = 0; position < counts.length; position++) {
      const total = slots[position].entries?.length ?? 0;
      if (counts[position] >= total) continue;
      const completed = [...counts];
      completed[position] = total;
      if (fits(completed)) {
        counts[position] = total;
        changed = true;
      }
    }
  }
  const content = render(slots, counts, options.increaseHint);
  if (getTokenCount(content) > options.allowance) {
    const message = METADATA_REJECTION + options.increaseHint;
    return {
      status: "failure",
      message,
      exitCode: 1,
      failure: { status: "output_limit_exceeded", message },
    };
  }
  const outcomes = slots.map((slot, index) => ({
    position: slot.position,
    status:
      slot.status === "returned" && counts[index] < (slot.entries?.length ?? 0)
        ? ("incomplete" as const)
        : slot.status,
  }));
  const partial = outcomes.some((operand) => operand.status !== "returned");
  return {
    status: partial ? "partial_result" : "success",
    content,
    truncated: outcomes.some((operand) => operand.status === "incomplete"),
    operands: outcomes,
  };
}
