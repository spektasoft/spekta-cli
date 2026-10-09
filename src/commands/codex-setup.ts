import {
  access,
  lstat,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const CODEX_USAGE_START = "<!-- spekta:codex-usage:start -->";
export const CODEX_USAGE_END = "<!-- spekta:codex-usage:end -->";
export const CODEX_HOOK_MATCHER = "^(Bash)$";

export interface CodexSetupFile {
  path: string;
  action: "create" | "update" | "unchanged" | "delete";
  content: string;
}

export interface CodexSetupPlan {
  status: "ready" | "refused";
  files: CodexSetupFile[];
  diagnostics: string[];
  conflicts: CodexSetupConflict[];
}

export interface CodexSetupConflict {
  source: string;
  kind: "rtk-rewrite" | "competing-hook" | "ambiguous-source";
  message: string;
}

export interface CodexSetupOptions {
  home: string;
  path: string;
  cwd?: string;
  mcp?: boolean;
}

export type CodexComponentState =
  "absent" | "configured" | "conflicting" | "broken" | "verified";

export interface CodexComponentStatus {
  state: CodexComponentState;
  details: string[];
}

export interface CodexStatus {
  components: {
    hooks: CodexComponentStatus;
    instructions: CodexComponentStatus;
    mcp: CodexComponentStatus;
  };
  trust: "unknown";
  activation: "unknown";
  verificationSteps: string[];
}

export interface CodexSetupApplyResult {
  status: "configured" | "refused" | "failed";
  activation: "unverified";
  files: CodexSetupFile[];
  diagnostics: string[];
}

export interface CodexUninstallPlan {
  status: "ready" | "refused";
  files: CodexSetupFile[];
  diagnostics: string[];
}

export interface CodexUninstallResult {
  status: "uninstalled" | "refused" | "failed";
  files: CodexSetupFile[];
  diagnostics: string[];
}

function activeHookSources(options: CodexSetupOptions): string[] {
  const sources = [
    join(options.home, ".codex", "hooks.json"),
    join(options.home, ".codex", "config.toml"),
  ];
  if (options.cwd) {
    let directory = resolve(options.cwd);
    while (true) {
      sources.push(
        join(directory, ".codex", "hooks.json"),
        join(directory, ".codex", "config.toml"),
      );
      const parent = resolve(directory, "..");
      if (parent === directory) break;
      directory = parent;
    }
  }
  return [...new Set(sources)];
}

function hasBashMatcher(matcher: unknown): boolean {
  if (matcher === undefined || matcher === "") return true;
  if (typeof matcher !== "string") throw new Error("matcher is not a string");
  try {
    return new RegExp(matcher).test("Bash");
  } catch {
    throw new Error("matcher is not a valid regular expression");
  }
}

async function findRewriteConflicts(
  options: CodexSetupOptions,
): Promise<CodexSetupConflict[]> {
  const conflicts: CodexSetupConflict[] = [];
  for (const source of activeHookSources(options)) {
    const content = await readOptional(source).catch(() => null);
    if (content === null) {
      conflicts.push({
        source,
        kind: "ambiguous-source",
        message: "could not be read; inspect active hooks and resolve manually",
      });
      continue;
    }
    if (content === undefined) continue;
    if (source.endsWith("config.toml")) {
      if (/^\s*\[\[?hooks(?:\.|\])/m.test(content)) {
        conflicts.push({
          source,
          kind: "ambiguous-source",
          message:
            "contains inline hook configuration that cannot be safely interpreted; review and resolve hooks manually",
        });
      }
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      conflicts.push({
        source,
        kind: "ambiguous-source",
        message: "is malformed; preserve it and inspect active hooks manually",
      });
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      conflicts.push({
        source,
        kind: "ambiguous-source",
        message:
          "has an ambiguous top-level value; preserve it and inspect active hooks manually",
      });
      continue;
    }
    const hooks = (parsed as Record<string, unknown>).hooks;
    if (hooks === undefined) continue;
    if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
      conflicts.push({
        source,
        kind: "ambiguous-source",
        message:
          "has an ambiguous hooks object; preserve it and inspect active hooks manually",
      });
      continue;
    }
    const preToolUse = (hooks as Record<string, unknown>).PreToolUse;
    if (preToolUse === undefined) continue;
    if (!Array.isArray(preToolUse)) {
      conflicts.push({
        source,
        kind: "ambiguous-source",
        message:
          "has an ambiguous PreToolUse definition; preserve it and inspect active hooks manually",
      });
      continue;
    }
    for (const group of preToolUse) {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        conflicts.push({
          source,
          kind: "ambiguous-source",
          message:
            "has an ambiguous PreToolUse entry; preserve it and inspect active hooks manually",
        });
        continue;
      }
      const matcherResult = (() => {
        try {
          return {
            matchesBash: hasBashMatcher(
              (group as Record<string, unknown>).matcher,
            ),
          };
        } catch {
          return undefined;
        }
      })();
      if (!matcherResult) {
        conflicts.push({
          source,
          kind: "ambiguous-source",
          message:
            "has an ambiguous Bash matcher; preserve it and inspect active hooks manually",
        });
        continue;
      }
      const { matchesBash } = matcherResult;
      if (!matchesBash) continue;
      const handlers = (group as Record<string, unknown>).hooks;
      if (!Array.isArray(handlers)) {
        conflicts.push({
          source,
          kind: "ambiguous-source",
          message:
            "has an ambiguous matching hook list; preserve it and inspect active hooks manually",
        });
        continue;
      }
      for (const handler of handlers) {
        const command =
          handler && typeof handler === "object"
            ? (handler as Record<string, unknown>).command
            : undefined;
        if (typeof command !== "string") {
          conflicts.push({
            source,
            kind: "ambiguous-source",
            message:
              "has a matching hook without an interpretable command; preserve it and inspect manually",
          });
        } else if (/\brtk(?:\s|$)/i.test(command)) {
          conflicts.push({
            source,
            kind: "rtk-rewrite",
            message:
              "contains an active RTK command hook matching Bash; resolve the competing rewrite manually",
          });
        } else if (!command.includes("spekta-codex-hook")) {
          conflicts.push({
            source,
            kind: "competing-hook",
            message:
              "contains an unfamiliar active command hook matching Bash; resolve the competing rewrite manually",
          });
        }
      }
    }
  }
  return conflicts;
}

const ownedInstructions = `${CODEX_USAGE_START}
## Spekta workspace operations

Prefer the Spekta CLI for supported workspace inspection: use \`spekta ls\`, \`spekta read\`, \`spekta rg\`, and supported \`spekta git\` inspections. Use the configured Spekta MCP server only when the CLI is unavailable and MCP has been enabled.

Use Spekta for eligible file discovery, reading, searching, and supported Git inspection. Retrieve only the files and ranges needed to answer the current question; narrow broad searches by symbol, path, pattern, or glob, then read selected files. Unsupported or compound commands continue through the normal shell path. If Spekta rejects an operation under policy, do not retry it through MCP or the original executable.
MCP registration changes runtime setup only. Start a new Codex session to load an opt-in server; it does not dynamically add tools to an existing session.
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

async function findExecutable(
  name: string,
  pathValue: string,
): Promise<string | undefined> {
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue until a usable executable is found.
    }
  }
  return undefined;
}

async function verifyCodexSessionCwdContract(
  pathValue: string,
): Promise<string | undefined> {
  const codex = await findExecutable("codex", pathValue);
  if (!codex)
    return "Codex MCP opt-in is incompatible: Codex CLI 0.160.1 or newer is required to select the session workspace for stdio servers.";
  try {
    const { stdout } = await execFile(codex, ["--version"], { timeout: 3000 });
    const match = stdout.match(/codex-cli\s+(\d+)\.(\d+)\.(\d+)/i);
    if (!match) throw new Error("unrecognized version output");
    const version = match.slice(1).map(Number);
    const minimum = [0, 160, 1];
    const older =
      version.findIndex((part, index) => part !== minimum[index]) >= 0
        ? version.reduce(
            (result, part, index) =>
              result ||
              (part === minimum[index] ? 0 : part < minimum[index] ? -1 : 1),
            0,
          ) < 0
        : false;
    if (older) throw new Error("version is older than 0.160.1");
    return undefined;
  } catch (error) {
    return `Codex MCP opt-in is incompatible: could not verify the session-workspace launch contract (${error instanceof Error ? error.message : String(error)}).`;
  }
}

function buildMcpConfig(
  original: string | undefined,
  executable: string,
): string {
  const header = /^\s*\[mcp_servers\.spekta\]\s*(?:#.*)?$/;
  const lines = (original ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => header.test(line));
  const sectionLines: string[] = [];
  if (start >= 0) {
    if (lines.filter((line) => header.test(line)).length !== 1)
      throw new Error(
        "config.toml has duplicate Spekta MCP sections; preserving it",
      );
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^\s*\[/.test(lines[index])) {
        end = index;
        break;
      }
    }
    sectionLines.push(...lines.slice(start + 1, end));
    const meaningful = sectionLines
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean);
    if (
      meaningful.length !== 2 ||
      !meaningful.some((line) => /^command\s*=/.test(line)) ||
      !meaningful.some((line) => /^args\s*=/.test(line))
    )
      throw new Error(
        "config.toml has conflicting or malformed Spekta MCP ownership; preserving it",
      );
    let command: unknown;
    let args: unknown;
    try {
      command = JSON.parse(
        meaningful
          .find((line) => /^command\s*=/.test(line))!
          .split("=")
          .slice(1)
          .join("=")
          .trim(),
      );
      args = JSON.parse(
        meaningful
          .find((line) => /^args\s*=/.test(line))!
          .split("=")
          .slice(1)
          .join("=")
          .trim(),
      );
    } catch {
      throw new Error(
        "config.toml has conflicting or malformed Spekta MCP ownership; preserving it",
      );
    }
    if (
      typeof command !== "string" ||
      !command.split(/[\\/]/).at(-1)?.startsWith("spekta") ||
      JSON.stringify(args) !== '["mcp"]'
    )
      throw new Error(
        "config.toml has conflicting Spekta MCP ownership; preserving it",
      );
    const updated = lines.slice(start, end);
    const commandIndex = updated.findIndex((line) =>
      /^\s*command\s*=/.test(line),
    );
    updated[commandIndex] = `command = ${JSON.stringify(executable)}`;
    lines.splice(start, end - start, ...updated);
    return `${lines.join("\n").replace(/\n*$/, "\n")}`;
  }
  const prefix = (original ?? "").replace(/\s*$/, "");
  return `${prefix}${prefix ? "\n\n" : ""}[mcp_servers.spekta]\ncommand = ${JSON.stringify(executable)}\nargs = ["mcp"]\n`;
}

function removeMcpConfig(original: string): string | undefined {
  const lines = original.split(/\r?\n/);
  const header = /^\s*\[mcp_servers\.spekta\]\s*(?:#.*)?$/;
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return original;
  if (lines.filter((line) => header.test(line)).length !== 1)
    throw new Error(
      "config.toml has duplicate Spekta MCP sections; preserving it",
    );
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      end = index;
      break;
    }
  }
  // Reuse the ownership validator before deleting anything.
  buildMcpConfig(original, "spekta");
  let removeStart = start;
  while (removeStart > 0 && lines[removeStart - 1].trim() === "")
    removeStart -= 1;
  const result = [...lines.slice(0, removeStart), ...lines.slice(end)]
    .join("\n")
    .replace(/\n*$/, "\n");
  return /^\s*$/.test(result) ? undefined : result;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function isRecognizedOwnedHook(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (
    Object.keys(entry).length !== 2 ||
    entry.matcher !== CODEX_HOOK_MATCHER ||
    !Array.isArray(entry.hooks) ||
    entry.hooks.length !== 1
  )
    return false;
  const handler: unknown = (entry.hooks as unknown[])[0];
  if (!handler || typeof handler !== "object" || Array.isArray(handler))
    return false;
  const command = handler as Record<string, unknown>;
  if (
    Object.keys(command).length !== 3 ||
    command.type !== "command" ||
    command.timeout !== 3 ||
    typeof command.command !== "string"
  )
    return false;
  try {
    return (
      typeof JSON.parse(command.command) === "string" &&
      String(JSON.parse(command.command)).length > 0 &&
      String(JSON.parse(command.command)).split(/[\\/]/).at(-1) ===
        "spekta-codex-hook"
    );
  } catch {
    return false;
  }
}

function componentStatus(
  state: CodexComponentState,
  ...details: string[]
): CodexComponentStatus {
  return { state, details };
}

async function inspectOwnedHook(path: string): Promise<CodexComponentStatus> {
  let content: string | undefined;
  try {
    content = await readOptional(path);
  } catch (error) {
    return componentStatus(
      "broken",
      `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (content === undefined) return componentStatus("absent");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return componentStatus("conflicting", `${path} contains malformed JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return componentStatus(
      "conflicting",
      `${path} has an ambiguous structure.`,
    );
  const hooks = (parsed as Record<string, unknown>).hooks;
  if (
    hooks === undefined ||
    !hooks ||
    typeof hooks !== "object" ||
    Array.isArray(hooks)
  )
    return componentStatus("absent");
  const entries = (hooks as Record<string, unknown>).PreToolUse;
  if (entries === undefined) return componentStatus("absent");
  if (!Array.isArray(entries))
    return componentStatus(
      "conflicting",
      `${path} has an ambiguous PreToolUse definition.`,
    );
  const owned = entries.filter((entry) =>
    JSON.stringify(entry).includes("spekta-codex-hook"),
  );
  if (owned.length === 0) return componentStatus("absent");
  if (owned.length !== 1 || !isRecognizedOwnedHook(owned[0]))
    return componentStatus(
      "conflicting",
      `${path} has malformed or duplicate Spekta hook ownership.`,
    );
  const command = JSON.parse(
    String((owned[0] as { hooks: { command: string }[] }).hooks[0].command),
  ) as string;
  try {
    await access(command, constants.X_OK);
  } catch {
    return componentStatus(
      "broken",
      `Configured hook executable is missing or not executable: ${command}`,
    );
  }
  return componentStatus("configured", `Owned hook is configured in ${path}.`);
}

async function inspectInstructions(
  path: string,
): Promise<CodexComponentStatus> {
  let content: string | undefined;
  try {
    content = await readOptional(path);
  } catch (error) {
    return componentStatus(
      "broken",
      `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (content === undefined) return componentStatus("absent");
  const starts = content.split(CODEX_USAGE_START).length - 1;
  const ends = content.split(CODEX_USAGE_END).length - 1;
  if (starts === 0 && ends === 0) return componentStatus("absent");
  if (starts !== 1 || ends !== 1)
    return componentStatus(
      "conflicting",
      `${path} has malformed or duplicate Spekta ownership markers.`,
    );
  try {
    const owned = buildInstructions(content);
    return owned === content
      ? componentStatus(
          "configured",
          `Owned usage instructions are present in ${path}.`,
        )
      : componentStatus(
          "conflicting",
          `${path} contains unfamiliar changes to the Spekta instructions.`,
        );
  } catch (error) {
    return componentStatus(
      "conflicting",
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function executableIsAvailable(
  command: string,
  pathValue: string,
): Promise<boolean> {
  const candidates = command.includes("/")
    ? [resolve(command)]
    : pathValue
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => resolve(directory, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Keep looking through PATH entries.
    }
  }
  return false;
}

async function inspectMcp(
  path: string,
  pathValue: string,
): Promise<CodexComponentStatus> {
  let content: string | undefined;
  try {
    content = await readOptional(path);
  } catch (error) {
    return componentStatus(
      "broken",
      `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (content === undefined) return componentStatus("absent");
  const lines = content.split(/\r?\n/);
  const sections = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*\[/.test(line));
  const mcpHeader =
    /^\s*\[mcp_servers\.(?:spekta|"spekta"|'spekta')\]\s*(?:#.*)?$/;
  const section = sections.find(({ line }) => mcpHeader.test(line));
  if (!section) {
    if (/\[mcp_servers\.(?:spekta|"spekta"|'spekta')\b/.test(content))
      return componentStatus(
        "conflicting",
        `${path} has an ambiguous spekta MCP section; inspect it manually.`,
      );
    return componentStatus("absent");
  }
  const end =
    sections.find(({ index }) => index > section.index)?.index ?? lines.length;
  const body = lines.slice(section.index + 1, end).join("\n");
  const commandValue = body.match(
    /^\s*command\s*=\s*("(?:\\.|[^"\\])*"|'[^']*')\s*(?:#.*)?$/m,
  )?.[1];
  const urlValue = body.match(
    /^\s*url\s*=\s*("(?:\\.|[^"\\])*"|'[^']*')\s*(?:#.*)?$/m,
  )?.[1];
  const decodeTomlString = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return undefined;
      }
    }
    return value.slice(1, -1);
  };
  const command = decodeTomlString(commandValue);
  const argsValue = body.match(/^\s*args\s*=\s*(\[[^\]]*\])\s*(?:#.*)?$/m)?.[1];
  const cwdValue = body.match(/^\s*cwd\s*=/m);
  let args: unknown;
  try {
    args = argsValue === undefined ? undefined : JSON.parse(argsValue);
  } catch {
    args = undefined;
  }
  if (cwdValue || JSON.stringify(args) !== '["mcp"]')
    return componentStatus(
      "conflicting",
      "The Spekta MCP registration does not use the verified session-workspace launch contract.",
    );
  if (!command && decodeTomlString(urlValue))
    return componentStatus(
      "configured",
      "A remote spekta MCP server is configured; runtime connectivity and session binding are unverified.",
    );
  if (!command)
    return componentStatus(
      "conflicting",
      "The spekta MCP section has no interpretable command or URL.",
    );
  if (!(await executableIsAvailable(command, pathValue))) {
    return componentStatus(
      "broken",
      `Configured MCP executable is missing or not executable: ${command}`,
    );
  }
  return componentStatus(
    "configured",
    "A spekta MCP server is configured; runtime workspace binding is unverified.",
  );
}

export async function readCodexStatus(
  options: CodexSetupOptions,
): Promise<CodexStatus> {
  const codexDirectory = join(options.home, ".codex");
  const hooksPath = join(codexDirectory, "hooks.json");
  const instructionsPath = join(codexDirectory, "AGENTS.md");
  let hooks = await inspectOwnedHook(hooksPath);
  const conflicts = await findRewriteConflicts(options);
  if (conflicts.length && hooks.state !== "conflicting") {
    hooks = componentStatus(
      "conflicting",
      ...conflicts
        .slice(0, 20)
        .map(({ source, message }) => `${source}: ${message}`),
    );
  }
  return {
    components: {
      hooks,
      instructions: await inspectInstructions(instructionsPath),
      mcp: await inspectMcp(join(codexDirectory, "config.toml"), options.path),
    },
    trust: "unknown",
    activation: "unknown",
    verificationSteps: [
      "Start a new supported Codex session with this workspace open.",
      "Run a supported standalone inspection command and confirm the Spekta hook runs exactly once.",
      "Confirm Codex has trusted and loaded the configured hook and usage instructions; configuration alone does not prove activation.",
    ],
  };
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
    if (!isRecognizedOwnedHook(existing)) {
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

function removeOwnedInstructions(original: string): string | undefined {
  const startCount = original.split(CODEX_USAGE_START).length - 1;
  const endCount = original.split(CODEX_USAGE_END).length - 1;
  if (startCount !== endCount || startCount > 1) {
    throw new Error(
      "AGENTS.md has malformed or duplicate Spekta usage markers; preserving it",
    );
  }
  if (startCount === 0) return original;
  const start = original.indexOf(CODEX_USAGE_START);
  const end = original.indexOf(CODEX_USAGE_END) + CODEX_USAGE_END.length;
  if (original.slice(start, end) !== ownedInstructions) {
    throw new Error(
      "AGENTS.md Spekta usage block was edited; preserving unfamiliar content",
    );
  }
  let removeStart = start;
  let removeEnd = end;
  if (original.slice(0, start).endsWith("\n\n")) removeStart -= 2;
  else if (original[removeEnd] === "\n") removeEnd += 1;
  const updated = original.slice(0, removeStart) + original.slice(removeEnd);
  return updated.length === 0 ? undefined : updated;
}

function removeOwnedHooks(original: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(original);
  } catch (error) {
    throw new Error(
      `hooks.json has invalid JSON; preserving it: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(
      "hooks.json has an ambiguous top-level value; preserving it",
    );
  const config = parsed as Record<string, unknown>;
  const hooks = config.hooks;
  if (hooks === undefined) return original;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks))
    throw new Error("hooks.json has a malformed hooks object; preserving it");
  const hookConfig = hooks as Record<string, unknown>;
  const entries = hookConfig.PreToolUse;
  if (entries === undefined) return original;
  if (!Array.isArray(entries))
    throw new Error("hooks.json has malformed hooks.PreToolUse; preserving it");
  const kept: unknown[] = [];
  let removed = false;
  for (const entry of entries) {
    const rendered = JSON.stringify(entry);
    if (!rendered.includes("spekta-codex-hook")) {
      kept.push(entry);
      continue;
    }
    if (!isRecognizedOwnedHook(entry))
      throw new Error(
        "hooks.json contains conflicting Spekta-owned hook content; preserving it",
      );
    removed = true;
  }
  if (!removed) return original;
  if (kept.length) hookConfig.PreToolUse = kept;
  else delete hookConfig.PreToolUse;
  if (Object.keys(hookConfig).length === 0) delete config.hooks;
  if (Object.keys(config).length === 0) return undefined;
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function previewCodexUninstall(
  options: Pick<CodexSetupOptions, "home">,
): Promise<CodexUninstallPlan> {
  const codexDirectory = join(options.home, ".codex");
  const diagnostics: string[] = [];
  const files: CodexSetupFile[] = [];
  for (const [path, remove] of [
    [join(codexDirectory, "hooks.json"), removeOwnedHooks],
    [join(codexDirectory, "AGENTS.md"), removeOwnedInstructions],
    [join(codexDirectory, "config.toml"), removeMcpConfig],
  ] as const) {
    let original: string | undefined;
    try {
      original = await readOptional(path);
    } catch (error) {
      diagnostics.push(
        `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (original === undefined) continue;
    try {
      const content = remove(original);
      if (content === original) continue;
      files.push({
        path,
        action: content === undefined ? "delete" : "update",
        content: content ?? "",
      });
    } catch (error) {
      diagnostics.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    status: diagnostics.length ? "refused" : "ready",
    files,
    diagnostics,
  };
}

export async function applyCodexUninstall(
  options: Pick<CodexSetupOptions, "home">,
  write: (
    path: string,
    content: string,
    encoding: "utf8",
  ) => Promise<void> = writeFile,
): Promise<CodexUninstallResult> {
  const plan = await previewCodexUninstall(options);
  if (plan.status === "refused")
    return { status: "refused", files: [], diagnostics: plan.diagnostics };
  const originals: Array<{ file: CodexSetupFile; content: string }> = [];
  try {
    for (const file of plan.files) {
      const content = await readOptional(file.path);
      if (content === undefined)
        throw new Error(`${file.path} changed during uninstall`);
      originals.push({ file, content });
    }
    const applied: typeof originals = [];
    try {
      for (const original of originals) {
        applied.push(original);
        if (original.file.action === "delete") await unlink(original.file.path);
        else await write(original.file.path, original.file.content, "utf8");
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const original of applied.reverse()) {
        try {
          await writeFile(original.file.path, original.content, "utf8");
        } catch (rollbackError) {
          rollbackErrors.push(
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          );
        }
      }
      if (rollbackErrors.length)
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; rollback incomplete: ${rollbackErrors.join("; ")}`,
          { cause: error },
        );
      throw error;
    }
    return { status: "uninstalled", files: plan.files, diagnostics: [] };
  } catch (error) {
    return {
      status: "failed",
      files: [],
      diagnostics: [
        `Codex configuration removal failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

export async function previewCodexSetup(
  options: CodexSetupOptions,
): Promise<CodexSetupPlan> {
  const codexDirectory = join(options.home, ".codex");
  const hookPath = join(codexDirectory, "hooks.json");
  const instructionPath = join(codexDirectory, "AGENTS.md");
  const diagnostics: string[] = [];
  const conflicts = await findRewriteConflicts(options);
  diagnostics.push(
    ...conflicts
      .slice(0, 20)
      .map((conflict) => `${conflict.source}: ${conflict.message}`),
  );
  if (conflicts.length > 20)
    diagnostics.push(
      `Additional active hook conflicts were found (${conflicts.length - 20} omitted); inspect the relevant Codex sources manually.`,
    );
  const executable = await findHook(options.path);
  if (!executable)
    diagnostics.push(
      "spekta-codex-hook was not found as an executable on PATH",
    );

  let mcpContent: string | undefined;
  let mcpOriginal: string | undefined;
  let mcpPath: string | undefined;
  if (options.mcp) {
    const incompatibility = await verifyCodexSessionCwdContract(options.path);
    if (incompatibility) diagnostics.push(incompatibility);
    const mcpExecutable = await findExecutable("spekta", options.path);
    if (!mcpExecutable)
      diagnostics.push(
        "spekta MCP opt-in is incompatible: spekta was not found as an executable on PATH",
      );
    mcpPath = join(codexDirectory, "config.toml");
    try {
      const original = await readOptional(mcpPath);
      mcpOriginal = original;
      if (!mcpExecutable) throw new Error("spekta executable is unavailable");
      mcpContent = buildMcpConfig(original, mcpExecutable);
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error));
    }
  }

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
  if (diagnostics.length)
    return { status: "refused", files: [], diagnostics, conflicts };
  return {
    status: "ready",
    diagnostics,
    conflicts,
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
      ...(options.mcp && mcpPath
        ? [
            {
              path: mcpPath,
              action:
                mcpOriginal === undefined
                  ? ("create" as const)
                  : mcpContent === mcpOriginal
                    ? ("unchanged" as const)
                    : ("update" as const),
              content: mcpContent ?? "",
            },
          ]
        : []),
    ],
  };
}

export async function applyCodexSetup(
  options: CodexSetupOptions,
  write: (
    path: string,
    content: string,
    encoding: "utf8",
  ) => Promise<void> = writeFile,
): Promise<CodexSetupApplyResult> {
  const plan = await previewCodexSetup(options);
  if (plan.status === "refused") {
    return {
      status: "refused",
      activation: "unverified",
      files: [],
      diagnostics: plan.diagnostics,
    };
  }

  try {
    for (const file of plan.files) {
      try {
        const info = await lstat(file.path);
        if (!info.isFile()) throw new Error("target is not a regular file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await mkdir(join(options.home, ".codex"), { recursive: true });
    const changed = plan.files.filter((file) => file.action !== "unchanged");
    const originals = await Promise.all(
      changed.map(async (file) => ({
        file,
        content: await readOptional(file.path),
      })),
    );
    const written: typeof originals = [];
    try {
      for (const original of originals) {
        written.push(original);
        await write(original.file.path, original.file.content, "utf8");
      }
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const original of written.reverse()) {
        try {
          if (original.content === undefined) await unlink(original.file.path);
          else await writeFile(original.file.path, original.content, "utf8");
        } catch (rollbackError) {
          rollbackErrors.push(
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
          );
        }
      }
      if (rollbackErrors.length) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; rollback incomplete: ${rollbackErrors.join("; ")}`,
          { cause: error },
        );
      }
      throw error;
    }
    return {
      status: "configured",
      activation: "unverified",
      files: plan.files,
      diagnostics: [],
    };
  } catch (error) {
    return {
      status: "failed",
      activation: "unverified",
      files: [],
      diagnostics: [
        `Codex configuration write failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}

export async function runCodexSetup(args: string[] = []): Promise<void> {
  const isApply = args.includes("--apply");
  const isDryRun = args.includes("--dry-run");
  const mcp = args.includes("--mcp");
  if (
    args[0] !== "--global" ||
    args[1] !== "--codex" ||
    isApply === isDryRun ||
    args.some(
      (arg) =>
        !["--global", "--codex", "--apply", "--dry-run", "--mcp"].includes(arg),
    )
  )
    throw new Error(
      "Usage: spekta setup --global --codex --dry-run|--apply [--mcp]",
    );
  const options = {
    home: process.env.HOME ?? "",
    path: process.env.PATH ?? "",
    cwd: process.cwd(),
    mcp,
  };
  if (isApply) {
    const result = await applyCodexSetup(options);
    if (result.status !== "configured") {
      for (const diagnostic of result.diagnostics)
        console.error(`Setup ${result.status}: ${diagnostic}`);
      process.exitCode = 1;
      return;
    }
    for (const file of result.files)
      console.log(`${file.action.toUpperCase()} ${file.path}`);
    console.log(
      `Codex configuration installed${mcp ? " with optional MCP registration" : ""}; runtime activation remains unverified.`,
    );
    return;
  }
  const plan = await previewCodexSetup(options);
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

export async function runCodexUninstall(args: string[] = []): Promise<void> {
  const isApply = args[2] === "--apply";
  if (
    args.length !== 3 ||
    args[0] !== "--global" ||
    args[1] !== "--codex" ||
    (!isApply && args[2] !== "--dry-run")
  ) {
    throw new Error(
      "Usage: spekta uninstall --global --codex --dry-run|--apply",
    );
  }
  const options = { home: process.env.HOME ?? "" };
  if (isApply) {
    const result = await applyCodexUninstall(options);
    if (result.status !== "uninstalled") {
      for (const diagnostic of result.diagnostics)
        console.error(`Uninstall ${result.status}: ${diagnostic}`);
      process.exitCode = 1;
      return;
    }
    for (const file of result.files)
      console.log(`${file.action.toUpperCase()} ${file.path}`);
    if (result.files.length === 0)
      console.log("No Spekta Codex artifacts were installed.");
    return;
  }
  const plan = await previewCodexUninstall(options);
  if (plan.status === "refused") {
    for (const diagnostic of plan.diagnostics)
      console.error(`Uninstall preview refused: ${diagnostic}`);
    process.exitCode = 1;
    return;
  }
  for (const file of plan.files) {
    console.log(`${file.action.toUpperCase()} ${file.path}`);
    if (file.action === "update") console.log(file.content);
  }
  if (plan.files.length === 0)
    console.log("No Spekta Codex artifacts were found.");
  console.log("Preview only; no Codex configuration or files were changed.");
}

export async function runCodexStatus(args: string[] = []): Promise<void> {
  if (args.length !== 2 || args[0] !== "--global" || args[1] !== "--codex") {
    throw new Error("Usage: spekta status --global --codex");
  }
  const status = await readCodexStatus({
    home: process.env.HOME ?? "",
    path: process.env.PATH ?? "",
    cwd: process.cwd(),
  });
  for (const [name, component] of Object.entries(status.components)) {
    console.log(`${name}: ${component.state}`);
    for (const detail of component.details) console.log(`  ${detail}`);
  }
  console.log(`trust: ${status.trust}`);
  console.log(`activation: ${status.activation}`);
  console.log("Runtime verification steps:");
  for (const step of status.verificationSteps) console.log(`- ${step}`);
}
