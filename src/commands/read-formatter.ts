// File: src/commands/read-formatter.ts (NEW FILE)

const COMPACTION_ADVISORY = `
#### COMPACTION NOTICE

Parts of these files are collapsed. Line numbers in comments are **absolute**; do not use visual line counts for offsets.

**To expand:** Request specific line ranges (e.g., file.ts[20,60]). Targeted requests are never compacted.
`.trim();

export interface ReadOutputOptions {
  path: string;
  content: string;
  total: number;
  isRangeRequest: boolean;
  rangeStart?: number;
  rangeEnd?: number | "$";
  tokens: number;
  fullTokens: number;
  isCompacted?: boolean;
  overview?: boolean;
  exceedsLimit?: boolean;
  warning?: string;
  empty?: boolean;
  version?: string;
}

const formatNumber = (value: number): string => value.toLocaleString("en-US");

export function formatReadOutput(options: ReadOutputOptions): string {
  const {
    path,
    content,
    total,
    isRangeRequest,
    rangeStart,
    rangeEnd,
    tokens,
    fullTokens,
    isCompacted = false,
    overview = false,
    exceedsLimit = false,
    warning = "",
    empty = false,
    version,
  } = options;

  const extension = path.split(".").pop() || "txt";

  const rangeLabel =
    overview && isCompacted
      ? `structural overview; original file ${total} lines`
      : overview
        ? empty
          ? `original content; no lines; total ${total}`
          : `original content; lines ${rangeStart ?? 1}-${rangeEnd === "$" ? total : (rangeEnd ?? total)} of ${total}`
        : empty
          ? `no lines; total ${total}`
          : isRangeRequest
            ? `${rangeStart}-${rangeEnd === "$" ? total : rangeEnd} of ${total}`
            : `1-${total} (Full File)`;

  const tokenDetails = isCompacted
    ? ` [COMPACTED OVERVIEW: ${formatNumber(tokens)}/${formatNumber(fullTokens)} tokens]`
    : isRangeRequest
      ? ` [${formatNumber(tokens)}/${formatNumber(fullTokens)} tokens]`
      : ` [${formatNumber(tokens)} tokens]`;

  const exceedLabel = exceedsLimit ? " [EXCEEDS TOKEN LIMIT]" : "";
  const warningLabel = warning ? ` [${warning}]` : "";
  const overviewLabel = overview
    ? isCompacted
      ? " [STRUCTURAL OVERVIEW]"
      : " [ORIGINAL CONTENT FALLBACK]"
    : "";
  const versionLabel = version ? ` [Version: ${version}]` : "";

  const linePrefix = overview || empty ? "" : "lines ";
  const overviewNotice =
    overview && isCompacted
      ? "This overview omits original content; collapsed markers identify omitted source evidence. Request original line ranges to inspect it."
      : overview && !isCompacted
        ? "No structural overview was available for this file; returning original content with normal chunking."
        : "";
  return `#### ${path} (${linePrefix}${rangeLabel})${overviewLabel}${tokenDetails}${versionLabel}${exceedLabel}${warningLabel}${overviewNotice ? `\n${overviewNotice}` : ""}
\`\`\`${extension}
${content}
\`\`\`

`;
}

export function formatReadError(path: string, errorMessage: string): string {
  return `#### ${path} ERROR
Error: ${errorMessage}

`;
}

export function prependCompactionAdvisory(output: string): string {
  return `${COMPACTION_ADVISORY}

${output}`;
}
