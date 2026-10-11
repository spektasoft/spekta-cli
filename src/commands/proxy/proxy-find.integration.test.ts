import fs from "fs-extra";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { confirm } from "@inquirer/prompts";
import { runRtkProxy } from "./proxy";

import { TOOL_REGISTRY } from "../../api/mcp-server/registry";

import { createProxyFixture } from "./proxy-mocked.integration-fixture";
import { acceptedFindRequests } from "./proxy-find-accepted.integration-cases";
import { rejectedFindRequests } from "./proxy-find-rejected.integration-cases";
import { expectProxyRejected } from "./proxy-rejection.integration-helper";
vi.mock("execa", () => ({ execa: vi.fn() }));

vi.mock("@inquirer/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@inquirer/prompts")>()),
  confirm: vi.fn(),
}));

let fixture: string;
let workspace: string;
const listing = "./one.ts\n./space name/two.ts";
const proxyFixture = createProxyFixture({
  prefix: "spekta-find-integration-",
  stdout: listing,
});

beforeEach(() => {
  ({ fixture, workspace } = proxyFixture.setup());
  fs.ensureDirSync(path.join(workspace, "space name"));
  fs.ensureDirSync(path.join(workspace, "-directory"));
  fs.writeFileSync(path.join(workspace, "one.ts"), "one");
  fs.writeFileSync(path.join(workspace, "space name", "two.ts"), "two");
  vi.mocked(execa).mockImplementation(((command: string) => {
    if (command === "git") throw new Error("not ignored");
    return Promise.resolve({ stdout: listing, stderr: "", exitCode: 0 });
  }) as never);
  fs.writeFileSync(path.join(workspace, "sentinel.txt"), "preserve this file");
  fs.writeFileSync(
    path.join(fixture, "outside", "external-sentinel.txt"),
    "preserve external file",
  );
});

afterEach(() => proxyFixture.teardown());

function expectRejected(args: string[], reason: RegExp): Promise<void> {
  return expectProxyRejected("find", args, reason);
}

async function expectUnavailable(args: string[]): Promise<void> {
  await runRtkProxy("find", args);
  const cli = vi.mocked(console.log).mock.calls.at(-1)?.[0] as unknown;
  expect(typeof cli).toBe("string");
  expect(cli).toContain("Operand 1: unavailable; unavailable_access");
  expect(process.exitCode).toBe(1);
  const mcp = await TOOL_REGISTRY.spekta_shell.handler(
    { command: "find", args },
    undefined,
    "unavailable-root-17",
  );
  expect(mcp.isError).toBe(true);
  expect(mcp.content[0].text).toBe(
    "Batch: partial_result\nOperand 1: unavailable; unavailable_access\n",
  );
  expect(String(cli)).toContain(mcp.content[0].text);
  if (args[0]) expect(String(cli)).not.toContain(args[0]);
  expect(
    vi
      .mocked(execa)
      .mock.calls.filter(
        ([file, args]) => file === "rtk" && args?.[0] === "proxy",
      ),
  ).toHaveLength(0);
  vi.mocked(console.log).mockClear();
  vi.mocked(console.error).mockClear();
  vi.mocked(execa).mockClear();
  process.exitCode = undefined;
}

describe("restricted find CLI and MCP parity", () => {
  it("accepts only a leading CLI allowance and keeps allowance-looking name values literal", async () => {
    const request = ["--allowance", "300", "-name", "--allowance"];
    await runRtkProxy("find", request);
    const findCalls = vi
      .mocked(execa)
      .mock.calls.filter(
        ([command, invocation]) =>
          command === "rtk" && invocation?.[0] === "proxy",
      );
    expect(findCalls).toHaveLength(1);
    expect(findCalls[0][1]).toEqual([
      "proxy",
      "find",
      "-P",
      ".",
      "-name",
      "--allowance",
    ]);

    vi.clearAllMocks();
    const mcp = await TOOL_REGISTRY.spekta_shell.handler(
      { command: "find", args: ["-name", "--allowance"], allowance: 300 },
      undefined,
      "find-allowance-300",
    );
    expect(mcp.isError).toBe(false);
    expect(mcp.content[0].text).toContain("Batch: success");
    expect(
      vi
        .mocked(execa)
        .mock.calls.filter(
          ([command, invocation]) =>
            command === "rtk" && invocation?.[0] === "proxy",
        ),
    ).toHaveLength(1);

    vi.clearAllMocks();
    for (const args of [
      ["--allowance"],
      ["--allowance", "100", "--allowance", "200", "."],
      [".", "--allowance", "100"],
    ]) {
      await runRtkProxy("find", args);
      expect(execa).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          "usage_error: find accepts one leading --allowance value",
        ),
      );
      vi.clearAllMocks();
    }
    await runRtkProxy("find", ["--allowance", "0", "."]);
    expect(execa).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "usage_error: Allowance must be a positive whole number",
      ),
    );
    vi.clearAllMocks();

    const invalidMcpAllowance = await TOOL_REGISTRY.spekta_shell.handler(
      { command: "find", args: ["."], allowance: 0 },
      undefined,
      "invalid-allowance-17",
    );
    expect(invalidMcpAllowance.isError).toBe(true);
    expect(invalidMcpAllowance.content[0].text).toContain(
      "usage_error: Allowance must be a positive whole number",
    );
    expect(execa).not.toHaveBeenCalled();
    const rejectedMcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "git",
      args: ["status"],
      allowance: 300,
    });
    expect(rejectedMcp.isError).toBe(true);
    expect(rejectedMcp.content[0].text).toContain(
      "Allowance is supported only for ls and find",
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it.each(acceptedFindRequests)(
    "executes accepted request $args through equivalent public adapters",
    async ({ args, expectedArgs }) => {
      const original = [...args];
      const root = args[0] && !args[0].startsWith("-") ? args[0] : ".";
      const listing =
        root === "." ? "./one.ts\n./space name/two.ts" : `${root}/one.ts`;
      if (root !== ".")
        fs.writeFileSync(path.join(workspace, root, "one.ts"), "one");
      vi.mocked(execa).mockImplementation(((command: string) => {
        if (command === "git") throw new Error("not ignored");
        return Promise.resolve({ stdout: listing, stderr: "", exitCode: 0 });
      }) as never);

      await runRtkProxy("find", args);
      const mcp = await TOOL_REGISTRY.spekta_shell.handler(
        { command: "find", args },
        undefined,
        "accepted-request-17",
      );

      expect(
        vi
          .mocked(execa)
          .mock.calls.filter(
            ([command, invocation]) =>
              command === "rtk" && invocation?.[0] === "proxy",
          ),
      ).toHaveLength(2);
      expect(execa).toHaveBeenCalledWith(
        "rtk",
        expectedArgs,
        expect.objectContaining({
          reject: false,
          cwd: workspace,
          env: expect.objectContaining({
            NO_COLOR: "1",
            TERM: "dumb",
          }) as unknown,
        }),
      );
      expect(execa).toHaveBeenCalledWith(
        "rtk",
        expectedArgs,
        expect.objectContaining({
          reject: false,
          cwd: workspace,
          env: expect.objectContaining({
            NO_COLOR: "1",
            TERM: "dumb",
          }) as unknown,
        }),
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("### spekta find"),
      );
      const body = mcp.content[0].text;
      expect(body).toMatch(/^Batch: success\nOperand 1: returned; /);
      expect(body).toContain(
        JSON.stringify(
          root === "." ? "one.ts" : path.posix.normalize(`${root}/one.ts`),
        ),
      );
      if (root === ".") expect(body).toContain('"space name/two.ts"');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining(body));
      expect(console.error).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();

      expect(mcp.isError).toBe(false);

      expect(confirm).not.toHaveBeenCalled();
      expect(args).toEqual(original);
    },
  );

  it("uses the default root when MCP args are omitted", async () => {
    const result = await TOOL_REGISTRY.spekta_shell.handler(
      { command: "find" },
      undefined,
      7,
    );

    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["proxy", "find", "-P", "."],
      expect.objectContaining({
        reject: false,
        cwd: workspace,
      }),
    );
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain("Batch: success");
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "rejects unsupported grammar without execution or prompting with isTTY=%s",
    async (isTTY) => {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: isTTY,
      });

      const requests = rejectedFindRequests;
      for (const request of requests) {
        await expectRejected(request.args, request.reason);
      }
    },
  );

  it.each([
    { args: [".", "-exec", "touch", "marker", ";"] },
    { args: [".", "-execdir", "touch", "marker", ";"] },
    { args: [".", "-ok", "touch", "marker", ";"] },
    { args: [".", "-okdir", "touch", "marker", ";"] },
    { args: [".", "-delete"] },
    { args: [".", "-fprint", "output.txt"] },
    { args: [".", "-fprint0", "output.txt"] },
    { args: [".", "-fprintf", "output.txt", "%p"] },
    { args: [".", "-fls", "output.txt"] },
  ])(
    "rejects side-effect action $args and preserves files",
    async ({ args }) => {
      await expectRejected(args, /unsupported find token/i);

      expect(
        fs.readFileSync(path.join(workspace, "sentinel.txt"), "utf8"),
      ).toBe("preserve this file");
      expect(
        fs.readFileSync(
          path.join(fixture, "outside", "external-sentinel.txt"),
          "utf8",
        ),
      ).toBe("preserve external file");

      expect(fs.existsSync(path.join(workspace, "marker"))).toBe(false);
      expect(fs.existsSync(path.join(workspace, "output.txt"))).toBe(false);
      expect(fs.existsSync(path.join(fixture, "outside", "marker"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(fixture, "outside", "output.txt"))).toBe(
        false,
      );
    },
  );

  it("reports external and escaping symlink roots as unavailable", async () => {
    const roots = [
      "../outside",
      path.join(fixture, "outside"),
      "escape",
      "escape/missing/child",
    ];

    for (const root of roots) {
      await expectUnavailable([root]);
    }
    await expectRejected(["C:/outside"], /usage_error/i);
    await expectRejected([String.raw`C:\outside`], /usage_error/i);
    await expectRejected([String.raw`\\server\share\outside`], /usage_error/i);
    process.exitCode = undefined;
    await runRtkProxy("find", [workspace]);
    expect(process.exitCode).toBeUndefined();
  });

  it.each([".env", ".env/child", "restricted-alias"])(
    "reports restricted root %s as unavailable",
    async (root) => {
      await expectUnavailable([root]);
    },
  );

  it.each(["file.txt", "missing", "dangling"])(
    "reports non-directory or missing root %s as unavailable",
    async (root) => {
      await expectUnavailable([root]);
    },
  );

  it("reports a restricted default cwd as unavailable in both adapters", async () => {
    vi.spyOn(process, "cwd").mockImplementation(() =>
      path.join(workspace, ".env"),
    );
    await expectUnavailable([]);
  });

  it("reports missing RTK as a request-wide engine failure", async () => {
    vi.mocked(execa).mockRejectedValue(
      Object.assign(new Error("rtk not found"), { code: "ENOENT" }),
    );

    await runRtkProxy("find", ["."]);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "find",
      args: ["."],
    });

    expect(console.error).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("engine_failure: RTK is unavailable"),
    );
    expect(process.exitCode).toBe(1);

    expect(mcp).toEqual({
      isError: true,
      content: [{ type: "text", text: "engine_failure: RTK is unavailable" }],
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("retains a safe backend failure outcome without child output", async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: "",
      stderr: "native find failed",
      exitCode: 7,
    } as never);

    await runRtkProxy("find", ["."]);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "find",
      args: ["."],
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("internal_failure; discovery failed"),
    );
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      "native find failed",
    );
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(mcp).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: 'Batch: partial_result\nOperand 1: internal_failure; discovery failed; "."\n',
        },
      ],
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});
