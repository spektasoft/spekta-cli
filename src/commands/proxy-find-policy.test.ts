import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProxyRequest } from "./proxy-policy";

let fixture: string;
let workspace: string;

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-find-policy-"));
  workspace = path.join(fixture, "workspace");

  fs.ensureDirSync(path.join(workspace, "directory"));
  fs.ensureDirSync(path.join(workspace, "directory", "nested"));
  fs.ensureDirSync(path.join(workspace, "space name"));
  fs.ensureDirSync(path.join(workspace, "..internal"));
  fs.ensureDirSync(path.join(workspace, "-directory"));
  fs.ensureDirSync(path.join(workspace, ".env"));
  fs.ensureDirSync(path.join(fixture, "outside"));
  fs.writeFileSync(path.join(workspace, "file.txt"), "file");

  fs.symlinkSync(
    path.join(workspace, "directory"),
    path.join(workspace, "internal-alias"),
    "dir",
  );
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

  vi.spyOn(process, "cwd").mockReturnValue(workspace);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.removeSync(fixture);
});

describe("restricted find through validateProxyRequest", () => {
  it.each([
    { args: [] },
    { args: ["."] },
    { args: ["directory"] },
    { args: ["./directory"] },
    { args: ["directory/nested"] },
    { args: ["space name"] },
    { args: ["..internal"] },
    { args: ["./-directory"] },
    { args: ["internal-alias"] },
    { args: ["-type", "f"] },
    { args: ["-type", "d"] },
    { args: ["-name", "*.ts"] },
    { args: ["-print"] },
    { args: [".", "-type", "f", "-name", "*.ts"] },
    { args: [".", "-name", "*.ts", "-type", "f"] },
    { args: ["directory", "-type", "d", "-name", "nested", "-print"] },
  ])("accepts $args without changing the request", ({ args }) => {
    const original = [...args];

    expect(() => validateProxyRequest("find", args)).not.toThrow();
    expect(args).toEqual(original);
  });

  it.each([
    "*.ts",
    "file[0-9]?.ts",
    ".env",
    "../outside",
    "/outside/*.ts",
    String.raw`C:\outside\*.ts`,
    "-exec",
    "-delete",
    "-print",
    "space name",
    "$(touch marker)",
    "name; touch marker",
  ])(
    "treats name pattern %s as a literal value, not a path or action",
    (pattern) => {
      const args = [".", "-name", pattern];
      const original = [...args];

      expect(() => validateProxyRequest("find", args)).not.toThrow();
      expect(args).toEqual(original);
    },
  );

  it.each([
    { args: ["-type"] },
    { args: ["-type", ""] },
    { args: ["-type", "l"] },
    { args: ["-type", "ff"] },
    { args: ["-type", "-delete"] },
    { args: ["-name"] },
    { args: ["-name", ""] },
    { args: [".", "-type", "f", "-type", "d"] },
    { args: [".", "-name", "*.ts", "-name", "*.js"] },
    { args: [".", "-print", "-print"] },
    { args: [".", "-print", "-name", "*.ts"] },
    { args: [".", "directory"] },
    { args: [".", "-type", "f", "directory"] },
  ])("rejects malformed expressions $args", ({ args }) => {
    expect(() => validateProxyRequest("find", args)).toThrow(
      /Execution refused/i,
    );
  });

  it.each([
    "-exec",
    "-execdir",
    "-ok",
    "-okdir",
    "-delete",
    "-fprint",
    "-fprint0",
    "-fprintf",
    "-fls",
    "-printf",
    "-print0",
    "-ls",
    "-quit",
    "-prune",
    "-regex",
    "-iname",
    "-path",
    "-newer",
    "-follow",
    "-depth",
    "-xdev",
    "-mount",
    "-maxdepth",
    "-mindepth",
    "-files0-from",
    "-H",
    "-L",
    "-P",
    "-O",
    "-D",
    "-a",
    "-and",
    "-o",
    "-or",
    "-not",
    "!",
    "(",
    ")",
    ",",
    "--",
    "--help",
    "--version",
  ])("rejects unsupported token %s before execution", (token) => {
    expect(() => validateProxyRequest("find", [".", token])).toThrow(
      /unsupported find token/i,
    );
  });

  it.each([
    "!",
    "(",
    ")",
    "",
    "*.ts",
    "directory/",
    "directory//nested",
    "directory/./nested",
    "././directory",
    "directory/../directory",
    "internal-alias/../directory",
    "internal-alias/.",
    "~/directory",
    "directory:name",
    String.raw`directory\nested`,
  ])("rejects unsupported root syntax %s", (root) => {
    expect(() => validateProxyRequest("find", [root])).toThrow(
      /Execution refused|Access Denied/i,
    );
  });

  it.each([
    "bad\0value",
    "bad\nvalue",
    "bad\rvalue",
    "bad\tvalue",
    `bad${String.fromCharCode(127)}value`,
  ])("rejects control characters in roots and patterns", (value) => {
    expect(() => validateProxyRequest("find", [value])).toThrow(
      /invalid find argument/i,
    );
    expect(() => validateProxyRequest("find", [".", "-name", value])).toThrow(
      /invalid find argument/i,
    );
  });

  it.each(["file.txt", "missing", "dangling"])(
    "rejects root %s when it is not an existing directory",
    (root) => {
      expect(() => validateProxyRequest("find", [root])).toThrow(
        /existing workspace directory/i,
      );
    },
  );

  it.each([".env", ".env/child", "restricted-alias"])(
    "rejects restricted root %s",
    (root) => {
      expect(() => validateProxyRequest("find", [root])).toThrow(/restricted/i);
    },
  );

  it("rejects POSIX, Windows, UNC, and escaping symlink roots", () => {
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
      expect(() => validateProxyRequest("find", [root])).toThrow(
        /outside the project directory/i,
      );
    }
  });

  it("validates the default root when cwd is restricted", () => {
    vi.spyOn(process, "cwd").mockImplementation(() =>
      path.join(workspace, ".env"),
    );

    expect(() => validateProxyRequest("find", [])).toThrow(/restricted/i);
    expect(() => validateProxyRequest("find", ["-name", "*.ts"])).toThrow(
      /restricted/i,
    );
  });

  it("fails closed when directory inspection fails", () => {
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    expect(() => validateProxyRequest("find", ["directory"])).toThrow(
      /existing workspace directory/i,
    );
  });

  it("fails closed when canonical lookup fails", () => {
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error("canonical lookup failed");
    });

    expect(() => validateProxyRequest("find", ["directory"])).toThrow(
      /canonical lookup failed/i,
    );
  });

  it.each([
    { args: ["--spekta-force"] },
    { args: [".", "--spekta-force"] },
    { args: [".", "-name", "--spekta-force"] },
    { args: [".", "-name", "--spekta-force=true"] },
  ])("preserves the shared force-option rejection for $args", ({ args }) => {
    expect(() => validateProxyRequest("find", args)).toThrow(
      /unsupported option.*--spekta-force/i,
    );
  });
});
