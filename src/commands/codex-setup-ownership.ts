import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CODEX_USAGE_START,
  CODEX_USAGE_END,
  CODEX_HOOK_MATCHER,
  CodexSetupConflict,
  CodexSetupOptions,
} from "./codex-setup-types.js";

export function activeHookSources(options: CodexSetupOptions): string[] {
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

export function hasBashMatcher(matcher: unknown): boolean {
  if (matcher === undefined || matcher === "") return true;
  if (typeof matcher !== "string") throw new Error("matcher is not a string");
  try {
    return new RegExp(matcher).test("Bash");
  } catch {
    throw new Error("matcher is not a valid regular expression");
  }
}

export async function findRewriteConflicts(
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

export const ownedInstructions = `${CODEX_USAGE_START}
## Spekta workspace operations

Prefer the Spekta CLI for supported workspace inspection: use \`spekta ls\`, \`spekta read\`, \`spekta rg\`, and supported \`spekta git\` inspections. Use the configured Spekta MCP server only when the CLI is unavailable and MCP has been enabled.

Use Spekta for eligible file discovery, reading, searching, and supported Git inspection. Retrieve only the files and ranges needed to answer the current question; narrow broad searches by symbol, path, pattern, or glob, then read selected files. Unsupported or compound commands continue through the normal shell path. If Spekta rejects an operation under policy, do not retry it through MCP or the original executable.
The Codex hook routes supported standalone native \`rg\` requests through \`spekta rg\`, preserving repeated patterns, paths, case flags, ordered globs, and \`--\`. Unsupported shell forms and ripgrep options remain on the normal route. Literal read and search operands outside the event working directory, including home-installed skills and temporary fixtures, also remain on the normal shell route; use explicit RTK commands such as \`rtk cat\` or \`rtk rg\` for those reads when RTK is available. Normal host approval and filesystem permissions still apply. The hook classifies paths lexically, so workspace-spelled paths that escape through symlinks remain on the Spekta route. Spekta runs search through RTK and applies its own output formatting, eligible-file restrictions, and response budget; never retry an operation that Spekta rejects through the original route. Use MCP tool \`spekta_rg\` with separate \`patterns\`, \`paths\`, \`globs\`, and \`case_mode\` values when MCP is enabled.
MCP registration changes runtime setup only. Start a new Codex session to load an opt-in server; it does not dynamically add tools to an existing session.
${CODEX_USAGE_END}`;

export function buildMcpConfig(
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

export function removeMcpConfig(original: string): string | undefined {
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

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function isRecognizedOwnedHook(value: unknown): boolean {
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

export function buildHooks(
  original: string | undefined,
  executable: string,
): string {
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

export function buildInstructions(original: string | undefined): string {
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

export function removeOwnedInstructions(original: string): string | undefined {
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

export function removeOwnedHooks(original: string): string | undefined {
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
