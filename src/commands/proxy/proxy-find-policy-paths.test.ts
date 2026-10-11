import { describe, expect, it } from "vitest";
import { validateProxyRequest } from "./proxy-policy";
import { useFindPolicyFixture } from "./proxy-find-policy.test-fixture";

describe("find syntax validation defers root eligibility", () => {
  useFindPolicyFixture();

  it.each([
    "file.txt",
    "missing",
    "dangling",
    ".env",
    ".env/child",
    "restricted-alias",
    "../outside",
    "/outside",
    "escape",
    "escape/missing/child",
  ])("accepts %s as an operand for independent eligibility", (root) => {
    expect(() => validateProxyRequest("find", [root])).not.toThrow();
  });

  it.each(["C:/outside", String.raw`C:\outside`, String.raw`\\server\share`])(
    "rejects unsupported Windows root syntax %s",
    (root) => {
      expect(() => validateProxyRequest("find", [root])).toThrow(
        /unsupported find root syntax/i,
      );
    },
  );

  it("uses the default root without eagerly inspecting cwd", () => {
    expect(() => validateProxyRequest("find", [])).not.toThrow();
    expect(() => validateProxyRequest("find", ["-name", "*.ts"])).not.toThrow();
  });
});
