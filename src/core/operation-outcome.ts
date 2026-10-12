import type { BatchOperandOutcome } from "./batch-planning";

/** Shared outcome vocabulary for workspace operations exposed over CLI and MCP. */
export type OperationOutcome<T> =
  | { status: "success"; value: T }
  | { status: "partial_result"; value: T; operands: BatchOperandOutcome[] }
  | { status: "usage_error"; message: string }
  | { status: "version_mismatch"; message: string }
  | {
      status: "policy_rejection";
      message: string;
      operands?: BatchOperandOutcome[];
    }
  | { status: "no_matches"; message: string }
  | {
      status: "output_limit_exceeded";
      message: string;
      operands?: BatchOperandOutcome[];
    }
  | { status: "engine_failure"; message: string };

export type FailureOutcome = Exclude<
  OperationOutcome<string>,
  { status: "success" | "partial_result"; value: string }
>;

export function boundFailureOutcome(
  status: FailureOutcome["status"],
  message: string,
  fallback: string,
  budget: number,
  measure: (candidate: string) => number,
): FailureOutcome {
  const bounded = [message, fallback, ""].find(
    (candidate) => measure(candidate) <= budget,
  );
  return { status, message: bounded ?? "" };
}

export function getOutcomeText(outcome: OperationOutcome<string>): string {
  return outcome.status === "success" || outcome.status === "partial_result"
    ? outcome.value
    : outcome.message;
}
