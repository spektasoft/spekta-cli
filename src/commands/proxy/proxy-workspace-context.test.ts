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
let originalListingBackendOverride: string | undefined;
const context = () => ({ root: workspace });

function createDirectorySymlinkOrSkip(
  target: string,
  link: string,
  skip: (reason: string) => never,
): void {
  try {
    fs.symlinkSync(target, link, "dir");
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP"].includes(code ?? "")) {
      skip(`Directory symlink creation is unavailable (${code}).`);
    }
    throw error;
  }
}

beforeEach(() => {
  originalExitCode = process.exitCode;
  originalListingBackendOverride = process.env.SPEKTA_LISTING_BACKEND_OVERRIDE;
  process.env.SPEKTA_LISTING_BACKEND_OVERRIDE = "native";
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-proxy-context-"));
  workspace = path.join(fixture, "workspace");
  otherCwd = path.join(fixture, "other-cwd");
  fs.ensureDirSync(path.join(workspace, "folder"));
  fs.ensureDirSync(path.join(workspace, ".git"));
  fs.writeFileSync(path.join(workspace, "folder", "file.txt"), "safe");
  fs.ensureDirSync(otherCwd);
  vi.spyOn(process, "cwd").mockReturnValue(otherCwd);
  vi.mocked(execa).mockReset();
  vi.mocked(execa).mockImplementation(((file: string) => {
    if (file === "git")
      return Promise.reject(
        Object.assign(new Error("not ignored"), { exitCode: 1 }),
      );
    return Promise.resolve({ stdout: "ok", stderr: "", exitCode: 0 });
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  if (originalListingBackendOverride === undefined) {
    delete process.env.SPEKTA_LISTING_BACKEND_OVERRIDE;
  } else {
    process.env.SPEKTA_LISTING_BACKEND_OVERRIDE =
      originalListingBackendOverride;
  }
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
    expect(() =>
      validateProxyRequest("find", ["missing"], context()),
    ).not.toThrow();
  });

  it("uses context root for Git repository discovery and blob paths", () => {
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:folder/file.txt"], context()),
    ).not.toThrow();
  });

  it("rejects Git blob paths that escape through a symlink", (testContext) => {
    const outside = path.join(fixture, "outside");
    fs.ensureDirSync(outside);
    createDirectorySymlinkOrSkip(
      outside,
      path.join(workspace, "escape"),
      (reason) => testContext.skip(reason),
    );
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:escape/secret"], context()),
    ).toThrow(/outside the project directory/i);
  });

  it("classifies traversal per operand relative to context root", async () => {
    expect(() =>
      validateProxyRequest("ls", ["../other-cwd"], context()),
    ).not.toThrow();
    const errors = vi.spyOn(console, "log").mockImplementation(() => {});
    await runRtkProxy("ls", ["../other-cwd"], context());
    expect(errors.mock.calls[0][0]).toContain(
      "Operand 1: unavailable; unavailable_access",
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it("classifies symlink escapes per operand relative to context root", (testContext) => {
    const outside = path.join(fixture, "outside");
    fs.ensureDirSync(outside);
    createDirectorySymlinkOrSkip(
      outside,
      path.join(workspace, "escape"),
      (reason) => testContext.skip(reason),
    );
    expect(() =>
      validateProxyRequest("git", ["status", "--", "escape/secret"], context()),
    ).toThrow(/outside the project directory/i);
  });

  it("fails closed when context-root canonicalization fails", async () => {
    const realpath = vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error("context canonicalization failed");
    });
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    await runRtkProxy("ls", ["folder"], context());
    expect(logs.mock.calls[0][0]).toContain(
      "Operand 1: unavailable; unavailable_access",
    );
    expect(execa).not.toHaveBeenCalled();
    realpath.mockRestore();
  });

  it("passes the same context from run validation through child execution", async () => {
    process.env.SPEKTA_LISTING_BACKEND_OVERRIDE = "rtk";
    await runRtkProxy("ls", ["folder"], context());
    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "folder"],
      expect.objectContaining({ cwd: workspace }),
    );
  });

  it("keeps context cwd on unavailable, nonzero, and launch-failure paths", async () => {
    process.env.SPEKTA_LISTING_BACKEND_OVERRIDE = "rtk";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(execa).mockImplementation(((file: string) => {
      if (file === "git")
        return Promise.reject(
          Object.assign(new Error("not ignored"), { exitCode: 1 }),
        );
      return Promise.reject(
        Object.assign(new Error("missing"), { code: "ENOENT" }),
      );
    }) as never);
    await runRtkProxy("ls", [], context());
    expect(execa).toHaveBeenLastCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "."],
      expect.objectContaining({ cwd: workspace }),
    );
    vi.mocked(execa).mockImplementation(((file: string) => {
      if (file === "git")
        return Promise.reject(
          Object.assign(new Error("not ignored"), { exitCode: 1 }),
        );
      return Promise.resolve({ stdout: "", stderr: "failed", exitCode: 7 });
    }) as never);
    await runRtkProxy("ls", [], context());
    expect(execa).toHaveBeenLastCalledWith(
      "rtk",
      ["proxy", "ls", "-1Ab", "--", "."],
      expect.objectContaining({ cwd: workspace }),
    );
    expect(process.exitCode).toBe(1);
    expect(logs).toHaveBeenCalledTimes(1);
    expect(logs).toHaveBeenCalledWith(
      expect.stringContaining("Operand 1: internal_failure; listing failed"),
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
    expect(logs).toHaveBeenCalledTimes(2);
  });

  it("does not launch a command rejected by context validation", async () => {
    await runRtkProxy("ls", ["../other-cwd"], context());
    expect(execa).not.toHaveBeenCalled();
  });
});
