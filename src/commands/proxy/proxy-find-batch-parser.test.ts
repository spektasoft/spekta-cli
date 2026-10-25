import { describe, expect, it } from "vitest";
import { parseFindBatch } from "./proxy-find-batch-parser";

describe("parseFindBatch", () => {
  it("defaults roots and preserves duplicate roots and predicates", () => {
    expect(
      parseFindBatch(["src", "src", "-type", "f", "-name", "*.ts", "-print"]),
    ).toEqual({
      roots: ["src", "src"],
      predicates: {
        type: "f",
        name: "*.ts",
        print: true,
        args: ["-type", "f", "-name", "*.ts", "-print"],
      },
    });
    expect(parseFindBatch(["-type", "d"]).roots).toEqual(["."]);
  });

  it("preserves predicates in their supplied order and accepts unavailable path syntax", () => {
    expect(
      parseFindBatch(["../outside", "/outside", "-name", "x", "-type", "d"])
        .roots,
    ).toEqual(["../outside", "/outside"]);
    expect(
      parseFindBatch(["-name", "x", "-type", "d"]).predicates.args,
    ).toEqual(["-name", "x", "-type", "d"]);
  });

  it("normalizes Windows relative root separators and keeps POSIX backslashes invalid", () => {
    if (process.platform === "win32") {
      expect(parseFindBatch([String.raw`space dir\nested`]).roots).toEqual([
        "space dir/nested",
      ]);
    } else {
      expect(() => parseFindBatch([String.raw`space dir\nested`])).toThrow();
    }
  });

  it.each(["-exec", "--help", "../outside", "$(touch nope)", "*.ts"])(
    "consumes %s literally as a name",
    (name) => {
      expect(parseFindBatch(["-name", name]).predicates.name).toBe(name);
    },
  );

  it.each([
    ["src", "-name", "x", "other"],
    ["-type", "f", "-type", "d"],
    ["-name", "x", "-name", "y"],
    ["-exec", "echo"],
    ["--spekta-force"],
    ["bad*root"],
    ["C:/outside"],
    ["\\\\server\\share"],
    ["bad\nroot"],
    ["-name", "x", "later-root"],
    ["-name", ""],
  ])("rejects malformed grammar before any filesystem work: %j", (args) => {
    expect(() => parseFindBatch(args)).toThrow();
  });
});
