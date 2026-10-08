import { expect, vi } from "vitest";
import { execa } from "execa";
import { confirm } from "@inquirer/prompts";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";

export const proxySecret = "ghp_abcdefghijklmnopqrstuvwxyz";

export async function expectProxyRejected(
  command: string,
  args: string[],
  reason: RegExp,
): Promise<void> {
  const original = [...args];
  await runRtkProxy(command, args);
  const cli: unknown = vi.mocked(console.error).mock.calls.at(-1)?.[0];
  if (typeof cli !== "string") {
    throw new Error("Expected a string CLI rejection diagnostic.");
  }
  const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command, args });
  expect(cli).toMatch(reason);
  expect(cli).not.toContain(proxySecret);
  expect(process.exitCode).toBe(1);
  expect(console.log).not.toHaveBeenCalled();
  expect(mcp).toEqual({
    isError: true,
    content: [{ type: "text", text: cli }],
  });
  // Process execution and interactive prompting are external boundaries.
  expect(execa).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(args).toEqual(original);
}
