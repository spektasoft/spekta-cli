import fs from "fs-extra";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { validateProxyRequest } from "./proxy-policy";
import {
  fixture,
  workspace,
  useFindPolicyFixture,
} from "./proxy-find-policy.test-fixture";

describe("restricted find through validateProxyRequest", () => {
  useFindPolicyFixture();

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
});
