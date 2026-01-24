import * as readline from "readline";
import { getEnv } from "../config";
import { getTempPath } from "./fs-utils";
import fs from "fs-extra";
import { openEditor } from "../editor-utils";
import { select } from "@inquirer/prompts";

type InputResult = string | null; // string = submitted content, null = cancelled

export async function getUserMessage(
  prompt: string = "You:",
): Promise<InputResult> {
  const env = await getEnv();
  const editorCmd = env.SPEKTA_EDITOR;

  if (editorCmd) {
    try {
      const filePath = getTempPath("repl-input-");
      await fs.ensureFile(filePath);
      await fs.writeFile(filePath, "", "utf-8"); // start empty

      await openEditor(editorCmd, filePath);

      const choice = await select({
        message: `Write your message and save it.`,
        choices: [
          { name: "Send the message", value: 0 },
          { name: "Cancel and start over", value: 1 },
          { name: "Exit", value: 2 },
        ],
      });

      let content = "";
      if (choice === 0) {
        content = await fs.readFile(filePath, "utf-8");
      } else if (choice === 2) {
        content = "exit";
      }

      // Clean up immediately after read
      await fs.remove(filePath).catch(() => {
        /* silent */
      });

      if (content.trim() === "") {
        console.log("Input cancelled.");
        return null;
      }

      return content;
    } catch (err: any) {
      console.warn(
        `Editor failed (${err.message}), falling back to console input...`,
      );
      // proceed to fallback
    }
  }

  // Fallback: improved readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const lines: string[] = [];
    const askForLine = () => {
      const promptText =
        lines.length === 0
          ? `${prompt}\n(Multiline - 's'/'send'/'.'/';;' to submit, 'c'/'cancel' to abort, 'e'/'exit' to quit)\n> `
          : `${lines.length + 1}> `;
      rl.question(promptText, (input) => {
        const trimmed = input.trim().toLowerCase();

        if (["c", "cancel"].includes(trimmed)) {
          rl.close();
          console.log("Input cancelled.");
          resolve(null);
          return;
        }

        if (["s", "send", ".", ";;"].includes(trimmed)) {
          rl.close();
          const content = lines.join("\n").trim();
          resolve(content || null); // treat empty as cancel
          return;
        }

        if (["e", "exit"].includes(trimmed)) {
          rl.close();
          resolve("exit");
          return;
        }

        lines.push(input);
        askForLine();
      });
    };
    askForLine();
  });
}
