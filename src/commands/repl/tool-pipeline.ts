import { checkbox } from "@inquirer/prompts";
import boxen from "boxen";
import chalk from "chalk";
import { executeTool, parseToolCalls } from "../../utils/agent-utils";

export interface ToolPipelineResult {
  pendingToolResults: string;
  shouldAutoTriggerAI: boolean;
}

export function sanitizeToolContent(
  content: string,
  isInterrupted: boolean,
): string {
  const marker = "\n\n[Response interrupted by user]";
  if (isInterrupted && content.endsWith(marker)) {
    return content.slice(0, -marker.length);
  }
  return content;
}

export async function coordinateToolCalls(
  assistantContent: string,
  isInterrupted: boolean = false,
): Promise<ToolPipelineResult> {
  const sanitizedContent = sanitizeToolContent(assistantContent, isInterrupted);
  const toolCalls = parseToolCalls(sanitizedContent);

  if (!toolCalls || toolCalls.length === 0) {
    return { pendingToolResults: "", shouldAutoTriggerAI: false };
  }

  process.stdout.write(chalk.reset(""));
  console.log(
    boxen(
      toolCalls
        .map((c, i) => `${i + 1}. [${c.type.toUpperCase()}] ${c.path}`)
        .join("\n"),
      { title: "Proposed Tools", borderColor: "cyan", dimBorder: true },
    ),
  );

  const selectedTools = await checkbox({
    message: "Select tools to execute:",
    choices: toolCalls.map((c, i) => ({
      name: `${c.type}: ${c.path}`,
      value: i,
    })),
  });

  const toolResults: string[] = [];
  let hasAnyExecution = false;

  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    if (selectedTools.includes(i)) {
      try {
        const result = (await executeTool(call)).trim();
        toolResults.push(
          `### Tool: ${call.type} on ${call.path}\nStatus: Success\nOutput:\n${result}`,
        );
        hasAnyExecution = true;
        process.stdout.write(
          chalk.green(`✓ Executed ${call.type} on ${call.path}\n`),
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        toolResults.push(
          `### Tool: ${call.type} on ${call.path}\nStatus: Error\n${errorMessage}`,
        );
        process.stdout.write(
          chalk.red(`✗ Failed ${call.type} on ${call.path}: ${errorMessage}\n`),
        );
      }
    } else {
      toolResults.push(
        `### Tool: ${call.type} on ${call.path}\nStatus: Denied by user`,
      );
    }
  }

  let pendingToolResults = "";
  if (toolResults.length > 0) {
    pendingToolResults = toolResults.join("\n\n");
    process.stdout.write("\n");
    console.log(
      boxen(pendingToolResults, {
        title: "Tools Result",
        borderColor: "cyan",
      }),
    );
  }

  return {
    pendingToolResults,
    shouldAutoTriggerAI: hasAnyExecution,
  };
}
