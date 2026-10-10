import type { CommandDefinition } from "./commands";
import { NATIVE_HELP } from "./help-native";
import { PROXY_HELP } from "./help-proxy";
import { renderTopic } from "./help-topic";

const HELP_FLAGS = new Set(["--help", "-h"]);

// These options consume the next argv token even when that value is invalid.
// Help routing leaves validation to the operational parser.
const VALUE_OPTIONS: Record<string, readonly string[]> = {
  commit: ["--model"],
  prompt: ["--output", "--include-partial", "--exclude-partial"],
  find: ["-name", "-type"],
  "git log": ["-n"],
};

function requestsCommandHelp(topic: string, args: string[]): boolean {
  if (args.length === 1 && HELP_FLAGS.has(args[0])) return true;
  // write/replace consume everything after the target path as literal payload.
  if (topic === "write" || topic === "replace") return false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    // Preserve operand boundaries without adding separator support to parsers.
    if (arg === "--") return false;
    if (VALUE_OPTIONS[topic]?.includes(arg)) {
      index++;
      continue;
    }
    // Leading and trailing flags are unambiguous discovery positions.
    if (HELP_FLAGS.has(arg) && (index === 0 || index === args.length - 1)) {
      return true;
    }
  }
  return false;
}

function resolveHelpTopic(args: string[]): string | null {
  if (args[0] === "help") return args.slice(1).join(" ");
  if (args.length === 1 && HELP_FLAGS.has(args[0])) return "";
  if (!args.length) return null;
  if (args[0] === "git") {
    if (requestsCommandHelp("git", args.slice(1)) && HELP_FLAGS.has(args[1])) {
      return "git";
    }
    const topic = args.slice(0, 2).join(" ");
    return requestsCommandHelp(topic, args.slice(2)) ? topic : null;
  }
  return requestsCommandHelp(args[0], args.slice(1)) ? args[0] : null;
}

export function handleHelp(
  args: string[],
  commands: Record<string, CommandDefinition>,
): boolean {
  const topic = resolveHelpTopic(args);
  if (topic === null) return false;
  if (topic !== "") {
    const native = Object.hasOwn(commands, topic) ? commands[topic] : undefined;
    const content = Object.hasOwn(NATIVE_HELP, topic)
      ? NATIVE_HELP[topic]
      : Object.hasOwn(PROXY_HELP, topic)
        ? PROXY_HELP[topic]
        : undefined;
    if (content || native) {
      process.stdout.write(
        renderTopic(
          content ?? {
            title: `${topic} — ${native.name}`,
            purpose: native.name,
            usage: [`spekta ${topic} [arguments]`, `spekta help ${topic}`],
            complete: false,
          },
        ),
      );
    } else {
      process.stderr.write(
        `Unknown help topic: ${topic}. Run spekta --help to list available topics.\n`,
      );
      process.exitCode = 1;
    }
    return true;
  }
  const native = Object.entries(commands)
    .map(([key, command]) => `  ${key.padEnd(14)} ${command.name}`)
    .join("\n");
  process.stdout.write(
    `Spekta — workspace operations and AI workflows\n\nUsage: spekta [command] [arguments]\n       spekta help <command>\n       spekta <command> --help\n\nWith no arguments, open the interactive menu.\n\nBuilt-in commands:\n${native}\n\nSupported proxy families:\n  ls             List eligible workspace entries\n  find           Discover eligible workspace paths\n  git            Inspect status, log, show, diff and branch\n\nEvery built-in command has detailed help. Use spekta help <command> to read it.\n`,
  );
  return true;
}
