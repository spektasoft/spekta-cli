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
import {
  expectProxyRejected,
  proxySecret as secret,
} from "./proxy-rejection.integration-helper";
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
describe("restricted find CLI and MCP parity", () => {
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
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "find",
        args,
      });

      expect(
        vi.mocked(execa).mock.calls.filter(([command]) => command === "rtk"),
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
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(listing),
      );
      expect(console.error).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();

      expect(mcp).toEqual({
        isError: false,
        content: [{ type: "text", text: listing }],
      });

      expect(confirm).not.toHaveBeenCalled();
      expect(args).toEqual(original);
    },
  );

  it("uses the default root when MCP args are omitted", async () => {
    const result = await TOOL_REGISTRY.spekta_shell.handler({
      command: "find",
    });

    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["proxy", "find", "-P", "."],
      expect.objectContaining({
        reject: false,
        cwd: workspace,
      }),
    );
    expect(result).toEqual({
      isError: false,
      content: [{ type: "text", text: listing }],
    });
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

  it("rejects external and escaping symlink roots identically", async () => {
    const roots = [
      "../outside",
      path.join(fixture, "outside"),
      workspace,
      "C:/outside",
      String.raw`C:\outside`,
      String.raw`\\server\share\outside`,
      "escape",
      "escape/missing/child",
    ];

    for (const root of roots) {
      await expectRejected([root], /outside the project directory/i);
    }
  });

  it.each([".env", ".env/child", "restricted-alias"])(
    "rejects restricted root %s identically",
    async (root) => {
      await expectRejected([root], /restricted/i);
    },
  );

  it.each(["file.txt", "missing", "dangling"])(
    "rejects non-directory root %s identically",
    async (root) => {
      await expectRejected([root], /existing workspace directory/i);
    },
  );

  it("rejects a restricted default cwd in both adapters", async () => {
    vi.spyOn(process, "cwd").mockImplementation(() =>
      path.join(workspace, ".env"),
    );
    await expectRejected([], /restricted/i);
  });

  it("rejects inaccessible directory inspection in both adapters", async () => {
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    await expectRejected(["directory"], /existing workspace directory/i);
  });

  it("redacts canonical lookup failures in both adapters before execution", async () => {
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error(secret);
    });
    await expectRejected(["directory"], /\[REDACTED\]/);
  });

  it("reports missing RTK on stderr with status 1", async () => {
    vi.mocked(execa).mockRejectedValue(
      Object.assign(new Error("rtk not found"), { code: "ENOENT" }),
    );

    await runRtkProxy("find", ["."]);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "find",
      args: ["."],
    });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/rtk[\s\S]*not found/i),
    );
    expect(console.log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    expect(mcp).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "The `rtk` executable was not found. Install RTK with the `rtk-ai` package, then retry.",
        },
      ],
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("propagates backend failure status without child output in either adapter", async () => {
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
      expect.stringContaining("[FAILED: Exit 7]"),
    );
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      "native find failed",
    );
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(7);
    expect(mcp).toEqual({
      isError: true,
      content: [
        { type: "text", text: "RTK command failed with exit status 7." },
      ],
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});
