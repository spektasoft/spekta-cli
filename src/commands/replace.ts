import fs from "fs-extra";
import { Logger } from "../utils/logger";
import { parseFilePathWithRange } from "../utils/read-utils";
import {
  applyReplacements,
  parseReplaceBlocks,
  ReplaceRequest,
} from "../utils/replace-utils";
import { validateEditAccess } from "../utils/security";

/**
 * Core logic for applying replacements to a file.
 * Returns the updated file content.
 */
export async function getReplaceContent(
  request: ReplaceRequest,
  blocksInput: string,
): Promise<{ content: string; appliedCount: number }> {
  // Validate file access and git tracking
  await validateEditAccess(request.path);

  // Parse replacement blocks
  const blocks = parseReplaceBlocks(blocksInput);

  // Apply replacements
  const result = await applyReplacements(request.path, request.range, blocks);

  return result;
}

/**
 * CLI command for replace operation.
 */
export async function runReplace(args: string[] = []): Promise<void> {
  try {
    if (args.length < 2) {
      Logger.error(
        "Usage: spekta replace <file[start,end]> <blocks>\n" +
          "Example: spekta replace src/file.ts[10,50] 'blocks content'",
      );
      process.exitCode = 1;
      return;
    }

    const fileArg = args[0];
    const blocksInput = args.slice(1).join(" ");

    // Parse file path and range
    const parsed = parseFilePathWithRange(fileArg);

    if (!parsed.range) {
      Logger.error(
        "Range is required for replace operations. Use format: file.ts[start,end]",
      );
      process.exitCode = 1;
      return;
    }

    const request: ReplaceRequest = {
      path: parsed.path,
      range: parsed.range,
      blocks: [], // Will be parsed in getReplaceContent
    };

    // Execute replacement
    const result = await getReplaceContent(request, blocksInput);

    // Write updated content back to file
    await fs.writeFile(request.path, result.content, "utf-8");

    Logger.info(
      `Successfully applied ${result.appliedCount} replacement(s) to ${request.path}`,
    );
  } catch (error: any) {
    Logger.error(`Replace failed: ${error.message}`);
    process.exitCode = 1;
  }
}
