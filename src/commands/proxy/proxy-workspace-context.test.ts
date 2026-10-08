import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({ execa: vi.fn() }));

import { execa } from "execa";
import { validateProxyRequest } from "./proxy-policy";
import { executeRtkCommand, prepareRtkInvocation } from "./proxy-execution";
import { runRtkProxy } from "./proxy";

let fixture: string;
let workspace: string;
let otherCwd: string;
let originalExitCode: typeof process.exitCode;
const context = () => ({ root: workspace });

beforeEach(() => {
  originalExitCode = process.exitCode;
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-proxy-context-"));
  workspace = path.join(fixture, "workspace");
  otherCwd = path.join(fixture, "other-cwd");
  fs.ensureDirSync(path.join(workspace, "folder"));
  fs.ensureDirSync(path.join(workspace, ".git"));
  fs.writeFileSync(path.join(workspace, "folder", "file.txt"), "safe");
  fs.ensureDirSync(otherCwd);
  vi.spyOn(process, "cwd").mockReturnValue(otherCwd);
  vi.mocked(execa).mockReset();
  vi.mocked(execa).mockResolvedValue({
    stdout: "ok",
    stderr: "",
    exitCode: 0,
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  fs.removeSync(fixture);
});

describe("explicit proxy workspace context", () => {
  it("validates and executes ls against the same root while cwd differs", async () => {
    const workspaceContext = context();
    expect(() =>
      validateProxyRequest("ls", ["folder"], workspaceContext),
    ).not.toThrow();
    await executeRtkCommand("ls", ["folder"], workspaceContext);
    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "folder"],
      expect.objectContaining({ cwd: workspace }),
    );
  });

  it("sets an explicit cwd for every bound command", () => {
    const workspaceContext = context();
    for (const [command, args] of [
      ["ls", ["."]],
      ["find", ["."]],
      ["git", ["status"]],
    ] as const) {
      expect(
        prepareRtkInvocation(command, [...args], workspaceContext).cwd,
      ).toBe(workspace);
    }
  });

  it("validates find roots against the context workspace", () => {
    expect(() =>
      validateProxyRequest("find", ["folder"], context()),
    ).not.toThrow();
    expect(() => validateProxyRequest("find", ["missing"], context())).toThrow(
      /existing workspace directory/i,
    );
  });

  it("uses context root for Git repository discovery and blob paths", () => {
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:folder/file.txt"], context()),
    ).not.toThrow();
    const outside = path.join(fixture, "outside");
    fs.ensureDirSync(outside);
    fs.symlinkSync(outside, path.join(workspace, "escape"), "dir");
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:escape/secret"], context()),
    ).toThrow(/outside the project directory/i);
  });

  it("rejects traversal and symlink escapes relative to context root", () => {
    const outside = path.join(fixture, "outside");
    fs.ensureDirSync(outside);
    fs.symlinkSync(outside, path.join(workspace, "escape"), "dir");
    expect(() =>
      validateProxyRequest("ls", ["../other-cwd"], context()),
    ).toThrow(/outside the project directory/i);
    expect(() =>
      validateProxyRequest("git", ["status", "--", "escape/secret"], context()),
    ).toThrow(/outside the project directory/i);
  });

  it("fails closed when context-root canonicalization fails", () => {
    const realpath = vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error("context canonicalization failed");
    });
    expect(() => validateProxyRequest("ls", ["folder"], context())).toThrow(
      /context canonicalization failed/,
    );
    realpath.mockRestore();
  });

  it("passes the same context from run validation through child execution", async () => {
    await runRtkProxy("ls", ["folder"], context());
    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "folder"],
      expect.objectContaining({ cwd: workspace }),
    );
  });

  it("keeps context cwd on unavailable, nonzero, and launch-failure paths", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(execa).mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    await runRtkProxy("ls", [], context());
    expect(execa).toHaveBeenLastCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "."],
      expect.objectContaining({ cwd: workspace }),
    );
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "",
      stderr: "failed",
      exitCode: 7,
    } as never);
    await runRtkProxy("ls", [], context());
    expect(execa).toHaveBeenLastCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "."],
      expect.objectContaining({ cwd: workspace }),
    );
    expect(process.exitCode).toBe(7);
    expect(logs).toHaveBeenCalledTimes(1);
    expect(logs).toHaveBeenCalledWith(
      expect.stringContaining("[FAILED: Exit 7]"),
    );

    process.exitCode = 0;
    vi.mocked(execa).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await runRtkProxy("ls", [], context());
    expect(execa).toHaveBeenLastCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "."],
      expect.objectContaining({ cwd: workspace }),
    );
    expect(errors).toHaveBeenCalled();
    expect(logs).toHaveBeenCalledTimes(1);
  });

  it("does not launch a command rejected by context validation", async () => {
    await runRtkProxy("ls", ["../other-cwd"], context());
    expect(execa).not.toHaveBeenCalled();
  });
});
