import fs from "fs-extra";
import ignore from "ignore";
import path from "node:path";
import {
  admitBatchMetadata,
  allocateFairBatch,
  type BatchOperandOutcome,
  type BatchOperandStatus,
} from "../../core/batch-planning";
import { getIgnorePatterns } from "../../core/config";
import { getTokenCount } from "../../utils/read-utils";
import { isWhitelisted, validateReadPathAccess } from "../../utils/security";
import {
  isPathWithin,
  resolveWorkspace,
  type ResolvedWorkspace,
  type WorkspaceContext,
} from "../../utils/workspace";
import { filterEligibleFindEntries } from "./proxy-find-disclosure";
import { redactSecrets } from "./proxy-secret-redaction";
import {
  parseFindBatch,
  type FindPredicates,
  type ParsedFindBatch,
} from "./proxy-find-batch-parser";

export type FindBatchMeasure = (text: string, isError: boolean) => number;
/**
 * Measure the complete UTF-8 response serialization. The serializer must put
 * `text` exactly once in its fixed response body and escape it character by
 * character (the supported CLI formatter and MCP JSON envelope satisfy this).
 */
export type FindBatchMetadataMeasure = (
  text: string,
  isError: boolean,
) => number;
export type FindBatchBackend = (
  root: string,
  predicateArgs: readonly string[],
) => Promise<{ stdout: string; exitCode: number }>;

export interface FindMinimumAllowance {
  tokens: number;
  message: string;
}

export interface FindValidationFailure extends FindMinimumAllowance {
  fitsDefault: boolean;
  validationMessage: string;
  diagnostic: string;
}

const SAFE_FIND_VALIDATION_MESSAGES = new Set([
  "usage_error: invalid find argument.",
  "usage_error: unsupported option '--spekta-force'.",
  "usage_error: unsupported find token; unsupported find root syntax.",
  "usage_error: find roots must precede predicates.",
  "usage_error: duplicate find -type predicate.",
  "usage_error: find -type requires exactly 'f' or 'd'.",
  "usage_error: duplicate find -name predicate.",
  "usage_error: find -name requires a nonempty pattern.",
  "usage_error: unsupported find token: only one terminal -print action is supported.",
  "usage_error: unsupported find token, expression, or action.",
  "Execution refused: unsupported option '--spekta-force'.",
]);

/** Return only parser-owned static diagnostics; never forward arbitrary errors. */
export function getSafeFindValidationMessage(error: unknown): string {
  if (
    error instanceof Error &&
    error.message === "usage_error: unsupported option '--spekta-force'."
  )
    return "Execution refused: unsupported option '--spekta-force'.";
  if (
    error instanceof Error &&
    SAFE_FIND_VALIDATION_MESSAGES.has(error.message)
  )
    return error.message;
  return "usage_error: Invalid find request.";
}

/** Compute the smallest allowance that fits this complete transport error. */
export function getFindMinimumAllowance(
  measure: FindBatchMeasure,
  ceiling: number,
): FindMinimumAllowance {
  const messageAt = (tokens: number) =>
    `usage_error: Find needs at least ${tokens} tokens; configured ceiling is ${ceiling} tokens.`;
  let upper = Math.max(1, measure(messageAt(1), true));
  for (;;) {
    const measured = measure(messageAt(upper), true);
    if (measured <= upper) break;
    upper = measured;
  }
  for (let tokens = 1; tokens <= upper; tokens++) {
    const message = messageAt(tokens);
    if (measure(message, true) <= tokens) return { tokens, message };
  }
  return { tokens: upper, message: messageAt(upper) };
}

function shortProblemMessage(message: string): string {
  if (message.includes("accepts one leading --allowance"))
    return "usage_error: Find requires one leading --allowance value.";
  if (message.includes("unsupported find token"))
    return "usage_error: Unsupported find syntax.";
  if (message.includes("unsupported option"))
    return "usage_error: Unsupported find option.";
  if (message.includes("roots must precede predicates"))
    return "usage_error: Find roots must precede predicates.";
  if (message.includes("duplicate find"))
    return "usage_error: Duplicate find predicate.";
  if (message.includes("find -type"))
    return "usage_error: Invalid find -type predicate.";
  if (message.includes("find -name"))
    return "usage_error: Invalid find -name predicate.";
  if (message.includes("Allowance"))
    return "usage_error: Invalid find allowance.";
  return "usage_error: Invalid find request.";
}

export function getFindValidationFailure(
  measure: FindBatchMeasure,
  ceiling: number,
  defaultAllowance: number,
  requestIdRecoveryHint?: string,
  problemMessage?: string,
): FindValidationFailure {
  const minimum = getFindMinimumAllowance(measure, ceiling);
  const problemFits =
    problemMessage !== undefined &&
    measure(problemMessage, true) <= defaultAllowance;
  const shortMessage =
    problemMessage === undefined
      ? undefined
      : shortProblemMessage(problemMessage);
  const shortMessageFits =
    shortMessage !== undefined &&
    measure(shortMessage, true) <= defaultAllowance;
  const minimumFits = measure(minimum.message, true) <= defaultAllowance;
  const fitsDefault = problemFits || shortMessageFits || minimumFits;
  const recovery =
    minimum.tokens > ceiling
      ? `raise SPEKTA_LIST_TOKEN_LIMIT and SPEKTA_LIST_TOKEN_CEILING to at least ${minimum.tokens}`
      : `raise SPEKTA_LIST_TOKEN_LIMIT to at least ${minimum.tokens}`;
  return {
    ...minimum,
    fitsDefault,
    validationMessage: problemFits
      ? (problemMessage ?? minimum.message)
      : shortMessageFits
        ? (shortMessage ?? minimum.message)
        : minimum.message,
    diagnostic: `usage_error: ${recovery}${requestIdRecoveryHint ? `; ${requestIdRecoveryHint}` : ""}.`,
  };
}

/** Select the ordinary default-budget error or its approved mandatory exception. */
export function getFindValidationText(failure: FindValidationFailure): string {
  return failure.fitsDefault ? failure.validationMessage : failure.diagnostic;
}

export interface FindBatchOptions {
  allowance: number;
  /** Configured default used only for request-wide validation errors. */
  validationAllowance?: number;
  /** Configured list ceiling included in minimum-allowance guidance. */
  maximumAllowance?: number;
  /** Optional transport-specific validation recovery, used for long MCP IDs. */
  requestIdRecoveryHint?: string;
  /** Empty at the configured ceiling; otherwise bounded configured recovery text. */
  increaseHint?: string;
  measure: FindBatchMeasure;
  /**
   * UTF-8 bytes of the complete rendered transport response for `text`.
   * The transport must insert `text` once into a fixed envelope and escape it
   * with JSON serialization or the CLI's fixed formatter.
   */
  metadataBytes: FindBatchMetadataMeasure;
  backend: FindBatchBackend;
  hasRtk: boolean;
}
export interface FindBatchResult {
  status:
    | "success"
    | "partial_result"
    | "usage_error"
    | "engine_failure"
    | "output_limit_exceeded";
  content: string;
  operands: BatchOperandOutcome[];
  isError: boolean;
}
interface Slot {
  root: string;
  position: number;
  state: BatchOperandStatus;
  eligible: boolean;
  paths: string[];
}
const EMPTY = "No eligible paths in this discovery.\n";
const FAILURE = "internal_failure; discovery failed";
const quote = (value: string) =>
  JSON.stringify(redactSecrets(value)).replace(/`/g, "\\u0060");

function boundedFailure(
  status: FindBatchResult["status"],
  message: string,
  fallback: string,
  allowance: number,
  measure: FindBatchMeasure,
): FindBatchResult {
  const validBudget = Number.isSafeInteger(allowance) && allowance > 0;
  const content = validBudget
    ? ([
        message,
        fallback,
        ...(status === "output_limit_exceeded"
          ? ["output_limit_exceeded\n"]
          : []),
        "",
      ].find((candidate) => measure(candidate, true) <= allowance) ?? "")
    : "";
  return { status, content, operands: [], isError: true };
}

async function rootEligible(
  root: string,
  workspace: ResolvedWorkspace,
): Promise<boolean> {
  try {
    // Validate access independently and recheck canonical access before enumeration.
    const canonical = await validateReadPathAccess(root, workspace);
    if (
      !(await fs.stat(canonical)).isDirectory() ||
      !isPathWithin(workspace.canonicalRoot, canonical)
    )
      return false;
    const patterns = await getIgnorePatterns(workspace.canonicalRoot);
    const rel = path
      .relative(workspace.canonicalRoot, canonical)
      .split(path.sep)
      .join("/");
    if (
      rel &&
      patterns.length &&
      ignore().add(patterns).ignores(`${rel}/`) &&
      !isWhitelisted(rel, patterns)
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

function render(
  slots: Slot[],
  counts: readonly number[],
  increaseHint: string,
): { text: string; statuses: BatchOperandOutcome[] } {
  const incomplete = slots.some(
    (s, i) =>
      s.state === "incomplete" ||
      (s.state === "returned" && counts[i] < s.paths.length),
  );
  const partial = incomplete || slots.some((s) => s.state !== "returned");
  const rows = slots
    .map((slot, i) => {
      const status =
        slot.state === "returned" && counts[i] < slot.paths.length
          ? "incomplete"
          : slot.state;
      const suffix: Record<BatchOperandStatus, string> = {
        returned: "returned",
        incomplete: "incomplete; output_limit_exceeded",
        unavailable: "unavailable; unavailable_access",
        budget_limited: "incomplete; output_limit_exceeded",
        unattempted: "unattempted; discovery not attempted",
        version_mismatch: "internal_failure",
        internal_failure: FAILURE,
      };
      const label = status === "unavailable" ? "" : `; ${quote(slot.root)}`;
      let body = `Operand ${slot.position}: ${suffix[status]}${label}\n`;
      if (slot.state === "returned")
        body += slot.paths.length
          ? slot.paths.slice(0, counts[i]).map(quote).join("\n") +
            (counts[i] ? "\n" : "")
          : EMPTY;
      if (status === "incomplete") {
        body += `  Narrow this root${increaseHint ? " or request a larger allowance" : ""}.${increaseHint}\n`;
      }
      return body;
    })
    .join("");
  return {
    text: `Batch: ${partial ? "partial_result" : "success"}\n${rows}`,
    statuses: slots.map((s, i) => ({
      position: s.position,
      status:
        s.state === "returned" && counts[i] < s.paths.length
          ? "incomplete"
          : s.state,
    })),
  };
}

/** Execute a parsed multi-root discovery batch. Backend and complete-response measurement are injected for adapters. */
export async function discoverFindBatch(
  args: readonly string[],
  context: WorkspaceContext | undefined,
  options: FindBatchOptions,
): Promise<FindBatchResult> {
  const validationAllowance = options.validationAllowance ?? options.allowance;
  const validation = getFindValidationFailure(
    options.measure,
    options.maximumAllowance ?? 8000,
    validationAllowance,
    options.requestIdRecoveryHint,
  );
  const validationFailure = (): FindBatchResult => ({
    status: "usage_error",
    content: getFindValidationText(validation),
    operands: [],
    isError: true,
  });
  let parsed: ParsedFindBatch;
  try {
    parsed = parseFindBatch(args);
  } catch (error: unknown) {
    // Syntax diagnostics are request-wide and use the configured default,
    // never the rejected request's allowance. The minimum itself is measured
    // using this adapter's complete error response serializer.
    const failure = getFindValidationFailure(
      options.measure,
      options.maximumAllowance ?? 8000,
      validationAllowance,
      options.requestIdRecoveryHint,
      getSafeFindValidationMessage(error),
    );
    return {
      status: "usage_error",
      content: getFindValidationText(failure),
      operands: [],
      isError: true,
    };
  }
  if (!Number.isSafeInteger(options.allowance) || options.allowance <= 0)
    return validationFailure();
  if (options.allowance < validation.tokens) return validationFailure();
  if (!options.hasRtk)
    return boundedFailure(
      "engine_failure",
      "engine_failure: RTK is unavailable",
      "internal_failure: Discovery engine unavailable.",
      options.allowance,
      options.measure,
    );
  let workspace: ResolvedWorkspace;
  try {
    workspace = await resolveWorkspace(context);
  } catch {
    return boundedFailure(
      "engine_failure",
      "engine_failure: workspace unavailable",
      "internal_failure: Workspace unavailable.",
      options.allowance,
      options.measure,
    );
  }

  const slots: Slot[] = parsed.roots.map((root, i) => ({
    root,
    position: i + 1,
    state: "unavailable",
    eligible: false,
    paths: [],
  }));
  for (const slot of slots)
    slot.eligible = await rootEligible(slot.root, workspace);
  // Reserve every possible outcome and recovery row before invoking any backend.
  const unavailableRow = (position: number) =>
    `Operand ${position}: unavailable; unavailable_access\n`;
  const candidatesBySlot = slots.map((slot) => {
    // An unavailable root is intentionally represented only by its ordinal.
    // Never serialize or measure its operand while planning admission.
    if (!slot.eligible) return [unavailableRow(slot.position)];
    const label = quote(slot.root);
    return [
      unavailableRow(slot.position),
      `Operand ${slot.position}: internal_failure; discovery failed; ${label}\n`,
      `Operand ${slot.position}: incomplete; output_limit_exceeded; ${label}\n  Narrow this root${options.increaseHint ? " or request a larger allowance" : ""}.${options.increaseHint ?? ""}\n`,
      `Operand ${slot.position}: returned; ${label}\n${EMPTY}`,
    ];
  });
  const reserveHeader = "Batch: partial_result\n";
  // Both supported serializers insert the body once: MCP JSON-escapes one
  // text field, while CLI formatting wraps and redacts that same field. JSON
  // string escaping is character-wise additive; CLI pieces are safe rendered
  // rows (labels are redacted before quoting and all other text is fixed), so
  // secret redaction cannot match across a row boundary. Sum each component's
  // measured serialized-byte delta independently. Taking the maximum per row
  // across both error states and the larger empty envelope bounds every
  // cross-root combination, including the error badge / isError transition.
  const states = [true, false] as const;
  const serializedDelta = (text: string, isError: boolean) =>
    Math.max(
      0,
      options.metadataBytes(text, isError) - options.metadataBytes("", isError),
    );
  const responseEnvelopeBytes = Math.max(
    ...states.map((isError) => options.metadataBytes("", isError)),
  );
  const headerBytes = Math.max(
    ...states.map((isError) => serializedDelta(reserveHeader, isError)),
  );
  const rowBytes = candidatesBySlot.reduce(
    (total, candidates) =>
      total +
      Math.max(
        ...candidates.map((row) =>
          Math.max(...states.map((isError) => serializedDelta(row, isError))),
        ),
      ),
    0,
  );
  const metadataByteBound = responseEnvelopeBytes + headerBytes + rowBytes;
  if (!admitBatchMetadata(metadataByteBound, options.allowance)) {
    const fallback = `output_limit_exceeded: split discovery roots${options.increaseHint ? " or increase the allowance" : ""}.${options.increaseHint ?? ""}\n`;
    return boundedFailure(
      "output_limit_exceeded",
      fallback,
      "output_limit_exceeded: Split the discovery roots.\n",
      options.allowance,
      options.measure,
    );
  }
  for (const slot of slots) {
    if (!slot.eligible || !(await rootEligible(slot.root, workspace))) {
      slot.state = "unavailable";
      continue;
    }
    try {
      const result = await options.backend(slot.root, parsed.predicates.args);
      if (result.exitCode !== 0) {
        slot.state = "internal_failure";
        continue;
      }
      const attributedStdout = result.stdout
        .split("\n")
        .map((entry) =>
          path.isAbsolute(entry) && isPathWithin(workspace.root, entry)
            ? path.relative(workspace.root, entry).split(path.sep).join("/")
            : entry,
        )
        .join("\n");
      const filtered = await filterEligibleFindEntries(
        attributedStdout,
        slot.root,
        workspace,
      );
      if (filtered.status !== "success") {
        slot.state = "internal_failure";
        continue;
      }
      slot.paths = filtered.names.map(
        (entry) =>
          path
            .relative(workspace.root, path.resolve(workspace.root, entry))
            .split(path.sep)
            .join("/") || ".",
      );
      slot.state = "returned";
    } catch {
      slot.state = "internal_failure";
    }
  }
  const totals = slots.map((s) =>
    s.state === "returned" ? s.paths.length : 0,
  );
  const counts = allocateFairBatch(
    totals,
    (position, count) =>
      getTokenCount(`${quote(slots[position].paths[count - 1])}\n`),
    (candidate) =>
      options.measure(
        render(slots, candidate, options.increaseHint ?? "").text,
        render(slots, candidate, options.increaseHint ?? "").statuses.some(
          (x) => x.status !== "returned",
        ),
      ) <= options.allowance,
  );
  let output = render(slots, counts, options.increaseHint ?? "");
  while (
    options.measure(
      output.text,
      output.statuses.some((x) => x.status !== "returned"),
    ) > options.allowance
  ) {
    const index = counts.findIndex((count) => count > 0);
    if (index < 0) break;
    counts[index]--;
    output = render(slots, counts, options.increaseHint ?? "");
  }
  // Admission reserved every zero-content state, so reaching this branch
  // would mean a broken adapter measurement contract. Keep operand outcomes
  // intact rather than replacing them with one request-wide failure.
  return {
    status: output.statuses.every((x) => x.status === "returned")
      ? "success"
      : "partial_result",
    content: output.text,
    operands: output.statuses,
    isError: output.statuses.some((x) => x.status !== "returned"),
  };
}

export type { FindPredicates };
