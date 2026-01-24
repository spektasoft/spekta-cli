import { select } from "@inquirer/prompts";
import fs from "fs-extra";
import * as readline from "readline";
import { getEnv } from "../config";
import { openEditor } from "../editor-utils";
import { getTempPath } from "./fs-utils";
import chalk from "chalk";

type InputResult = string | null;

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

  const runInputLoop = (): Promise<InputResult> => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const askForLine = () => {
        const instruction = chalk.green.dim(
          "Type your message. 'e' to edit in external editor, 's'/'send'/'.'/';;' to submit, 'c'/'cancel' to abort, 'q'/'quit' to exit",
        );
        const promptText =
          currentBuffer === ""
            ? `${instruction}\n1> `
            : `${currentBuffer.split("\n").length + 1}> `;
        rl.question(promptText, async (input) => {
          const trimmed = input.trim().toLowerCase();

          if (["c", "cancel"].includes(trimmed)) {
            rl.close();
            console.log("Input cancelled.");
            resolve(null);
            return;
          }

          if (["s", "send", ".", ";;"].includes(trimmed)) {
            rl.close();
            const content = currentBuffer.trim();
            resolve(content || null);
            return;
          }

          if (["q", "quit"].includes(trimmed)) {
            rl.close();
            resolve("exit");
            return;
          }

          if (trimmed === "e") {
            rl.close();
            const result = await openInEditorWithConfirmation(currentBuffer);

            if (result.action === "send") {
              resolve(result.content.trim() || null);
            } else if (result.action === "exit") {
              resolve("exit");
            } else {
              // cancel: reset buffer and restart loop
              currentBuffer = "";
              resolve(await runInputLoop());
            }
            return;
          }

          currentBuffer += (currentBuffer ? "\n" : "") + input;
          askForLine();
        });
      };

      askForLine();
    });
  };

  return runInputLoop();
}
