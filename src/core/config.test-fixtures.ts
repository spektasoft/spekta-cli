import fs from "fs-extra";
import path from "path";

export const MINIMAL_TOOL_YAML = `\
name: spekta_read
description: |
  Read files.
params:
  paths:
    description: "Space-separated file paths."
xml_example: |
  <read path="src/main.ts" />
`;

export const MINIMAL_REPL_MD = `\
You are a pair programmer.

{{ tools }}
`;

export async function seedAssetFixtures(rootDir: string): Promise<void> {
  const toolsDir = path.join(rootDir, "templates", "tools");
  const promptsDir = path.join(rootDir, "templates", "prompts");

  await fs.ensureDir(toolsDir);
  await fs.ensureDir(promptsDir);

  await fs.writeFile(path.join(toolsDir, "read.yaml"), MINIMAL_TOOL_YAML);
  await fs.writeFile(
    path.join(toolsDir, "replace.yaml"),
    MINIMAL_TOOL_YAML.replace("spekta_read", "spekta_replace"),
  );
  await fs.writeFile(
    path.join(toolsDir, "write.yaml"),
    MINIMAL_TOOL_YAML.replace("spekta_read", "spekta_write"),
  );
  await fs.writeFile(
    path.join(toolsDir, "grep.yaml"),
    MINIMAL_TOOL_YAML.replace("spekta_read", "spekta_grep"),
  );

  await fs.writeFile(path.join(promptsDir, "repl.md"), MINIMAL_REPL_MD);
}
