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
  const isApply = args[2] === "--apply";
  if (
    args.length !== 3 ||
    args[0] !== "--global" ||
    args[1] !== "--codex" ||
    (!isApply && args[2] !== "--dry-run")
  ) {
    throw new Error("Usage: spekta setup --global --codex --dry-run|--apply");
  }
  const options = {
    home: process.env.HOME ?? "",
    path: process.env.PATH ?? "",
    cwd: process.cwd(),
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
      "Codex configuration installed; runtime activation remains unverified.",
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
