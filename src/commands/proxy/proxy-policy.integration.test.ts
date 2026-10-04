import fs from "fs-extra";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { confirm } from "@inquirer/prompts";
import { runRtkProxy } from "./proxy";

import { TOOL_REGISTRY } from "../../api/mcp-server/registry";

import { createGitPolicyFixture } from "./proxy-policy.integration-fixture";
import { rejectedPolicyRequests } from "./proxy-policy.integration-cases";
import {
  expectProxyRejected as expectRejected,
  proxySecret as secret,
} from "./proxy-rejection.integration-helper";
import { getTokenCount } from "../../utils/read-utils";

vi.mock("execa", () => ({ execa: vi.fn() }));
vi.mock("../../core/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../core/config")>()),
  getIgnorePatterns: () => Promise.resolve([]),
}));
vi.mock("@inquirer/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@inquirer/prompts")>()),
  confirm: vi.fn(),
}));

let fixture: string;
let workspace: string;
const proxyFixture = createGitPolicyFixture();

beforeEach(() => {
  ({ fixture, workspace } = proxyFixture.setup());
});

afterEach(() => proxyFixture.teardown());

function mockRtkListing(stdout: string): void {
  vi.mocked(execa).mockImplementation(((file: string) => {
    if (file === "git") {
      throw Object.assign(new Error("not ignored"), { exitCode: 1 });
    }
    return { stdout, stderr: "", exitCode: 0 };
  }) as never);
}

describe("CLI and MCP proxy parity", () => {
  it("filters Git-ignored names beginning with a dash through CLI and MCP", async () => {
    fs.writeFileSync(path.join(workspace, "--private.txt"), "secret");
    fs.writeFileSync(path.join(workspace, "visible.txt"), "visible");
    vi.mocked(execa).mockImplementation(((
      file: string,
      args: string[],
    ) => {
      if (file === "git") {
        if (args[args.length - 1] === "--private.txt") return { exitCode: 0 };
        throw Object.assign(new Error("not ignored"), { exitCode: 1 });
      }
      return {
        stdout: "--private.txt\nvisible.txt\n",
        stderr: "",
        exitCode: 0,
      };
    }) as never);

    await runRtkProxy("ls", []);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    const cli = vi.mocked(console.log).mock.calls[0][0] as string;

    for (const output of [cli, mcp.content[0].text]) {
      expect(output).toContain("visible.txt");
      expect(output).not.toContain("--private.txt");
    }
    const gitCalls = vi
      .mocked(execa)
      .mock.calls.filter(
        ([file, args]) =>
          file === "git" && JSON.stringify(args).includes('"--private.txt"'),
      );
    expect(gitCalls).toHaveLength(2);
    expect(gitCalls).toEqual(
      expect.arrayContaining([
        [
          "git",
          ["check-ignore", "-q", "--", "--private.txt"],
          expect.objectContaining({ cwd: workspace }),
        ],
      ]),
    );
  });

  it.each([
    { args: [] },
    { args: ["."] },
    { args: ["directory"] },
    { args: ["./directory"] },
  ])(
    "executes accepted args $args through the same RTK invocation",
    async ({ args }) => {
      fs.writeFileSync(path.join(workspace, "directory", "inner.txt"), "x");
      const inDirectory = args[0]?.endsWith("directory") === true;
      mockRtkListing(inDirectory ? "inner.txt\n" : "directory\nfile.txt\n");
      await runRtkProxy("ls", args);
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "ls",
        args,
      });
      const rtkCalls = vi
        .mocked(execa)
        .mock.calls.filter(([file]) => file === "rtk");
      expect(rtkCalls).toHaveLength(2);
      for (const call of rtkCalls) {
        expect(call[1]).toEqual(["proxy", "ls", "-1Ab", "--", args[0] ?? "."]);
      }
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("### spekta ls"),
      );
      expect(console.error).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      const listing = inDirectory ? '"inner.txt"' : '"directory"\n"file.txt"';
      expect(vi.mocked(console.log).mock.calls[0][0]).toContain(listing);
      expect(mcp).toEqual({
        isError: false,
        content: [{ type: "text", text: listing }],
      });
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it.each(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"])(
    "rejects ambient %s through both adapters",
    async (key) => {
      process.env[key] = "override";
      for (const subcommand of ["status", "diff", "branch"]) {
        await expectRejected("git", [subcommand], /workspace override/i);
      }
    },
  );

  it("rejects restricted cwd without path operands through both adapters", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(path.join(workspace, ".env"));
    for (const subcommand of ["status", "log", "show", "diff", "branch"])
      await expectRejected("git", [subcommand], /restricted/i);
  });

  it.each(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"])(
    "rejects ambient %s for explicit branch listing, including empty values",
    async (key) => {
      for (const value of ["", "override"]) {
        process.env[key] = value;
        await expectRejected(
          "git",
          ["branch", "--list", "feature/*"],
          /workspace override/i,
        );
      }
    },
  );

  it("propagates branch subprocess launch failures through both adapters", async () => {
    const failure = Object.assign(
      new Error(
        `permission denied ${secret}\n${"failure line\n".repeat(3000)}USEFUL_STDERR`,
      ),
      { code: "EACCES", failed: true },
    );
    vi.mocked(execa).mockRejectedValue(failure);
    await runRtkProxy("git", ["branch"]);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "git",
      args: ["branch"],
    });
    expect(process.exitCode).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
    expect(mcp.isError).toBe(true);
    for (const output of [
      vi.mocked(console.error).mock.calls[0][0] as string,
      mcp.content[0].text,
    ]) {
      expect(output).toContain("permission denied");
      expect(output).toContain("USEFUL_STDERR");
      expect(output).toContain("lines collapsed");
      expect(output).not.toContain(secret);
      expect(getTokenCount(output)).toBeLessThanOrEqual(1000);
    }
    expect(confirm).not.toHaveBeenCalled();
  });

  it("rejects missing blob root through both adapters", async () => {
    fs.removeSync(path.join(workspace, ".git"));
    const realLstat = fs.lstatSync.bind(fs);
    vi.spyOn(fs, "lstatSync").mockImplementation(
      (target: Parameters<typeof fs.lstatSync>[0]) => {
        if (path.basename(String(target)) === ".git")
          throw Object.assign(new Error("missing Git repository marker"), {
            code: "ENOENT",
          });
        return realLstat(target);
      },
    );
    await expectRejected("git", ["show", "HEAD:file.txt"], /cannot establish/i);
  });

  it("rejects a symlink repository marker through both adapters", async () => {
    fs.removeSync(path.join(workspace, ".git"));
    fs.symlinkSync(
      path.join(fixture, "outside"),
      path.join(workspace, ".git"),
      "dir",
    );
    await expectRejected(
      "git",
      ["show", "HEAD:file.txt"],
      /repository marker/i,
    );
  });

  it("rejects a blob outside nested cwd before RTK starts", async () => {
    const nested = path.join(workspace, "nested");
    fs.ensureDirSync(nested);
    vi.spyOn(process, "cwd").mockReturnValue(nested);
    await expectRejected(
      "git",
      ["show", "HEAD:file.txt"],
      /outside the project directory/i,
    );
  });

  it("rejects blob marker I/O failure with a redacted diagnostic", async () => {
    vi.spyOn(fs, "lstatSync").mockImplementation(() => {
      throw new Error(secret);
    });
    await expectRejected("git", ["show", "HEAD:file.txt"], /\[REDACTED\]/);
  });

  it("omits denied descendants through both adapters", async () => {
    mockRtkListing(
      ".env\ndangling\ndirectory\nescape\nfile.txt\nrestricted-alias\n",
    );
    await runRtkProxy("ls", []);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    const cli = vi.mocked(console.log).mock.calls[0][0] as string;
    for (const output of [cli, mcp.content[0].text]) {
      expect(output).toContain("directory");
      expect(output).toContain("file.txt");
      for (const denied of [".env", "dangling", "escape", "restricted-alias"]) {
        expect(output).not.toContain(denied);
      }
    }
    expect(mcp.isError).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("treats omitted MCP args as ls without an operand", async () => {
    mockRtkListing("file.txt\n");
    const result = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toBe('"file.txt"');
    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "."],
      expect.any(Object),
    );
  });

  it.each([true, false])(
    "rejects the full matrix without prompting with isTTY=%s",
    async (isTTY) => {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: isTTY,
      });

      const requests = rejectedPolicyRequests(workspace);
      for (const [command, args, reason] of requests)
        await expectRejected(command, args, reason);
    },
  );

  it("redacts and bounds filesystem error diagnostics in both entry points", async () => {
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error(`${secret} ${"failure ".repeat(3000)}`);
    });
    await expectRejected("ls", ["directory"], /\[REDACTED\]/);
    const diagnostic = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(getTokenCount(diagnostic)).toBeLessThanOrEqual(1000);
  });

  it("preserves redaction and condensation for accepted output", async () => {
    const names = [`${secret}.txt`];
    for (let index = 0; index < 600; index++) {
      names.push(`entry-${String(index).padStart(4, "0")}.txt`);
    }
    for (const name of names) {
      fs.writeFileSync(path.join(workspace, name), "x");
    }
    mockRtkListing(`${[...names].sort().join("\n")}\n`);
    await runRtkProxy("ls", []);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    const cli = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(cli).toContain("OUTPUT TRUNCATED");
    expect(cli).not.toContain(secret);
    expect(mcp.content[0].text).not.toContain(secret);
    expect(mcp.content[0].text).toContain("lines collapsed");
    expect(getTokenCount(mcp.content[0].text)).toBeLessThanOrEqual(1000);
    expect(getTokenCount(`${cli}\n`)).toBeLessThanOrEqual(1000);
  });

  it("preserves MCP nonzero RTK result and missing RTK error responses", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "",
      stderr: secret,
      exitCode: 2,
    } as never);
    const failed = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    expect(failed).toEqual({
      isError: true,
      content: [
        { type: "text", text: "RTK command failed with exit status 2." },
      ],
    });
    vi.mocked(execa).mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    const missing = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("not found");
  });
});
