import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { Logger } from "../utils/logger";
import {
  applyReplacements,
  containsConflictMarkers,
  parseReplaceBlocks,
  ReplaceRequest,
} from "../utils/replace-utils";
import { validateEditAccess } from "../utils/security";

/**
 * Extracts a window of lines around the change for context.
 */
function getContextWindow(
  content: string,
  startLine: number,
  endLine: number,
  padding: number = 5,
): string {
  const lines = content.split(/\r?\n/);
  const windowStart = Math.max(0, startLine - padding - 1);
  const windowEnd = Math.min(lines.length, endLine + padding);
  return lines.slice(windowStart, windowEnd).join("\n");
}

/**
 * Core logic for applying replacements to a file.
 * Returns the updated file content.
 */
export async function getReplaceContent(
  request: ReplaceRequest,
  blocksInput: string,
): Promise<{
  content: string;
  appliedCount: number;
  message: string;
  totalLines: number;
}> {
  try {
    // Validate file access and git tracking
    await validateEditAccess(request.path);

    // Parse replacement blocks
    const blocks = parseReplaceBlocks(blocksInput);

    // Apply replacements
    const result = await applyReplacements(request.path, blocks);

    const ext = path.extname(request.path).slice(1) || "txt";
    let message = "";
    const PADDING = 3; // Reduced from 5 to 3 for less verbosity

    for (const block of result.appliedBlocks) {
      const contextStart = Math.max(1, block.startLine - PADDING);
      const contextEnd = Math.min(result.totalLines, block.endLine + PADDING);

      message += `#### ${request.path} (lines ${contextStart}-${contextEnd} of ${result.totalLines})\n`;
      message += `**Updated Context:**\n\`\`\`${ext}\n`;
      message += getContextWindow(
        result.content,
        block.startLine,
        block.endLine,
        PADDING,
      );
      message += `\n\`\`\`\n\n`;
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
      cleanMessage = `The SEARCH block could not be found in ${request.path}. Ensure the search text matches the file content exactly, including indentation.`;
    } else if (cleanMessage.includes("Ambiguous match")) {
      cleanMessage = `Multiple occurrences of the SEARCH block were found in ${request.path}. Please provide more context lines to ensure a unique match.`;
    } else if (cleanMessage.includes("No SEARCH/REPLACE blocks found")) {
      cleanMessage =
        "No valid SEARCH/REPLACE blocks were found. Make sure to use the correct format with <<<<<<< SEARCH, =======, and >>>>>>> REPLACE markers.";
    } else if (cleanMessage.includes("Invalid format")) {
      cleanMessage = `Invalid format detected: ${error.message}`;
    }

    throw new Error(cleanMessage);
  }
}

const getFileHash = (content: string) =>
  crypto.createHash("md5").update(content).digest("hex");

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

    // Validate file access and git tracking early
    await validateEditAccess(filePath);

    const request: ReplaceRequest = {
      path: filePath,
      blocks: [], // Will be parsed in getReplaceContent
    };

    // Step 3: Check for conflict markers early
    const originalContent = await fs.readFile(request.path, "utf-8");
    if (containsConflictMarkers(originalContent)) {
      Logger.error(
        `File ${request.path} contains Git conflict markers. Resolve them before editing.`,
      );
      process.exitCode = 1;
      return;
    }

    // Step 2: Get initial hash for stale-write check
    const initialHash = getFileHash(originalContent);

    // Execute replacement
    const { content, message, appliedCount } = await getReplaceContent(
      request,
      blocksInput,
    );

    // Before writing, verify file hasn't changed (stale-write check)
    const currentContent = await fs.readFile(request.path, "utf-8");
    if (getFileHash(currentContent) !== initialHash) {
      throw new Error("File was modified by another process during execution.");
    }

    // Write updated content back to file
    await fs.writeFile(request.path, content, "utf-8");

    // Output the rich feedback to the console
    process.stdout.write(message);
    Logger.info(
      `Successfully applied ${appliedCount} replacement(s) to ${request.path}`,
    );
  } catch (error: any) {
    // Graceful error reporting without block dumps
    Logger.error(`Action Failed: ${error.message}`);
    process.exitCode = 1;
  }
}
