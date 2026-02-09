import { select } from "@inquirer/prompts";
import fs from "fs-extra";
import * as readline from "readline";
import { getEnv } from "../config";
import { openEditor } from "../editor-utils";
import { getTempPath } from "./fs-utils";
import chalk from "chalk";

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
  return new Promise((resolve) => {
    let currentBuffer = initialBuffer;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askForLine = () => {
      const instruction = chalk.green.dim(
        "Controls: 'e' (editor) | 's' (send) | 'c' (cancel) | 'q' (quit)",
      );
      const lineCount =
        currentBuffer === "" ? 0 : currentBuffer.split("\n").length;
      const promptText =
        lineCount === 0 ? `${instruction}\n1> ` : `${lineCount + 1}> `;

      rl.question(promptText, async (input) => {
        const trimmed = input.trim().toLowerCase();

        if (["c", "cancel"].includes(trimmed)) {
          rl.close();
          resolve({ action: "cancel", content: "" });
          return;
        }

        if (["s", "send", ".", ";;"].includes(trimmed)) {
          rl.close();
          resolve({ action: "send", content: currentBuffer });
          return;
        }

        if (["q", "quit"].includes(trimmed)) {
          rl.close();
          resolve({ action: "exit", content: "" });
          return;
        }

        if (trimmed === "e") {
          rl.close();
          const result = await openInEditorWithConfirmation(currentBuffer);

          // Propagate editor result without recursion
          resolve(result);
          return;
        }

        currentBuffer += (currentBuffer ? "\n" : "") + input;
        askForLine();
      });
    };

    askForLine();
  });
}
