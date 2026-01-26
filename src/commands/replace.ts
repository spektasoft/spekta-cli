import crypto from "crypto";
import fs from "fs-extra";
import { formatFile } from "../utils/format-utils";
import { Logger } from "../utils/logger";
import {
  applyReplacements,
  parseReplaceBlocks,
  ReplaceRequest,
} from "../utils/replace-utils";

const MAX_BLOCKS_PER_REPLACE = 50;
import { validateEditAccess } from "../utils/security";

/**
 * Core logic for applying replacements to a file.
 * Returns the updated file content.
 */
export async function getReplaceContent(
  request: ReplaceRequest,
  blocksInput?: string,
): Promise<{
  content: string;
  appliedCount: number;
  message: string;
  totalLines: number;
}> {
  try {
    // Validate file access and git tracking
    await validateEditAccess(request.path);

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
    const result = await applyReplacements(request.path, blocks);

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
  } catch (error: any) {
    let cleanMessage = error.message;

    // Truncate or simplify common matching errors
    if (cleanMessage.includes("search block was not found")) {
      cleanMessage = `The SEARCH block could not be found. Ensure the search text matches the file content exactly, including indentation.`;
    } else if (cleanMessage.includes("Ambiguous match")) {
      cleanMessage = `Multiple occurrences of the SEARCH block were found. Please provide more context lines to ensure a unique match.`;
    } else if (cleanMessage.includes("No SEARCH/REPLACE blocks found")) {
      cleanMessage =
        "No valid SEARCH/REPLACE blocks were found. Make sure to use the correct format with `<<<<<<< SEARCH\n{old_string}\n=======\n{new_string}\n>>>>>>> REPLACE` markers.";
    } else if (cleanMessage.includes("Invalid format")) {
      cleanMessage = `Invalid format detected: ${error.message}`;
    }

    throw new Error(cleanMessage);
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
): Promise<{ message: string; appliedCount: number }> {
  try {
    // 1. Validate access
    await validateEditAccess(request.path);

    // 2. Read original content + hash
    const originalContent = await fs.readFile(request.path, "utf-8");
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
    } = await getReplaceContent(request, "");

    if (appliedCount === 0) {
      return {
        message: "No changes applied (blocks matched nothing)",
        appliedCount: 0,
      };
    }

    // 5. Canonicalize formatting
    const content = await formatFile(request.path, replacedContent);

    // 6. Stale-write check
    const currentContent = await fs.readFile(request.path, "utf-8");
    if (getFileHash(currentContent) !== initialHash) {
      throw new Error("File was modified by another process during execution.");
    }

    // 7. Write
    await fs.writeFile(request.path, content, "utf-8");

    return { message, appliedCount };
  } catch (error: any) {
    const errMsg = `Replacement failed: ${error.message}`;
    Logger.error(errMsg);
    throw new Error(errMsg);
  }
}

/**
 * CLI command for replace operation.
 */
export async function runReplace(args: string[] = []): Promise<void> {
  try {
    if (args.length < 2) {
      Logger.error(
        "Usage: spekta replace <file> <blocks>\n" +
          "Example: spekta replace src/file.ts 'blocks content'",
      );
      process.exitCode = 1;
      return;
    }

    const filePath = args[0];
    const blocksInput = args.slice(1).join(" ");

    const request: ReplaceRequest = { path: filePath, blocks: [] };

    const { message, appliedCount } = await executeSafeReplace(
      request,
      blocksInput,
    );

    process.stdout.write(message);
    if (appliedCount > 0) {
      Logger.info(
        `Successfully applied ${appliedCount} replacement(s) to ${filePath}`,
      );
    }
  } catch (error: any) {
    // Graceful error reporting without block dumps
    Logger.error(`Action Failed: ${error.message}`);
    process.exitCode = 1;
  }
}
