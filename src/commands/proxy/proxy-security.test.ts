import fs from "fs-extra";
import os from "os";
import path from "path";

import { describe, expect, it } from "vitest";

import { validateCommandArguments } from "./proxy-security";

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
