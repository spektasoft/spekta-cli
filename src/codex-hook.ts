import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isSupportedDiscoveryRequest,
  isSupportedGitProxyRequest,
} from "./commands/proxy/proxy-policy.js";

const MAX_INPUT = 64 * 1024;
const INPUT_TIMEOUT_MS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLiteralCommand(
  command: string,
  cwd: string,
): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: "single" | "double" | undefined;

  for (let i = 0; i < command.length; i += 1) {
    const char = command.charAt(i);
    const code = char.charCodeAt(0);
    if ((code < 0x20 && char !== "\t") || (code >= 0x7f && code <= 0x9f))
      return;
    if (quote === "single") {
      if (char === "'") quote = undefined;
      else word += char;
      continue;
    }
    if (quote === "double") {
      if (char === '"') quote = undefined;
      else if (char === "\\") {
        if (++i >= command.length) return;
        const escaped = command.charAt(i);
        const escapedCode = escaped.charCodeAt(0);
        if (escapedCode < 0x20 || (escapedCode >= 0x7f && escapedCode <= 0x9f))
          return;
        if ('"\\$`'.includes(escaped)) word += escaped;
        else word += `\\${escaped}`;
      } else if (char === "$" || char === "`") return;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char === "'" ? "single" : "double";
      started = true;
      continue;
    }
    if (char === "\\") {
      if (++i >= command.length) return;
      const escaped = command.charAt(i);
      const escapedCode = escaped.charCodeAt(0);
      if (escapedCode < 0x20 || (escapedCode >= 0x7f && escapedCode <= 0x9f))
        return;
      word += escaped;
      started = true;
      continue;
    }
    if (char === " " || char === "\t") {
      if (started) {
        words.push(word);
        word = "";
        started = false;
      }
      continue;
    }
    // Reject shell syntax and active expansion outside quotes. This deliberately
    // accepts only words and whitespace, never shell grammar.
    if ("$`*?[]{}()<>|;&#!~".includes(char)) return;
    // Zsh expands an unquoted leading `=name` to the path of command `name`
    // when EQUALS is enabled. The hook cannot know the effective shell/options.
    if (char === "=" && word.length === 0) return;
    word += char;
    started = true;
  }
  if (quote) return;
  if (started) words.push(word);
  if (words.length < 1) return;
  if (words[0] === "git") {
    if (!isSupportedGitProxyRequest(words.slice(1), cwd)) return;
  } else if (words[0] === "rtk") {
    if (words[1] !== "rg") return;
  } else if (["cat", "sed", "rg"].includes(words[0])) {
    // Read forms are classified and translated after tokenization.
  } else if (
    !["ls", "find"].includes(words[0]) ||
    !isSupportedDiscoveryRequest(words[0], words.slice(1))
  )
    return;
  return words;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function translateRead(words: string[]): string[] | undefined {
  const command = words[0];
  if (command === "cat") {
    if (words.length !== 2 || words[1] === "-" || words[1].startsWith("-"))
      return;
    // Spekta uses this suffix to encode ranges, so routing it would change a
    // literal filename into a different read request.
    if (/\[(?:\d+|\$)?(?:,(?:\d+|\$))?\]$/.test(words[1])) return;
    return ["spekta", "read", words[1]];
  }
  if (command === "rg") {
    const translated = translateSearch(words);
    if (!translated) return;
    return translated;
  }
  if (command !== "sed" || words.length !== 4 || words[1] !== "-n") return;
  const range = words[2].match(/^([1-9]\d*)(?:,(\d+|\$))?p$/);
  const path = words[3];
  if (!range || path === "-" || path.startsWith("-")) return;
  if (range[2] !== undefined && range[2] !== "$") {
    const end = Number.parseInt(range[2], 10);
    if (end < Number.parseInt(range[1], 10)) return;
  }
  if (/\[(?:\d+|\$)?(?:,(?:\d+|\$))?\]$/.test(path)) return;
  const start = range[1];
  const end = range[2] ?? "$";
  return ["spekta", "read", `${path}[${start},${end}]`];
}

function translateSearch(words: string[]): string[] | undefined {
  const args = words.slice(1);
  let pattern: string | undefined;
  let searchPath: string | undefined;
  let caseInsensitive = false;
  const globs: string[] = [];
  const positional: string[] = [];
  let optionsEnded = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (
      !optionsEnded &&
      !pattern &&
      (arg === "-i" || arg === "--ignore-case")
    ) {
      caseInsensitive = true;
      continue;
    }
    if (!optionsEnded && !pattern && (arg === "-g" || arg === "--glob")) {
      const glob = args[++i];
      if (!glob || glob.startsWith("-") || glob.includes(",")) return;
      globs.push(glob);
      continue;
    }
    if (!optionsEnded && !pattern && arg === "-e") {
      pattern = args[++i];
      if (pattern === undefined) return;
      continue;
    }
    if (!optionsEnded && arg.startsWith("-")) return;
    positional.push(arg);
  }

  if (pattern === undefined) {
    if (positional.length === 0) return;
    pattern = positional.shift();
  }
  if (!pattern || positional.length > 1) return;
  if (positional[0] === "-") return;
  if (positional[0]?.startsWith("-")) return;
  if (positional[0] !== undefined) searchPath = positional[0];

  const translated = ["spekta", "grep", pattern];
  if (searchPath !== undefined) translated.push(searchPath);
  if (caseInsensitive) translated.push("--ignore-case");
  if (globs.length > 0) translated.push("--glob", globs.join(","));
  return translated;
}

export function rewriteEvent(value: unknown): string | undefined {
  if (!isRecord(value)) throw new Error("invalid event");
  const event = value;
  if (
    typeof event.hook_event_name !== "string" ||
    typeof event.tool_name !== "string"
  ) {
    throw new Error("invalid event");
  }
  if (event.hook_event_name !== "PreToolUse" || event.tool_name !== "Bash")
    return;
  if (typeof event.cwd !== "string" || !isRecord(event.tool_input))
    throw new Error("invalid event");
  const command = event.tool_input.command;
  if (typeof command !== "string") throw new Error("invalid event");
  const words = parseLiteralCommand(command, event.cwd);
  if (!words) return;
  const read = translateRead(words);
  if (["cat", "sed"].includes(words[0]) && !read) return;
  const isSearch = words[0] === "rg" || words[0] === "rtk";
  const search = isSearch
    ? translateSearch(words[0] === "rtk" ? ["rg", ...words.slice(2)] : words)
    : undefined;
  if (isSearch && !search) return;
  const rewrittenCommand = (read ?? search ?? ["spekta", ...words])
    .map(shellQuote)
    .join(" ");
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      updatedInput: { ...event.tool_input, command: rewrittenCommand },
    },
  });
}

async function readInput(): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    let input = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) process.stdin.destroy();
      if (error) reject(error);
      else resolve(input);
    };
    const onData = (chunk: string) => {
      input += chunk;
      if (Buffer.byteLength(input, "utf8") > MAX_INPUT)
        finish(new Error("input too large"));
    };
    const onEnd = () => finish();
    const onError = () => finish(new Error("input read failed"));
    const timer = setTimeout(
      () => finish(new Error("input timeout")),
      INPUT_TIMEOUT_MS,
    );
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}

async function main(): Promise<void> {
  try {
    const input = await readInput();
    if (!input) throw new Error("empty input");
    let event: unknown;
    try {
      event = JSON.parse(input);
    } catch {
      throw new Error("invalid JSON");
    }
    const response = rewriteEvent(event);
    if (response) process.stdout.write(`${response}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal failure";
    process.stderr.write(`spekta-codex-hook: ${message}\n`);
    process.exitCode = 0;
  }
}

if (process.argv[1]) {
  try {
    if (fileURLToPath(import.meta.url) === realpathSync(process.argv[1]))
      void main();
  } catch {
    process.stderr.write(
      "spekta-codex-hook: executable path resolution failed\n",
    );
    process.exitCode = 0;
  }
}
