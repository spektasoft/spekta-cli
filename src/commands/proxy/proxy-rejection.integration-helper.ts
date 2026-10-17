import { expect, vi } from "vitest";
import { execa } from "execa";
import { confirm } from "@inquirer/prompts";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
import type { McpToolResponse } from "../../api/mcp-server/registry";

export const proxySecret = "ghp_abcdefghijklmnopqrstuvwxyz";

function expectedCliStream(command: string): "stdout" | "stderr" {
  switch (command) {
    case "git":
    case "find":
      return "stdout";
    default:
      return "stderr";
  }
}

export async function expectProxyRejected(
  command: string,
  args: string[],
  reason: RegExp,
): Promise<void> {
  const original = [...args];
  const logCalls = vi.mocked(console.log).mock.calls.length;
  const errorCalls = vi.mocked(console.error).mock.calls.length;
  await runRtkProxy(command, args);
  const logDelta = vi.mocked(console.log).mock.calls.slice(logCalls);
  const errorDelta = vi.mocked(console.error).mock.calls.slice(errorCalls);
  const stream = expectedCliStream(command);
  const cliCalls = stream === "stdout" ? logDelta : errorDelta;
  const otherCalls = stream === "stdout" ? errorDelta : logDelta;
  expect(cliCalls).toHaveLength(1);
  expect(otherCalls).toHaveLength(0);
  const cli: unknown = cliCalls[0]?.[0] as unknown;
  if (typeof cli !== "string") {
    throw new Error(
      `Expected a string CLI rejection diagnostic for ${command}.`,
    );
  }
  const mcp: McpToolResponse = await TOOL_REGISTRY.spekta_shell.handler({
    command,
    args,
  });
  expect(cli).toMatch(reason);
  expect(cli).not.toContain(proxySecret);
  expect(process.exitCode).toBe(1);
  expect(mcp.isError).toBe(true);
  expect(mcp.content[0].text).toMatch(reason);
  expect(cli).toContain(mcp.content[0].text);
  // Process execution and interactive prompting are external boundaries.
  expect(execa).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(args).toEqual(original);
}
