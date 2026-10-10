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

interface BatchSlot {
  request: FileRequest;
  position: number;
  status: BatchOperandStatus;
  readPath?: string;
  data?: VersionedFileLines;
  costs?: number[];
}

interface ReadBatchOptions {
  budget: number;
  measure: (text: string, isError: boolean) => number;
  metadataBytes: (text: string) => number;
  failure: (message: string) => FailureOutcome;
  increaseHint: string;
}

const MAX_NUMBER = Number.MAX_SAFE_INTEGER;
const RESERVED_VERSION = `v1-${"x".repeat(43)}`;

function statusFor(slot: BatchSlot, count: number): BatchOperandStatus {
  if (!slot.data) return slot.status;
  if (count === slot.data.lines.length) return "returned";
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

  const status = reserve ? "budget_limited" : statusFor(slot, count);
  const total = reserve ? MAX_NUMBER : slot.data!.total;
  const rangeStart = reserve ? MAX_NUMBER : start;
  const rangeEnd = reserve ? MAX_NUMBER : start + count - 1;
  const version = reserve ? RESERVED_VERSION : slot.data!.version;
  const incomplete = reserve || count < slot.data!.lines.length;
  const empty = !reserve && count === 0;
  const coverage = empty
    ? `no lines; total ${total}`
    : `lines ${rangeStart}-${rangeEnd} of ${total}`;
  const extension = request.path.split(".").pop() || "txt";
  const content = reserve ? "" : slot.data!.lines.slice(0, count).join("\n");
  const originalEnd = request.range?.end ?? "$";

  let output =
    renderOutcomeRow(slot.position, status, reserve ? MAX_NUMBER : start) +
    `#### ${request.path} (${coverage}) [Version: ${version}]\n` +
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
      "Recovery: Split the batch; continue each Next range separately." +
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
      slot.data = data;
      const costs = [0];
      for (const line of data.lines)
        costs.push(
          costs[costs.length - 1] + Math.max(1, getTokenCount(`${line}\n`)),
        );
      slot.costs = costs;
    } catch {
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
    slots.map((slot) => slot.data?.lines.length ?? 0),
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
