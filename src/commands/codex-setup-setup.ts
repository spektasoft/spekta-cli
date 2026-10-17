import { lstat, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CodexSetupPlan,
  CodexSetupOptions,
  CodexSetupApplyResult,
} from "./codex-setup-types.js";
import {
  findRewriteConflicts,
  buildMcpConfig,
  readOptional,
  buildHooks,
  buildInstructions,
} from "./codex-setup-ownership.js";
import {
  findHook,
  findExecutable,
  verifyCodexSessionCwdContract,
} from "./codex-setup-status.js";

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
