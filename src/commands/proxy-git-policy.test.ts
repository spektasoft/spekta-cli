import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProxyRequest } from "./proxy-policy";
import {
  acceptedGitRequests,
  rejectedGitRequests,
} from "./proxy-git.test-fixtures";

let fixture: string;
let workspace: string;
let cwd: { mockReturnValue(value: string): unknown };
let savedOverrides: Record<string, string | undefined>;
beforeEach(() => {
  savedOverrides = {};
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) {
    savedOverrides[key] = process.env[key];
    delete process.env[key];
  }
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-git-policy-"));
  workspace = path.join(fixture, "workspace");
  fs.ensureDirSync(path.join(workspace, ".git"));
  fs.ensureDirSync(path.join(workspace, ".env"));
  fs.ensureDirSync(path.join(fixture, "outside"));
  fs.writeFileSync(path.join(workspace, "file.txt"), "safe");
  fs.symlinkSync(
    path.join(fixture, "outside"),
    path.join(workspace, "escape"),
    "dir",
  );
  fs.symlinkSync(
    path.join(workspace, ".env"),
    path.join(workspace, "restricted-alias"),
    "dir",
  );
  fs.symlinkSync(
    path.join(workspace, "missing"),
    path.join(workspace, "dangling"),
    "dir",
  );
  cwd = vi.spyOn(process, "cwd").mockReturnValue(workspace);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.removeSync(fixture);
  for (const [key, value] of Object.entries(savedOverrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("shared Git classification", () => {
  it.each(acceptedGitRequests.map((args) => ({ args })))(
    "accepts $args without mutation",
    ({ args }) => {
      const original = [...args];
      expect(() => validateProxyRequest("git", args)).not.toThrow();
      expect(args).toEqual(original);
    },
  );
  it.each(rejectedGitRequests.map(([args, reason]) => ({ args, reason })))(
    "rejects $args",
    ({ args, reason }) => {
      expect(() => validateProxyRequest("git", args)).toThrow(reason);
    },
  );
  it("does not apply filesystem checks to a slash-containing revision", () => {
    fs.ensureDirSync(path.join(workspace, "feature"));
    fs.symlinkSync(
      path.join(fixture, "outside"),
      path.join(workspace, "feature/topic"),
      "dir",
    );
    expect(() =>
      validateProxyRequest("git", ["show", "feature/topic"]),
    ).not.toThrow();
    expect(() =>
      validateProxyRequest("git", ["diff", "feature/topic"]),
    ).not.toThrow();
  });
  it("checks cwd even without explicit paths", () => {
    cwd.mockReturnValue(path.join(workspace, ".env"));
    for (const name of ["status", "log", "show", "diff"]) {
      expect(() => validateProxyRequest("git", [name])).toThrow(/restricted/i);
    }
  });
  it("resolves blob paths from repository root in a nested cwd", () => {
    const nested = path.join(workspace, "nested");
    fs.ensureDirSync(nested);
    fs.writeFileSync(path.join(nested, "file.txt"), "nested");
    cwd.mockReturnValue(nested);
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:nested/file.txt"]),
    ).not.toThrow();
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:file.txt"]),
    ).toThrow(/outside the project directory/i);
  });
  it("recognizes a worktree .git file without reading its content", () => {
    fs.removeSync(path.join(workspace, ".git"));
    fs.writeFileSync(
      path.join(workspace, ".git"),
      "gitdir: /metadata/location\n",
    );
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:file.txt"]),
    ).not.toThrow();
  });
  it("rejects a symlink .git marker", () => {
    fs.removeSync(path.join(workspace, ".git"));
    fs.symlinkSync(
      path.join(fixture, "outside"),
      path.join(workspace, ".git"),
      "dir",
    );
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:file.txt"]),
    ).toThrow(/repository marker/i);
  });
  it("rejects blob lookup without a repository root but keeps ordinary forms syntactic", () => {
    fs.removeSync(path.join(workspace, ".git"));
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:file.txt"]),
    ).toThrow(/cannot establish/i);
    expect(() => validateProxyRequest("git", ["show", "HEAD"])).not.toThrow();
  });
  it("propagates marker lookup failures", () => {
    const realLstat = fs.lstatSync.bind(fs);
    vi.spyOn(fs, "lstatSync").mockImplementation(
      (target: Parameters<typeof fs.lstatSync>[0]) => {
        if (String(target).endsWith(`${path.sep}.git`))
          throw new Error("marker lookup failed");
        return realLstat(target);
      },
    );
    expect(() =>
      validateProxyRequest("git", ["show", "HEAD:file.txt"]),
    ).toThrow("marker lookup failed");
  });
  it.each(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"])(
    "rejects ambient override %s",
    (key) => {
      process.env[key] = "override";
      expect(() => validateProxyRequest("git", ["status"])).toThrow(
        /workspace override/i,
      );
    },
  );
});
