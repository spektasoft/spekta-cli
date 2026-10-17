import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CodexSetupFile,
  CodexSetupOptions,
  CodexUninstallPlan,
  CodexUninstallResult,
} from "./codex-setup-types.js";
import {
  removeMcpConfig,
  readOptional,
  removeOwnedInstructions,
  removeOwnedHooks,
} from "./codex-setup-ownership.js";

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
  const originals: Array<{
    file: CodexSetupFile;
    content: string;
  }> = [];
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
