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

let workspace: string;
const proxyFixture = createGitPolicyFixture();

beforeEach(() => {
  ({ workspace } = proxyFixture.setup());
});

afterEach(() => proxyFixture.teardown());

describe("Git CLI and MCP proxy output parity", () => {
  it.each(acceptedGitRequests.map((args) => ({ args })))(
    "executes Git $args with equivalent adapter policy",
    async ({ args }) => {
      const original = [...args];
      await runRtkProxy("git", args);
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args,
      });
      const history = ["log", "show", "diff"].includes(args[0]);
      const expected = [
        "proxy",
        "git",
        "--no-pager",
        "--literal-pathspecs",
        ...(args[0] === "diff" ? ["-c", "diff.autoRefreshIndex=false"] : []),
        args[0],
        ...(history ? ["--no-ext-diff", "--no-textconv"] : []),
        ...(args[0] === "diff" ? ["--submodule=short"] : []),
        ...args.slice(1),
        ...(history && !args.includes("--") ? ["--"] : []),
      ];
      const calls = vi.mocked(execa).mock.calls as unknown as Array<
        [string, string[], { cwd?: string; env?: NodeJS.ProcessEnv }]
      >;
      for (const call of calls) {
        expect(call[0]).toBe("rtk");
        expect(call[1]).toEqual(expected);
        expect(call[2]).toEqual(
          expect.objectContaining({
            cwd: workspace,
            env: expect.objectContaining({
              GIT_PAGER: "cat",
              PAGER: "cat",
            }) as Record<string, unknown>,
          }),
        );
      }
      expect(vi.mocked(execa).mock.calls).toHaveLength(2);
      expect(args).toEqual(original);
      expect(mcp).toEqual({
        isError: false,
        content: [{ type: "text", text: "listing" }],
      });
      expect(console.error).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it.each(["status", "log", "show", "diff", "branch"])(
    "condenses and redacts %s output in both adapters",
    async (subcommand) => {
      vi.mocked(execa).mockResolvedValue({
        stdout: `${secret}\n${"history line\n".repeat(3000)}`,
        stderr: "",
        exitCode: 0,
      } as never);
      await runRtkProxy("git", [subcommand]);
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args: [subcommand],
      });
      const cli = vi.mocked(console.log).mock.calls[0][0] as string;
      expect(cli).toContain("OUTPUT TRUNCATED");
      expect(cli).not.toContain(secret);
      expect(mcp.content[0].text).toContain("lines collapsed");
      expect(mcp.content[0].text).not.toContain(secret);
      expect(getTokenCount(mcp.content[0].text)).toBeLessThanOrEqual(1000);
    },
  );

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
      expect(console.error).toHaveBeenCalledWith(
        expect.stringMatching(/status 2/i),
      );
      expect(failed).toEqual({
        isError: true,
        content: [{ type: "text", text: "[REDACTED]" }],
      });
      vi.mocked(execa).mockRejectedValue(
        Object.assign(new Error("missing"), { code: "ENOENT" }),
      );
      await runRtkProxy("git", [subcommand]);
      expect(vi.mocked(console.error).mock.calls.at(-1)?.[0]).toContain(
        "not found",
      );
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
