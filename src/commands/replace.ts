import crypto from "crypto";
import fs from "fs-extra";
import { formatFileInPlace } from "../utils/format-utils";
import { Logger } from "../utils/logger";
import {
  applyReplacements,
  parseReplaceBlocks,
  ReplaceRequest,
} from "../utils/replace-utils";
import { resolveCommandInput } from "../utils/cli-input";
import { validateEditAccess } from "../utils/security";
import { resolveWorkspace, type WorkspaceContext } from "../utils/workspace";

const MAX_BLOCKS_PER_REPLACE = 50;

/**
 * Core logic for applying replacements to a file.
 * Returns the updated file content.
 */
export async function getReplaceContent(
  request: ReplaceRequest,
  blocksInput?: string,
  workspace?: WorkspaceContext,
): Promise<{
  content: string;
  appliedCount: number;
  message: string;
  totalLines: number;
}> {
  const resolvedWorkspace = await resolveWorkspace(workspace);
  const filePath = await validateEditAccess(request.path, resolvedWorkspace);
  return getReplaceContentForPath(request, blocksInput, filePath);
}

async function getReplaceContentForPath(
  request: ReplaceRequest,
  blocksInput: string | undefined,
  filePath: string,
): Promise<{
  content: string;
  appliedCount: number;
  message: string;
  totalLines: number;
}> {
  try {
    // Use provided blocks or parse from input
    const blocks = blocksInput
      ? parseReplaceBlocks(blocksInput)
      : request.blocks;

    if (blocks.length === 0) {
      throw new Error("No replacement blocks provided or parsed.");
    }

    if (blocks.length > MAX_BLOCKS_PER_REPLACE) {
      throw new Error(
        `Too many replacement blocks (${blocks.length} > ${MAX_BLOCKS_PER_REPLACE} max)`,
      );
    }

    // Apply replacements
    const result = await applyReplacements(filePath, blocks);

    let message = "";
    const MAX_RANGES_TO_DISPLAY = 5;

    if (result.appliedBlocks.length > 0) {
      const ranges = result.appliedBlocks
        .slice(0, MAX_RANGES_TO_DISPLAY)
        .map((block) => `${block.startLine}-${block.endLine}`)
        .join(", ");

      message = `Replaced ${result.appliedBlocks.length} block(s) in ${request.path}`;
      if (result.appliedBlocks.length <= MAX_RANGES_TO_DISPLAY) {
        message += `\nLine ranges: ${ranges}`;
      } else {
        message += `\nFirst ${MAX_RANGES_TO_DISPLAY} line ranges: ${ranges} (and ${result.appliedBlocks.length - MAX_RANGES_TO_DISPLAY} more)`;
      }
    } else {
      message = "0 blocks applied - no search regions matched";
    }

    return {
      content: result.content,
      appliedCount: result.appliedBlocks.length,
      message,
      totalLines: result.totalLines,
    };
  } catch (error: unknown) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    let cleanMessage = rawMessage;

    // Truncate or simplify common matching errors
    if (cleanMessage.includes("search block was not found")) {
      cleanMessage = `The SEARCH block could not be found. Ensure the search text matches the file content exactly, including indentation.`;
    } else if (cleanMessage.includes("Ambiguous match")) {
      cleanMessage = `Multiple occurrences of the SEARCH block were found. Please provide more context lines to ensure a unique match.`;
    } else if (cleanMessage.includes("No SEARCH/REPLACE blocks found")) {
      cleanMessage =
        "No valid SEARCH/REPLACE blocks were found. Make sure to use the correct format with `<<<<<<< SEARCH\n{old_string}\n=======\n{new_string}\n>>>>>>> REPLACE` markers.";
    } else if (cleanMessage.includes("Invalid format")) {
      cleanMessage = `Invalid format detected: ${rawMessage}`;
    }

    throw new Error(cleanMessage, { cause: error });
  }
}

const getFileHash = (content: string) =>
  crypto.createHash("md5").update(content).digest("hex");

/**
 * Reusable function for programmatic replace operations with full safety checks.
 */
export async function executeSafeReplace(
  request: ReplaceRequest,
  blocksInput?: string,
  workspace?: WorkspaceContext,
): Promise<{ message: string; appliedCount: number }> {
  try {
    // 1. Validate access
    const resolvedWorkspace = await resolveWorkspace(workspace);
    const filePath = await validateEditAccess(request.path, resolvedWorkspace);

    // 2. Read original content + hash
    const originalContent = await fs.readFile(filePath, "utf-8");
    const initialHash = getFileHash(originalContent);

    // 3. Ensure we have blocks (parse if provided as string)
    let blocks = request.blocks;
    if (blocks.length === 0 && blocksInput) {
      blocks = parseReplaceBlocks(blocksInput);
      request.blocks = blocks;
    }

    if (blocks.length === 0) {
      throw new Error("No replacement blocks provided or parsed.");
    }

    // 4. Apply replacements
    const {
      content: replacedContent,
      message,
      appliedCount,
    } = await getReplaceContentForPath(request, "", filePath);

    if (appliedCount === 0) {
      return {
        message: "No changes applied (blocks matched nothing)",
        appliedCount: 0,
      };
    }

    // 5. Stale-write check (Performed BEFORE writing unformatted content)
    const currentContent = await fs.readFile(filePath, "utf-8");
    if (getFileHash(currentContent) !== initialHash) {
      throw new Error("File was modified by another process during execution.");
    }

    // 6. Write unformatted content
    await fs.writeFile(filePath, replacedContent, "utf-8");

    // 7. Formatting is best-effort after the content has been saved.
    try {
      if (workspace) await formatFileInPlace(filePath, workspace);
      else await formatFileInPlace(filePath);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        message:
          `${message}\n` +
          `Warning: Content was saved to "${request.path}", but formatting failed: ${reason}. Retrying the mutation is unnecessary.`,
        appliedCount,
      };
    }

    return { message, appliedCount };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const errMsg = `Replacement failed for "${request.path}": ${message}`;
    throw new Error(errMsg, { cause: error });
  }
}

/**
 * CLI command for replace operation.
 */
export async function runReplace(args?: string[]): Promise<void> {
  const usageMessage =
    "Usage: spekta replace <relative/path/to/file.ext> [blocks]\n" +
    "Blocks may be passed as arguments or provided via stdin.";

  try {
    const resolved = await resolveCommandInput(args, usageMessage);
    if (!resolved) {
      return;
    }

    const request: ReplaceRequest = { path: resolved.filePath, blocks: [] };

    const { message, appliedCount } = await executeSafeReplace(
      request,
      resolved.content,
    );

    process.stdout.write(message);
    if (appliedCount > 0) {
      Logger.info(
        `Successfully applied ${appliedCount} replacement(s) to ${resolved.filePath}`,
      );
    }
  } catch (error: unknown) {
    // Graceful error reporting without block dumps
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(`Action Failed: ${message}`);
    process.exitCode = 1;
  }
}
