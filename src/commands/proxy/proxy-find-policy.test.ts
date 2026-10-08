import { describe, expect, it } from "vitest";
import { validateProxyRequest } from "./proxy-policy";
import { useFindPolicyFixture } from "./proxy-find-policy.test-fixture";

describe("restricted find through validateProxyRequest", () => {
  useFindPolicyFixture();

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
});
