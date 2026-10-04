/** Shared outcome vocabulary for workspace operations exposed over CLI and MCP. */
export type OperationOutcome<T> =
  | { status: "success"; value: T }
  | { status: "no_matches"; message: string }
  | { status: "output_limit_exceeded"; message: string }
  | { status: "engine_failure"; message: string };

export function getOutcomeText(outcome: OperationOutcome<string>): string {
  return outcome.status === "success" ? outcome.value : outcome.message;
}
