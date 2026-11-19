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

  it("does not echo an unsupported operand in the safe usage failure", () => {
    let message = "";
    try {
      validateProxyRequest("ls", ["--private-operand-name"]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe(
      "usage_error: Unsupported option for ls. Use spekta help ls.",
    );
    expect(message).not.toContain("private-operand-name");
  });

  it("accepts multiple operands and rejects invalid operand characters", () => {
    expect(() => validateProxyRequest("ls", [".", "directory"])).not.toThrow();
    for (const operand of ["", "bad\0name", "bad\nname", "bad\rname"]) {
      expect(() => validateProxyRequest("ls", [operand])).toThrow(
        /invalid directory operand/i,
      );
    }
  });

  it("leaves ordinary existence and directory checks to per-operand outcomes", () => {
    for (const operand of ["file.txt", "missing"]) {
      expect(() => validateProxyRequest("ls", [operand])).not.toThrow();
    }
  });

  it("leaves dangling symlink checks to per-operand outcomes", (context) => {
    try {
      fs.symlinkSync(
        path.join(workspace, "missing"),
        path.join(workspace, "dangling"),
        "dir",
      );
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EPERM"
      ) {
        context.skip("Windows denied dangling symlink creation (EPERM)");
      }
      throw error;
    }

    expect(() => validateProxyRequest("ls", ["dangling"])).not.toThrow();
  });

  it("accepts a directory beginning with two dots", () => {
    fs.ensureDirSync(path.join(workspace, "..internal"));
    expect(() => validateProxyRequest("ls", ["..internal"])).not.toThrow();
  });

  it("accepts an internal symlink", (context) => {
    try {
      fs.symlinkSync(
        path.join(workspace, "directory"),
        path.join(workspace, "alias"),
        "dir",
      );
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EPERM"
      ) {
        context.skip("Windows denied internal symlink creation (EPERM)");
      }
      throw error;
    }

    expect(() => validateProxyRequest("ls", ["alias"])).not.toThrow();
  });

  it("leaves workspace containment to the per-operand outcome", () => {
    fs.ensureDirSync(path.join(workspace, ".env"));
    vi.spyOn(process, "cwd").mockReturnValue(path.join(workspace, ".env"));
    expect(() => validateProxyRequest("ls", [])).not.toThrow();
  });

  it("does not inspect directory metadata during syntax validation", () => {
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    expect(() => validateProxyRequest("ls", ["directory"])).not.toThrow();
  });

  it("does not perform canonical path lookup during syntax validation", () => {
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error("canonical lookup failed");
    });
    expect(() => validateProxyRequest("ls", ["directory"])).not.toThrow();
  });
});
