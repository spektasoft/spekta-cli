import fs from "fs-extra";
import path from "path";
import { resolveCommandInput } from "../utils/cli-input";
import { Logger } from "../utils/logger";
import { validateParentDirForCreate } from "../utils/security";
import { formatFileInPlace } from "../utils/format-utils";
import { validatePathAccessForWrite } from "../utils/security";
import { resolveWorkspace, type WorkspaceContext } from "../utils/workspace";
import {
  boundMutationSuccess,
  mutationFailure,
  type MutationOutcome,
} from "./mutation-outcomes";

export async function getWriteContent(
  filePath: string,
  content: string,
  workspace?: WorkspaceContext,
): Promise<{ success: boolean; message: string }> {
  const resolvedWorkspace = await resolveWorkspace(workspace);

  // 1. Security checks FIRST (prevent information leakage)
  const absolutePath = await validatePathAccessForWrite(
    filePath,
    resolvedWorkspace,
  );
  // 2. Validate parent directory ancestry (allows creation of nested dirs)
  await validateParentDirForCreate(filePath, resolvedWorkspace);

  // 3. Create parent directories, then exclusively create the file
  await fs.ensureDir(path.dirname(absolutePath));

  try {
    await fs.writeFile(absolutePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;

    if (code === "EEXIST") {
      return {
        success: false,
        message: `Write failed: File already exists at ${filePath}. Cannot overwrite with this tool.`,
      };
    }

    throw err;
  }

  // 4. Format in-place
  try {
    if (workspace) await formatFileInPlace(absolutePath, workspace);
    else await formatFileInPlace(absolutePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: true,
      message:
        `Successfully created and wrote ${filePath}\n` +
        `Warning: Content was saved to "${filePath}", but formatting failed: ${message}. Retrying the mutation is unnecessary.`,
    };
  }

  return {
    success: true,
    message: `Successfully created and wrote ${filePath}`,
  };
}

export async function getWriteOutcome(
  filePath: string,
  content: string,
  workspace?: WorkspaceContext,
  requestId?: string | number,
): Promise<MutationOutcome> {
  try {
    const result = await getWriteContent(filePath, content, workspace);
    if (!result.success) {
      return mutationFailure(
        "policy_rejection",
        "The target already exists; create leaves existing files unchanged.",
        requestId,
      );
    }
    const message = result.message.replace(
      /(formatting failed: ).*(\. Retrying)/s,
      "$1formatter could not process the saved content$2",
    );
    return boundMutationSuccess(
      { message, changed: true, cliOutput: `[INFO] ${message}\n` },
      requestId,
    );
  } catch {
    return mutationFailure(
      "policy_rejection",
      "Mutation rejected by workspace policy.",
      requestId,
    );
  }
}

export async function runWrite(args?: string[]): Promise<void> {
  const usageMessage =
    "Usage: spekta write <relative/path/to/newfile.ext> [content]\n" +
    "Content may be passed as an argument or provided via stdin.";

  try {
    const resolved = await resolveCommandInput(args, usageMessage);
    if (!resolved) {
      return;
    }

    const outcome = await getWriteOutcome(resolved.filePath, resolved.content);
    if (outcome.status === "success") {
      Logger.info(outcome.value.message);
    } else {
      Logger.error(outcome.message);
      process.exitCode = 1;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`Write failed: ${message}`);
    process.exitCode = 1;
  }
}
