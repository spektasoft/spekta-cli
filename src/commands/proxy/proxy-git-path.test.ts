import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProxyPathOperand } from "./proxy-path-security";

let fixture: string;
let workspace: string;
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-git-path-"));
  workspace = path.join(fixture, "workspace");
  fs.ensureDirSync(path.join(workspace, "src"));
  fs.ensureDirSync(path.join(fixture, "outside"));
  fs.ensureDirSync(path.join(workspace, ".env"));
  fs.writeFileSync(path.join(workspace, "-file"), "safe");
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
    path.join(workspace, "src"),
    path.join(workspace, "alias"),
    "dir",
  );
  fs.symlinkSync(
    path.join(workspace, "absent"),
    path.join(workspace, "dangling"),
    "dir",
  );
  vi.spyOn(process, "cwd").mockReturnValue(workspace);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.removeSync(fixture);
});

describe("explicit proxy paths", () => {
  it.each([
    ".",
    "src",
    "src/deleted.txt",
    "-file",
    "space name",
    "alias/deleted.txt",
    "..internal",
  ])("accepts ordinary path %s", (operand) => {
    expect(() => validateProxyPathOperand(operand)).not.toThrow();
  });
  it.each([
    "../outside",
    "/tmp/outside",
    "C:/outside",
    String.raw`C:\outside`,
    String.raw`\\server\share`,
    "escape",
    "escape/missing/file",
  ])("rejects external path %s", (operand) => {
    expect(() => validateProxyPathOperand(operand)).toThrow(
      /outside the project directory/i,
    );
  });
  it.each([
    ".env",
    ".gitignore",
    ".spektaignore",
    "src/.env/file",
    "restricted-alias",
    "restricted-alias/missing/file",
  ])("rejects restricted target %s", (operand) => {
    expect(() => validateProxyPathOperand(operand)).toThrow(/restricted/i);
  });
  it.each(["", "bad\0name", "bad\nname", "bad\rname", "bad\tname"])(
    "rejects invalid path %j",
    (operand) => {
      expect(() => validateProxyPathOperand(operand)).toThrow(
        /invalid Git path/i,
      );
    },
  );
  it.each([
    ":(top)file",
    "*.ts",
    "file?",
    "[abc]",
    String.raw`src\file`,
    "~/file",
    "file:part",
  ])("rejects unsupported syntax %s", (operand) => {
    expect(() => validateProxyPathOperand(operand)).toThrow(
      /unsupported Git path/i,
    );
  });
  it.each(["dangling", "dangling/missing"])(
    "fails closed for %s",
    (operand) => {
      expect(() => validateProxyPathOperand(operand)).toThrow();
    },
  );
  it("does not hide canonical lookup errors", () => {
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error("canonical failure");
    });
    expect(() => validateProxyPathOperand("src")).toThrow("canonical failure");
  });
  it("does not hide lstat permission failures", () => {
    vi.spyOn(fs, "lstatSync").mockImplementation(() => {
      throw Object.assign(new Error("lstat denied"), { code: "EACCES" });
    });
    expect(() => validateProxyPathOperand("src")).toThrow("lstat denied");
  });
});
