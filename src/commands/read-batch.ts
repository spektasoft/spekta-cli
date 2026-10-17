import {
  admitBatchMetadata,
  allocateFairBatch,
  type BatchOperandOutcome,
  type BatchOperandStatus,
} from "../core/batch-planning";
import type {
  FailureOutcome,
  OperationOutcome,
} from "../core/operation-outcome";
import {
  getTokenCount,
  getVersionedFileLines,
  type FileRequest,
  type VersionedFileLines,
} from "../utils/read-utils";
import { validateReadPathAccess } from "../utils/security";
import {
  resolveWorkspace,
  type ResolvedWorkspace,
  type WorkspaceContext,
} from "../utils/workspace";
import { compactFile } from "../utils/compactor";

interface BatchSlot {
  request: FileRequest;
  position: number;
  status: BatchOperandStatus;
  readPath?: string;
  data?: VersionedFileLines;
  costs?: number[];
  overviewContent?: string;
  overview: boolean;
}

interface ReadBatchOptions {
  budget: number;
  measure: (text: string, isError: boolean) => number;
  metadataBytes: (text: string) => number;
  failure: (message: string) => FailureOutcome;
  increaseHint: string;
  overview: boolean;
}

const MAX_NUMBER = Number.MAX_SAFE_INTEGER;
const RESERVED_VERSION = `v1-${"x".repeat(43)}`;

function statusFor(slot: BatchSlot, count: number): BatchOperandStatus {
  if (!slot.data) return slot.status;
  if (
    count === (slot.overviewContent !== undefined ? 1 : slot.data.lines.length)
  )
    return "returned";
  return count === 0 ? "budget_limited" : "incomplete";
}

function renderOutcomeRow(
  position: number,
  status: BatchOperandStatus,
  line: number,
): string {
  const details: Record<BatchOperandStatus, string> = {
    returned: "",
    incomplete: "; output_limit_exceeded",
    unavailable: "; unavailable_access",
    budget_limited: `; output_limit_exceeded; line ${line} withheld`,
    unattempted: "; workspace unavailable; retry in an available workspace",
    version_mismatch: "; restart the original range without expected version",
    internal_failure: "; internal_failure",
  };
  return `Operand ${position}: ${status}${details[status]}\n`;
}

function renderSlot(slot: BatchSlot, count: number, reserve = false): string {
  const request = slot.request;
  const start = request.range?.start ?? 1;

  if (!slot.data && !(reserve && slot.readPath)) {
    if (!reserve) return renderOutcomeRow(slot.position, slot.status, start);
    return [
      "unavailable",
      "unattempted",
      "version_mismatch",
      "internal_failure",
    ]
      .map((status) =>
        renderOutcomeRow(
          slot.position,
          status as BatchOperandStatus,
          MAX_NUMBER,
        ),
      )
      .sort(
        (left, right) => Buffer.byteLength(right) - Buffer.byteLength(left),
      )[0];
  }

  if (reserve && slot.overview && slot.readPath) {
    const extension = request.path.split(".").pop() || "txt";
    const originalRange = `Original range: ${request.path}[1,$]\n`;
    const structural =
      `Operand ${slot.position}: budget_limited; output_limit_exceeded; overview withheld\n` +
      `#### ${request.path} (structural overview; original file ${MAX_NUMBER} lines) [STRUCTURAL OVERVIEW] [Version: ${RESERVED_VERSION}]\n` +
      "This overview omits original content; collapsed markers identify omitted source evidence. Request original line ranges to inspect it.\n" +
      `\`\`\`${extension}\n\n\`\`\`\n` +
      originalRange;
    const fallback =
      renderOutcomeRow(slot.position, "budget_limited", MAX_NUMBER) +
      `#### ${request.path} (original content; lines 1-${MAX_NUMBER} of ${MAX_NUMBER}) [ORIGINAL CONTENT FALLBACK] [Version: ${RESERVED_VERSION}]\n` +
      "No structural overview was available; original content uses normal chunking.\n" +
      `\`\`\`${extension}\n\n\`\`\`\n` +
      originalRange +
      `Next range: ${request.path}[${MAX_NUMBER},${MAX_NUMBER}]; use Version as expected version\n`;
    return Buffer.byteLength(structural) >= Buffer.byteLength(fallback)
      ? structural
      : fallback;
  }

  const status = reserve ? "budget_limited" : statusFor(slot, count);
  const total = reserve ? MAX_NUMBER : slot.data!.total;
  const rangeStart = reserve ? MAX_NUMBER : start;
  const rangeEnd = reserve ? MAX_NUMBER : start + count - 1;
  const version = reserve ? RESERVED_VERSION : slot.data!.version;
  const incomplete =
    reserve ||
    (slot.overviewContent === undefined && count < slot.data!.lines.length);
  const empty = !reserve && count === 0;
  const coverage = empty
    ? `no lines; total ${total}`
    : `lines ${rangeStart}-${rangeEnd} of ${total}`;
  const extension = request.path.split(".").pop() || "txt";
  const content =
    reserve || count === 0
      ? ""
      : (slot.overviewContent ?? slot.data!.lines.slice(0, count).join("\n"));
  const originalEnd = request.range?.end ?? "$";
  const structural = !reserve && slot.overviewContent !== undefined;
  const deliveredStructural = structural && count > 0;
  const row =
    structural && count === 0
      ? `Operand ${slot.position}: budget_limited; output_limit_exceeded; overview withheld\n`
      : renderOutcomeRow(slot.position, status, reserve ? MAX_NUMBER : start);

  let output =
    row +
    `#### ${request.path} (${deliveredStructural ? `structural overview; original file ${total} lines` : structural ? `overview withheld; original file ${total} lines` : slot.overview ? coverage.replace(/^lines /, "original content; lines ") : coverage})${slot.overview ? (deliveredStructural ? " [STRUCTURAL OVERVIEW]" : structural ? " [OVERVIEW WITHHELD]" : " [ORIGINAL CONTENT FALLBACK]") : ""} [Version: ${version}]\n` +
    (structural
      ? count === 0
        ? "This overview was withheld as an indivisible unit; increase the allowance or omit --overview and request original ranges.\n"
        : "This overview omits original content; collapsed markers identify omitted source evidence. Request original line ranges to inspect it.\n"
      : slot.overview
        ? "No structural overview was available; original content uses normal chunking.\n"
        : "") +
    `\`\`\`${extension}\n${content}\n\`\`\`\n` +
    `Original range: ${request.path}[${start},${originalEnd}]\n`;

  if (incomplete) {
    const nextStart = reserve ? MAX_NUMBER : start + count;
    const nextEnd = reserve ? MAX_NUMBER : start + slot.data!.lines.length - 1;
    output +=
      `Next range: ${request.path}[${nextStart},${nextEnd}]; ` +
      "use Version as expected version\n";
  }
  return `${output}\n`;
}

function renderBatch(
  slots: readonly BatchSlot[],
  counts: readonly number[],
  increaseHint: string,
  reserve = false,
): string {
  const partial =
    reserve ||
    slots.some(
      (slot, position) => statusFor(slot, counts[position]) !== "returned",
    );
  const prefix = partial
    ? "Batch: partial_result\n" +
      (slots.some(
        (slot, position) =>
          slot.overviewContent !== undefined && counts[position] === 0,
      )
        ? "Recovery: Increase the allowance for withheld overviews or omit --overview and use targeted original ranges."
        : "Recovery: Split the batch; continue each Next range separately.") +
      increaseHint +
      "\n"
    : "Batch: success\n";
  return (
    prefix +
    slots
      .map((slot, position) => renderSlot(slot, counts[position], reserve))
      .join("")
  );
}

function outcomes(
  slots: readonly BatchSlot[],
  counts: readonly number[],
): BatchOperandOutcome[] {
  return slots.map((slot, position) => ({
    position: slot.position,
    status: statusFor(slot, counts[position]),
  }));
}

export async function getReadBatchOutcome(
  requests: FileRequest[],
  workspace: WorkspaceContext | undefined,
  options: ReadBatchOptions,
): Promise<OperationOutcome<string>> {
  const slots: BatchSlot[] = requests.map((request, position) => ({
    request,
    position: position + 1,
    status: "unattempted",
    overview: options.overview,
  }));
  const zeros = slots.map(() => 0);
  const rejectMetadata = () =>
    options.failure(
      "output_limit_exceeded: Batch outcome metadata exceeds the response budget. " +
        "Split the batch into fewer operands." +
        options.increaseHint,
    );

  let resolvedWorkspace: ResolvedWorkspace;
  try {
    resolvedWorkspace = await resolveWorkspace(workspace);
  } catch {
    const text = renderBatch(slots, zeros, options.increaseHint);
    if (options.measure(text, true) > options.budget) return rejectMetadata();
    return {
      status: "partial_result",
      value: text,
      operands: outcomes(slots, zeros),
    };
  }

  for (const slot of slots) {
    try {
      slot.readPath = await validateReadPathAccess(
        slot.request.path,
        resolvedWorkspace,
      );
    } catch {
      slot.status = "unavailable";
    }
  }

  const reservation = renderBatch(slots, zeros, options.increaseHint, true);
  if (!admitBatchMetadata(options.metadataBytes(reservation), options.budget))
    return rejectMetadata();

  for (const slot of slots) {
    const readPath = slot.readPath;
    if (!readPath) continue;
    try {
      const data = await getVersionedFileLines(
        readPath,
        slot.request.range ?? { start: 1, end: "$" },
      );
      let currentPath: string;
      try {
        currentPath = await validateReadPathAccess(
          slot.request.path,
          resolvedWorkspace,
        );
      } catch {
        slot.status = "unavailable";
        continue;
      }
      if (currentPath !== readPath) {
        slot.status = "version_mismatch";
        continue;
      }
      let overviewContent: string | undefined;
      if (options.overview) {
        const compacted = compactFile(
          slot.request.path,
          data.fullLines.join("\n"),
        );
        if (compacted.isCompacted) overviewContent = compacted.content;
      }
      const costs = [0];
      if (overviewContent !== undefined)
        costs.push(Math.max(1, getTokenCount(overviewContent)));
      else
        for (const line of data.lines)
          costs.push(
            costs[costs.length - 1] + Math.max(1, getTokenCount(`${line}\n`)),
          );
      slot.data = data;
      slot.overviewContent = overviewContent;
      slot.costs = costs;
    } catch {
      slot.data = undefined;
      slot.overviewContent = undefined;
      slot.costs = undefined;
      try {
        const currentPath = await validateReadPathAccess(
          slot.request.path,
          resolvedWorkspace,
        );
        slot.status =
          currentPath === readPath ? "internal_failure" : "version_mismatch";
      } catch {
        slot.status = "unavailable";
      }
    }
  }

  const render = (counts: readonly number[]) =>
    renderBatch(slots, counts, options.increaseHint);
  if (options.measure(render(zeros), true) > options.budget)
    return rejectMetadata();

  const counts = allocateFairBatch(
    slots.map((slot) =>
      slot.data
        ? slot.overviewContent !== undefined
          ? 1
          : slot.data.lines.length
        : 0,
    ),
    (position, count) => slots[position].costs![count],
    (candidate) => {
      const partial = outcomes(slots, candidate).some(
        (operand) => operand.status !== "returned",
      );
      return options.measure(render(candidate), partial) <= options.budget;
    },
  );
  const operandOutcomes = outcomes(slots, counts);
  const text = render(counts);
  return operandOutcomes.every((operand) => operand.status === "returned")
    ? { status: "success", value: text }
    : { status: "partial_result", value: text, operands: operandOutcomes };
}
