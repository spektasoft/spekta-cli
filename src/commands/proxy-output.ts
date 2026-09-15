import { getTokenCount } from "../utils/read-utils";
import { redactSecrets } from "./proxy-security";

const MAX_OUTPUT_TOKENS = 1000;
const HEAD_RATIO = 0.2;
const COLLAPSE_NOTICE_TEMPLATE =
  "... [{lines} lines collapsed: exceeds 1000 tokens] ...";

function takeTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || !text) {
    return "";
  }

  const lines = text.split("\n");
  const selected: string[] = [];
  let remainingTokens = maxTokens;

  for (const line of lines) {
    const lineWithNewline = `${line}\n`;
    const lineTokens = getTokenCount(lineWithNewline);

    if (lineTokens <= remainingTokens) {
      selected.push(line);
      remainingTokens -= lineTokens;
      continue;
    }

    if (selected.length === 0 && remainingTokens > 0) {
      const words = line.split(/(\s+)/);
      let partial = "";

      for (const word of words) {
        const candidate = partial + word;
        if (getTokenCount(`${candidate}\n`) > remainingTokens) {
          break;
        }
        partial = candidate;
      }

      if (partial) {
        selected.push(partial);
      }
    }

    break;
  }

  return selected.join("\n");
}

function takeTailTokens(text: string, maxTokens: number): string {
  const reversed = text.split("\n").reverse().join("\n");
  return takeTokens(reversed, maxTokens).split("\n").reverse().join("\n");
}

function trimToTokenBudget(text: string, maxTokens: number): string {
  if (getTokenCount(text) <= maxTokens) {
    return text;
  }

  return takeTokens(text, maxTokens).trim();
}

export function truncateOutput(
  output: string,
  maxTokens = MAX_OUTPUT_TOKENS,
): { content: string; truncated: boolean } {
  if (maxTokens <= 0) {
    return { content: "", truncated: output.length > 0 };
  }

  if (getTokenCount(output) <= maxTokens) {
    return { content: output, truncated: false };
  }

  const lines = output.split("\n");
  const estimatedNotice = COLLAPSE_NOTICE_TEMPLATE.replace(
    "{lines}",
    String(Math.max(1, lines.length - 2)),
  );

  const noticeTokens = getTokenCount(estimatedNotice);
  const contentBudget = Math.max(1, maxTokens - noticeTokens);

  const headBudget = Math.min(
    Math.floor(contentBudget * HEAD_RATIO),
    contentBudget,
  );
  const tailBudget = Math.max(0, contentBudget - headBudget);

  const head = takeTokens(output, headBudget);
  const tail = takeTailTokens(output, tailBudget);

  const headLines = head ? head.split("\n").length : 0;
  const tailLines = tail ? tail.split("\n").length : 0;
  const remainingLines = Math.max(0, lines.length - headLines - tailLines);

  const notice = COLLAPSE_NOTICE_TEMPLATE.replace(
    "{lines}",
    String(remainingLines),
  );

  let content = [head, notice, tail].filter(Boolean).join("\n").trim();

  if (getTokenCount(content) > maxTokens) {
    content = trimToTokenBudget(content, maxTokens);
  }

  return { content, truncated: true };
}

export function formatProxyOutput(
  command: string,
  output: string,
  options: { truncated?: boolean; exitCode?: number } = {},
): string {
  const badges = [
    options.truncated ? "[OUTPUT TRUNCATED: >1000 TOKENS]" : "",
    options.exitCode !== undefined && options.exitCode !== 0
      ? `[FAILED: Exit ${options.exitCode}]`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const heading = `### spekta ${redactSecrets(command)}${
    badges ? ` ${badges}` : ""
  }`;

  return `${heading}\n\n\`\`\`\n${redactSecrets(output)}\n\`\`\``;
}
