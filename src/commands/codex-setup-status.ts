import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { buildMetadata, runningIdentity } from "../build-identity";
import { resolveAllowanceSettings } from "../core/config/allowance";
import { getEnv } from "../core/config/env";
import {
  CODEX_USAGE_START,
  CODEX_USAGE_END,
  CODEX_HOOK_MATCHER,
  CodexSetupOptions,
} from "./codex-setup-types.js";
import {
  CodexComponentState,
  CodexComponentStatus,
  CodexStatus,
} from "./codex-setup-status-types.js";
import {
  findRewriteConflicts,
  readOptional,
  isRecognizedOwnedHook,
  buildInstructions,
} from "./codex-setup-ownership.js";

export const execFile = promisify(execFileCallback);

export async function findHook(pathValue: string): Promise<string | undefined> {
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

export async function findExecutable(
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

export async function verifyCodexSessionCwdContract(
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

export function componentStatus(
  state: CodexComponentState,
  ...details: string[]
): CodexComponentStatus {
  return { state, details };
}

export async function inspectOwnedHook(path: string): Promise<
  CodexComponentStatus & {
    recognizedRouting?: true;
  }
> {
  let content: string | undefined;
  try {
    content = await readOptional(path);
  } catch {
    return componentStatus(
      "broken",
      "Unable to read global hook configuration; inspect it manually.",
    );
  }
  if (content === undefined) return componentStatus("absent");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return componentStatus(
      "conflicting",
      "Global hook configuration contains malformed JSON.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return componentStatus(
      "conflicting",
      "Global hook configuration has an ambiguous structure.",
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
      "Global hook configuration has an ambiguous PreToolUse definition.",
    );
  const owned = entries.filter((entry) =>
    JSON.stringify(entry).includes("spekta-codex-hook"),
  );
  if (owned.length === 0) return componentStatus("absent");
  if (owned.length !== 1 || !isRecognizedOwnedHook(owned[0]))
    return componentStatus(
      "conflicting",
      "Global hook configuration has malformed or duplicate Spekta hook ownership.",
    );
  const command = JSON.parse(
    String(
      (
        owned[0] as {
          hooks: {
            command: string;
          }[];
        }
      ).hooks[0].command,
    ),
  ) as string;
  try {
    await access(command, constants.X_OK);
  } catch {
    return {
      ...componentStatus(
        "broken",
        "Configured Spekta hook executable is missing or not executable.",
      ),
      recognizedRouting: true,
    };
  }
  return {
    ...componentStatus("configured", "Owned global Spekta hook is configured."),
    recognizedRouting: true,
  };
}

export async function inspectInstructions(
  path: string,
): Promise<CodexComponentStatus> {
  let content: string | undefined;
  try {
    content = await readOptional(path);
  } catch {
    return componentStatus(
      "broken",
      "Unable to read global usage instructions; inspect them manually.",
    );
  }
  if (content === undefined) return componentStatus("absent");
  const starts = content.split(CODEX_USAGE_START).length - 1;
  const ends = content.split(CODEX_USAGE_END).length - 1;
  if (starts === 0 && ends === 0) return componentStatus("absent");
  if (starts !== 1 || ends !== 1)
    return componentStatus(
      "conflicting",
      "Global usage instructions have malformed or duplicate Spekta ownership markers.",
    );
  try {
    const owned = buildInstructions(content);
    return owned === content
      ? componentStatus(
          "configured",
          "Owned global usage instructions are present.",
        )
      : componentStatus(
          "conflicting",
          "Global usage instructions contain unfamiliar changes to the Spekta instructions.",
        );
  } catch {
    return componentStatus(
      "conflicting",
      "Global usage instructions could not be interpreted; inspect them manually.",
    );
  }
}

export async function executableIsAvailable(
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

export async function inspectMcp(
  path: string,
  pathValue: string,
): Promise<CodexComponentStatus> {
  let content: string | undefined;
  try {
    content = await readOptional(path);
  } catch {
    return componentStatus(
      "broken",
      "Unable to read global MCP configuration; inspect it manually.",
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
        "Global configuration has an ambiguous spekta MCP section; inspect it manually.",
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
      "Configured MCP executable is missing or not executable.",
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
  let configurationResolved = true;
  try {
    await getEnv(options.cwd);
  } catch {
    configurationResolved = false;
  }
  const allowances = {
    read: resolveAllowanceSettings("read"),
    search: resolveAllowanceSettings("search"),
    list: resolveAllowanceSettings("list"),
    git: resolveAllowanceSettings("git"),
  };
  if (!configurationResolved) {
    for (const settings of Object.values(allowances)) {
      settings.defaultConfiguration = "unresolved";
      settings.ceilingConfiguration = "unresolved";
    }
  }
  const codexDirectory = join(options.home, ".codex");
  const hooksPath = join(codexDirectory, "hooks.json");
  const instructionsPath = join(codexDirectory, "AGENTS.md");
  const { recognizedRouting, ...ownedHook } = await inspectOwnedHook(hooksPath);
  let hooks: CodexComponentStatus = ownedHook;
  const routing: CodexStatus["routing"] = recognizedRouting
    ? {
        event: "PreToolUse",
        matcher: CODEX_HOOK_MATCHER,
        target: "spekta-codex-hook",
      }
    : "unknown";
  const conflicts = await findRewriteConflicts(options);
  if (conflicts.length && hooks.state !== "conflicting") {
    hooks = componentStatus(
      "conflicting",
      ...conflicts.slice(0, 20).map(({ message }) => message),
    );
  }
  return {
    running: await runningIdentity(options.cwd ?? process.cwd()),
    build: buildMetadata,
    sourceCorrespondence: "unknown",
    routing,
    components: {
      hooks,
      instructions: await inspectInstructions(instructionsPath),
      mcp: await inspectMcp(join(codexDirectory, "config.toml"), options.path),
    },
    trust: "unknown",
    activation: "unknown",
    allowances,
    verificationSteps: [
      "Start a new supported Codex session with this workspace open.",
      "Run a supported standalone inspection command and confirm the Spekta hook runs exactly once.",
      "Confirm Codex has trusted and loaded the configured hook and usage instructions; configuration alone does not prove activation.",
    ],
  };
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
  console.log(`executable: ${status.running.executable}`);
  console.log(`artifact SHA-256: ${status.running.artifactSha256}`);
  console.log(`build version: ${status.build.version}`);
  console.log(`build source revision: ${status.build.sourceRevision}`);
  console.log(`build source state: ${status.build.sourceState}`);
  console.log(`source correspondence: ${status.sourceCorrespondence}`);
  console.log(
    `configured hook routing: ${status.routing === "unknown" ? "unknown" : `${status.routing.event} / ${status.routing.matcher} / ${status.routing.target}`}`,
  );
  for (const [name, component] of Object.entries(status.components)) {
    console.log(`${name}: ${component.state}`);
    for (const detail of component.details) console.log(`  ${detail}`);
  }
  console.log(`trust: ${status.trust}`);
  console.log(`activation: ${status.activation}`);
  console.log("Effective request allowances (tokens):");
  for (const [family, settings] of Object.entries(status.allowances)) {
    const configuration = [
      settings.defaultConfiguration === "invalid"
        ? "default setting invalid; fallback used"
        : settings.defaultConfiguration === "unresolved"
          ? "configuration unresolved; effective value may use fallback"
          : undefined,
      settings.ceilingConfiguration === "invalid"
        ? "ceiling setting invalid; fallback used"
        : settings.ceilingConfiguration === "unresolved"
          ? "configuration unresolved; effective value may use fallback"
          : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `  ${family}: default ${settings.defaultTokens}; ceiling ${settings.ceilingTokens}; caller allowance ${settings.honorsRequestAllowance ? "honored" : "not supported"}${configuration ? `; ${configuration}` : ""}`,
    );
  }
  console.log("Runtime verification steps:");
  for (const step of status.verificationSteps) console.log(`- ${step}`);
}
