import fs from "fs-extra";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import {
  isCommandSafe,
  redactSecrets,
  validateCommandArguments,
} from "./proxy-security";

describe("isCommandSafe", () => {
  it("allows standalone safe commands", () => {
    for (const command of [
      "vitest",
      "jest",
      "pytest",
      "tsc",
      "eslint",
      "ruff",
      "clippy",
      "biome",
      "tree",
      "ps",
      "ls",
    ]) {
      expect(isCommandSafe(command, [])).toBe(true);
    }
  });

  it("allows safe multi-tool subcommands", () => {
    expect(isCommandSafe("git", ["status"])).toBe(true);
    expect(isCommandSafe("git", ["log"])).toBe(true);
    expect(isCommandSafe("git", ["diff"])).toBe(true);
    expect(isCommandSafe("cargo", ["test"])).toBe(true);
    expect(isCommandSafe("cargo", ["check"])).toBe(true);
    expect(isCommandSafe("npm", ["run", "build"])).toBe(true);
    expect(isCommandSafe("pnpm", ["lint"])).toBe(true);
    expect(isCommandSafe("docker", ["build"])).toBe(true);
  });

  it("rejects destructive multi-tool commands", () => {
    expect(isCommandSafe("git", ["reset", "--hard"])).toBe(false);
    expect(isCommandSafe("git", ["clean", "-fd"])).toBe(false);
  });

  it("rejects option values being mistaken for safe subcommands", () => {
    expect(isCommandSafe("git", ["-C", "status", "log"])).toBe(false);
  });

  it("rejects git repository and configuration redirection options", () => {
    expect(isCommandSafe("git", ["--git-dir", ".", "status"])).toBe(false);
    expect(isCommandSafe("git", ["--git-dir=.", "status"])).toBe(false);
    expect(isCommandSafe("git", ["--work-tree", ".", "status"])).toBe(false);
    expect(isCommandSafe("git", ["--work-tree=.", "status"])).toBe(false);
    expect(isCommandSafe("git", ["-c", "core.pager=cat", "status"])).toBe(
      false,
    );
  });

  it("fails closed on unknown leading options", () => {
    expect(isCommandSafe("git", ["--unknown-option", "status"])).toBe(false);
    expect(isCommandSafe("cargo", ["--unknown-option", "test"])).toBe(false);
    expect(isCommandSafe("npm", ["--unknown-option", "run", "build"])).toBe(
      false,
    );
  });

  it("rejects arbitrary destructive commands", () => {
    expect(isCommandSafe("rm", ["-rf", "src"])).toBe(false);
    expect(isCommandSafe("chmod", ["777", "file"])).toBe(false);
  });
});

describe("validateCommandArguments", () => {
  it("rejects restricted files", () => {
    expect(() => validateCommandArguments([".env"])).toThrow(
      /restricted file or path/i,
    );
    expect(() => validateCommandArguments([".gitignore"])).toThrow(
      /restricted file or path/i,
    );
    expect(() => validateCommandArguments([".spektaignore"])).toThrow(
      /restricted file or path/i,
    );
    expect(() => validateCommandArguments(["src/.gitignore"])).toThrow(
      /restricted file or path/i,
    );
    expect(() => validateCommandArguments(["foo/.spektaignore/bar"])).toThrow(
      /restricted file or path/i,
    );
  });

  it("rejects directory traversal outside the project", () => {
    expect(() => validateCommandArguments(["../outside"])).toThrow(
      /outside the project directory/i,
    );
  });

  it("accepts paths inside the project", () => {
    expect(() =>
      validateCommandArguments(["src/index.ts", "./src/commands"]),
    ).not.toThrow();
  });

  it("rejects an existing project-local symlink that resolves outside the project", () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "proxy-security-outside-"),
    );
    const linkPath = path.join(process.cwd(), ".proxy-security-symlink-test");

    try {
      fs.removeSync(linkPath);
      fs.symlinkSync(
        outsideDir,
        linkPath,
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(() =>
        validateCommandArguments([
          path.relative(process.cwd(), path.join(linkPath, "secret.txt")),
        ]),
      ).toThrow(/outside the project directory/i);
    } finally {
      fs.removeSync(linkPath);
      fs.removeSync(outsideDir);
    }
  });

  it("rejects a non-existent descendant below a symlink escaping the project", () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "proxy-security-outside-"),
    );
    const linkPath = path.join(process.cwd(), ".proxy-security-symlink-test");

    try {
      fs.removeSync(linkPath);
      fs.symlinkSync(
        outsideDir,
        linkPath,
        process.platform === "win32" ? "junction" : "dir",
      );

      expect(() =>
        validateCommandArguments([
          path.relative(process.cwd(), path.join(linkPath, "new", "file.ts")),
        ]),
      ).toThrow(/outside the project directory/i);
    } finally {
      fs.removeSync(linkPath);
      fs.removeSync(outsideDir);
    }
  });

  it("rejects POSIX and Windows absolute path syntax", () => {
    for (const argument of [
      "/tmp/outside",
      "C:/outside",
      String.raw`C:\outside`,
      String.raw`\\server\share\outside`,
    ]) {
      expect(() => validateCommandArguments([argument])).toThrow(
        /outside the project directory/i,
      );
    }
  });

  // Secret-redaction coverage is implemented in ./proxy-secret-redaction.test.
});
