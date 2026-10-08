import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { confirm } from "@inquirer/prompts";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
import { getTokenCount } from "../../utils/read-utils";
import { acceptedGitRequests } from "./proxy-git.test-fixtures";
import { createGitPolicyFixture } from "./proxy-policy.integration-fixture";
import {
  expectProxyRejected as expectRejected,
  proxySecret as secret,
} from "./proxy-rejection.integration-helper";

vi.mock("execa", () => ({ execa: vi.fn() }));
vi.mock("@inquirer/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@inquirer/prompts")>()),
  confirm: vi.fn(),
}));

const proxyFixture = createGitPolicyFixture();

beforeEach(() => proxyFixture.setup());

afterEach(() => proxyFixture.teardown());

describe("Git CLI and MCP proxy output parity", () => {
  it.each(acceptedGitRequests.map((args) => ({ args })))(
    "executes Git $args with equivalent adapter policy",
    async ({ args }) => {
      const original = [...args];
      await runRtkProxy("git", args);
      const cliCalls = [...vi.mocked(execa).mock.calls];
      vi.mocked(execa).mockClear();
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args,
      });
      const mcpCalls = vi.mocked(execa).mock.calls;
      expect(cliCalls.length).toBeGreaterThan(0);
      expect(mcpCalls.length).toBeGreaterThan(0);
      expect(args).toEqual(original);
      expect(mcp.content[0].text).toEqual(expect.any(String));
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it("condenses and redacts verbose branch output in both adapters", async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: `${secret}\n${"history line\n".repeat(3000)}`,
      stderr: "",
      exitCode: 0,
    } as never);
    await runRtkProxy("git", ["branch"]);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "git",
      args: ["branch"],
    });
    const cli = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(cli).toContain("OUTPUT TRUNCATED");
    expect(cli).not.toContain(secret);
    expect(mcp.content[0].text).toContain("lines collapsed");
    expect(mcp.content[0].text).not.toContain(secret);
    expect(getTokenCount(mcp.content[0].text)).toBeLessThanOrEqual(1000);
  });

  it.each(["status", "log", "show", "diff", "branch"])(
    "fails closed for filesystem errors in %s",
    async (subcommand) => {
      vi.spyOn(fs, "realpathSync").mockImplementation(() => {
        throw new Error(`${secret} ${"failure ".repeat(3000)}`);
      });
      await expectRejected("git", [subcommand], /\[REDACTED\]/);
      expect(
        getTokenCount(vi.mocked(console.error).mock.calls[0][0] as string),
      ).toBeLessThanOrEqual(1000);
    },
  );

  it.each(["status", "log", "show", "diff", "branch"])(
    "reports nonzero/missing RTK failures for %s",
    async (subcommand) => {
      vi.mocked(execa).mockResolvedValue({
        stdout: "",
        stderr: secret,
        exitCode: 2,
      } as never);
      await runRtkProxy("git", [subcommand]);
      const failed = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args: [subcommand],
      });
      expect(vi.mocked(console.log).mock.calls[0][0]).toContain(
        "FAILED: Exit 2",
      );
      expect(vi.mocked(console.log).mock.calls[0][0]).not.toContain(secret);
      expect(process.exitCode).toBe(2);
      expect(failed.isError).toBe(true);
      expect(failed.content[0].text).not.toContain(secret);
      vi.mocked(execa).mockRejectedValue(
        Object.assign(new Error("missing"), { code: "ENOENT" }),
      );
      await runRtkProxy("git", [subcommand]);
      const missingOutput = [
        ...vi.mocked(console.log).mock.calls,
        ...vi.mocked(console.error).mock.calls,
      ].at(-1)?.[0] as string;
      expect(missingOutput).toContain("not found");
      expect(process.exitCode).toBe(1);
      const missing = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args: [subcommand],
      });
      expect(missing.isError).toBe(true);
      expect(missing.content[0].text).toContain("not found");
    },
  );
});
