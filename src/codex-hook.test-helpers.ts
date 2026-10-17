import { rewriteEvent } from "./codex-hook.js";

export const event = (command: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  cwd: process.cwd(),
  tool_input: { command },
  ignored: true,
});

export const inputFor = (command: string) => JSON.stringify(event(command));

export function shellQuoteForTest(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function rewritten(command: string): string | undefined {
  const output = rewriteEvent(event(command));
  if (!output) return;
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== "object")
    throw new Error("invalid hook output");
  const specific = (
    parsed as { hookSpecificOutput?: { updatedInput?: { command?: unknown } } }
  ).hookSpecificOutput;
  const value = specific?.updatedInput?.command;
  return typeof value === "string" ? value : undefined;
}
