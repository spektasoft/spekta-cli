import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";

export const CODEX_USAGE_START = "<!-- spekta:codex-usage:start -->";
export const CODEX_USAGE_END = "<!-- spekta:codex-usage:end -->";
export const CODEX_HOOK_MATCHER = "^(Bash)$";

export interface CodexSetupFile {
  path: string;
  action: "create" | "update" | "unchanged";
  content: string;
}

export interface CodexSetupPlan {
  status: "ready" | "refused";
  files: CodexSetupFile[];
  diagnostics: string[];
}

export interface CodexSetupOptions {
  home: string;
  path: string;
}

const ownedInstructions = `${CODEX_USAGE_START}
## Spekta workspace operations

Prefer the Spekta CLI for supported workspace inspection: use \`spekta ls\`, \`spekta read\`, \`spekta grep\`, and supported \`spekta git\` inspections. Use the configured Spekta MCP server only when the CLI is unavailable and MCP has been enabled.

Use Spekta for eligible file discovery, reading, searching, and supported Git inspection. Retrieve only the files and ranges needed to answer the current question; narrow broad searches by symbol, path, pattern, or glob, then read selected files. Unsupported or compound commands continue through the normal shell path. If Spekta rejects an operation under policy, do not retry it through MCP or the original executable.
${CODEX_USAGE_END}`;

async function findHook(pathValue: string): Promise<string | undefined> {
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, "spekta-codex-hook");
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue until a usable executable is found.
    }
  }
  return undefined;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function buildHooks(original: string | undefined, executable: string): string {
  let config: Record<string, unknown> = {};
  if (original !== undefined) {
    try {
      const parsed: unknown = JSON.parse(original);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("top-level value must be an object");
      }
      config = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `hooks.json has invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  const hooks = config.hooks === undefined ? {} : config.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error("hooks.json has a malformed hooks object");
  }
  const eventHooks = (hooks as Record<string, unknown>).PreToolUse;
  if (eventHooks !== undefined && !Array.isArray(eventHooks)) {
    throw new Error(
      "hooks.json has malformed hooks.PreToolUse; refusing to change it",
    );
  }
  const entries = (eventHooks ?? []) as unknown[];
  const owned: number[] = [];
  entries.forEach((entry, index) => {
    const rendered = JSON.stringify(entry);
    if (rendered.includes("spekta-codex-hook")) owned.push(index);
  });
  if (owned.length > 1)
    throw new Error(
      "hooks.json contains duplicate Spekta hook definitions; remove duplicates manually",
    );

  const hook = {
    matcher: CODEX_HOOK_MATCHER,
    hooks: [
      { type: "command", command: JSON.stringify(executable), timeout: 3 },
    ],
  };
  const updatedEntries = [...entries];
  if (owned.length === 1) {
    const existing = entries[owned[0]];
    if (
      !existing ||
      typeof existing !== "object" ||
      Array.isArray(existing) ||
      (existing as Record<string, unknown>).matcher !== CODEX_HOOK_MATCHER ||
      !JSON.stringify(existing).includes('"type":"command"')
    ) {
      throw new Error(
        "hooks.json contains conflicting Spekta-owned hook content; inspect and repair it manually",
      );
    }
    updatedEntries[owned[0]] = hook;
  } else {
    updatedEntries.push(hook);
  }
  (hooks as Record<string, unknown>).PreToolUse = updatedEntries;
  config.hooks = hooks;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function buildInstructions(original: string | undefined): string {
  if (original === undefined || original.length === 0)
    return `${ownedInstructions}\n`;
  const startCount = original.split(CODEX_USAGE_START).length - 1;
  const endCount = original.split(CODEX_USAGE_END).length - 1;
  if (startCount !== endCount || startCount > 1) {
    throw new Error(
      "AGENTS.md has malformed or duplicate Spekta usage markers; repair the ownership block manually",
    );
  }
  if (startCount === 1) {
    const start = original.indexOf(CODEX_USAGE_START);
    const end = original.indexOf(CODEX_USAGE_END) + CODEX_USAGE_END.length;
    const current = original.slice(start, end);
    if (current !== ownedInstructions) {
      throw new Error(
        "AGENTS.md Spekta usage block was edited; refusing to replace unfamiliar content",
      );
    }
    return original;
  }
  return `${original.replace(/\s*$/, "")}\n\n${ownedInstructions}\n`;
}

export async function previewCodexSetup(
  options: CodexSetupOptions,
): Promise<CodexSetupPlan> {
  const codexDirectory = join(options.home, ".codex");
  const hookPath = join(codexDirectory, "hooks.json");
  const instructionPath = join(codexDirectory, "AGENTS.md");
  const diagnostics: string[] = [];
  const executable = await findHook(options.path);
  if (!executable)
    diagnostics.push(
      "spekta-codex-hook was not found as an executable on PATH",
    );

  let hooksOriginal: string | undefined;
  let instructionsOriginal: string | undefined;
  try {
    [hooksOriginal, instructionsOriginal] = await Promise.all([
      readOptional(hookPath),
      readOptional(instructionPath),
    ]);
  } catch (error) {
    diagnostics.push(
      `Unable to read Codex configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let hookContent = "";
  let instructionsContent = "";
  try {
    hookContent = buildHooks(hooksOriginal, executable ?? "spekta-codex-hook");
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  try {
    instructionsContent = buildInstructions(instructionsOriginal);
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  }
  if (diagnostics.length) return { status: "refused", files: [], diagnostics };
  return {
    status: "ready",
    diagnostics,
    files: [
      {
        path: hookPath,
        action:
          hooksOriginal === undefined
            ? "create"
            : hookContent === hooksOriginal
              ? "unchanged"
              : "update",
        content: hookContent,
      },
      {
        path: instructionPath,
        action:
          instructionsOriginal === undefined
            ? "create"
            : instructionsContent === instructionsOriginal
              ? "unchanged"
              : "update",
        content: instructionsContent,
      },
    ],
  };
}

export async function runCodexSetup(args: string[] = []): Promise<void> {
  if (
    args.length !== 3 ||
    args[0] !== "--global" ||
    args[1] !== "--codex" ||
    args[2] !== "--dry-run"
  ) {
    throw new Error("Usage: spekta setup --global --codex --dry-run");
  }
  const plan = await previewCodexSetup({
    home: process.env.HOME ?? "",
    path: process.env.PATH ?? "",
  });
  if (plan.status === "refused") {
    for (const diagnostic of plan.diagnostics)
      console.error(`Setup preview refused: ${diagnostic}`);
    process.exitCode = 1;
    return;
  }
  for (const file of plan.files) {
    console.log(`${file.action.toUpperCase()} ${file.path}`);
    console.log(file.content);
  }
  console.log("Preview only; no Codex configuration or files were changed.");
}
