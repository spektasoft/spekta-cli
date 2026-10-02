import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProxyRequest } from "./proxy-policy";

let fixture: string;
let workspace: string;

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-proxy-policy-"));
  workspace = path.join(fixture, "workspace");
  fs.ensureDirSync(path.join(workspace, "directory"));
  fs.writeFileSync(path.join(workspace, "file.txt"), "file");
  vi.spyOn(process, "cwd").mockReturnValue(workspace);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.removeSync(fixture);
});

describe("validateProxyRequest", () => {
  it.each([
    { args: [] },
    { args: ["."] },
    { args: ["directory"] },
    { args: ["./directory"] },
  ])(
    "accepts existing workspace directory args $args without altering them",
    ({ args }) => {
      const original = [...args];
      expect(() => validateProxyRequest("ls", args)).not.toThrow();
      expect(args).toEqual(original);
    },
  );

  it.each(["-a", "--", "--color=always", "--spekta-force"])(
    "rejects option %s",
    (option) => {
      expect(() => validateProxyRequest("ls", [option])).toThrow(
        /unsupported option/i,
      );
    },
  );

  it("rejects multiple operands and invalid operand characters", () => {
    expect(() => validateProxyRequest("ls", [".", "directory"])).toThrow(
      /at most one/i,
    );
    for (const operand of ["", "bad\0name", "bad\nname", "bad\rname"]) {
      expect(() => validateProxyRequest("ls", [operand])).toThrow(
        /invalid directory operand/i,
      );
    }
  });

  it("rejects files, missing directories, and dangling symlinks", () => {
    fs.symlinkSync(
      path.join(workspace, "missing"),
      path.join(workspace, "dangling"),
      "dir",
    );
    for (const operand of ["file.txt", "missing", "dangling"]) {
      expect(() => validateProxyRequest("ls", [operand])).toThrow(
        /existing workspace directory/i,
      );
    }
  });

  it("accepts an internal symlink and a directory beginning with two dots", () => {
    fs.symlinkSync(
      path.join(workspace, "directory"),
      path.join(workspace, "alias"),
      "dir",
    );
    fs.ensureDirSync(path.join(workspace, "..internal"));
    expect(() => validateProxyRequest("ls", ["alias"])).not.toThrow();
    expect(() => validateProxyRequest("ls", ["..internal"])).not.toThrow();
  });

  it("checks workspace containment even when ls has no operand", () => {
    fs.ensureDirSync(path.join(workspace, ".env"));
    vi.spyOn(process, "cwd").mockReturnValue(path.join(workspace, ".env"));
    expect(() => validateProxyRequest("ls", [])).toThrow(/restricted/i);
  });

  it("fails closed when the directory cannot be inspected", () => {
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    expect(() => validateProxyRequest("ls", ["directory"])).toThrow(
      /existing workspace directory/i,
    );
  });

  it("propagates canonical lookup failures to the caller without permitting execution", () => {
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error("canonical lookup failed");
    });
    expect(() => validateProxyRequest("ls", ["directory"])).toThrow(
      /canonical lookup failed/i,
    );
  });
});
