import { select } from "@inquirer/prompts";
import chalk from "chalk";
import fs from "fs-extra";
import * as readline from "readline";
import { getEnv } from "../config";
import { openEditor } from "../editor-utils";
import { getTempPath } from "./fs-utils";

type InputResult = string;

async function openInEditorWithConfirmation(
  initialContent: string,
): Promise<{ action: "send" | "cancel" | "exit"; content: string }> {
  const env = await getEnv();
  const editorCmd = env.SPEKTA_EDITOR || "nano";
  const filePath = getTempPath("repl-input");

  try {
    await fs.ensureFile(filePath);
    await fs.writeFile(filePath, initialContent, "utf-8");

    await openEditor(editorCmd, filePath);

    const choice = (await select({
      message: `What would you like to do?`,
      choices: [
        { name: "Send the message", value: "send" },
        { name: "Cancel and start over", value: "cancel" },
        { name: "Exit", value: "exit" },
      ],
    })) as "send" | "cancel" | "exit";

    let content = "";
    if (choice === "send") {
      content = await fs.readFile(filePath, "utf-8");
    }

    await fs.remove(filePath).catch(() => {});

    return { action: choice, content };
  } catch (err: any) {
    console.warn(`Editor failed (${err.message}), returning to input...`);
    return { action: "cancel", content: "" };
  }
}

/**
 * Captures multi-line user input with forced completion semantics.
 *
 * GUARANTEES:
 * - Always returns a non-empty string OR the literal "exit" command
 * - Never returns null/undefined - user MUST provide input or exit
 * - Empty submissions ("s" with no content) trigger automatic retry
 * - Cancellations ("c") trigger automatic retry with cleared buffer
 *
 * EXIT CONDITIONS:
 * - Returns "exit" when user enters 'q' or 'quit'
 * - Returns non-empty string when user submits valid content via 's' or editor
 *
 * @returns {Promise<string>} Non-empty user input OR literal string "exit"
 * @throws {Error} Only on unrecoverable I/O failures (not on user cancellation)
 */
export async function getUserMessage(): Promise<InputResult> {
  let currentBuffer = "";

  // Top-level iterative control flow guarantees O(1) stack depth
  while (true) {
    const { action, content } = await runSingleInputSession(currentBuffer);

    switch (action) {
      case "send":
        const trimmed = content.trim();
        if (trimmed === "") {
          currentBuffer = "";
          console.log("Input cancelled (empty message).");
          continue; // Retry loop with cleared buffer
        }
        return trimmed;

      case "cancel":
        currentBuffer = "";
        console.log("Input cancelled.");
        continue; // Retry loop with cleared buffer

      case "exit":
        return "exit";
    }
  }
}

async function runSingleInputSession(
  initialBuffer: string,
): Promise<{ action: "send" | "cancel" | "exit"; content: string }> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Promisify rl.question for iterative usage
  const question = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  let currentBuffer = initialBuffer;

  try {
    while (true) {
      const instruction = chalk.green.dim(
        "Controls: 'e' (editor) | 's' (send) | 'c' (cancel) | 'q' (quit)",
      );
      const lineCount =
        currentBuffer === "" ? 0 : currentBuffer.split("\n").length;
      const promptText =
        lineCount === 0 ? `${instruction}\n1> ` : `${lineCount + 1}> `;

      const input = await question(promptText);
      const trimmed = input.trim().toLowerCase();

      if (["c", "cancel"].includes(trimmed)) {
        return { action: "cancel", content: "" };
      }

      if (["s", "send", ".", ";;"].includes(trimmed)) {
        return { action: "send", content: currentBuffer };
      }

      if (["q", "quit"].includes(trimmed)) {
        return { action: "exit", content: "" };
      }

      if (trimmed === "e") {
        return await openInEditorWithConfirmation(currentBuffer);
      }

      currentBuffer += (currentBuffer ? "\n" : "") + input;
    }
  } finally {
    rl.close();
  }
}
