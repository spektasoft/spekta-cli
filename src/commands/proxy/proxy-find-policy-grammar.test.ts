import { describe, expect, it } from "vitest";
import { validateProxyRequest } from "./proxy-policy";
import { useFindPolicyFixture } from "./proxy-find-policy.test-fixture";

describe("restricted find through validateProxyRequest", () => {
  useFindPolicyFixture();

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
