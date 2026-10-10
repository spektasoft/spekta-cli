import { describe, it, expect } from "vitest";
import { buildGrepArgs } from "./grep-args-builder";
import { RESTRICTED_FILES } from "../utils/security";

describe("buildGrepArgs", () => {
  it("always disables git-requirement so nested blanket .gitignore files are honored regardless of git detection", async () => {
    const args = await buildGrepArgs({ pattern: "foo" });
    expect(args).toContain("--no-require-git");
  });

  it("includes the pattern and default search path", async () => {
    const args = await buildGrepArgs({ pattern: "foo" });
    expect(args[args.indexOf("--regexp") + 1]).toBe("foo");
    expect(args.slice(-2)).toEqual(["--", "."]);
  });

  it("respects an explicit search path", async () => {
    const args = await buildGrepArgs({ pattern: "foo", path: "src" });
    expect(args[args.indexOf("--regexp") + 1]).toBe("foo");
    expect(args.slice(-2)).toEqual(["--", "src"]);
  });

  it("applies case sensitivity flags only when explicitly requested", async () => {
    const insensitive = await buildGrepArgs({
      pattern: "foo",
      case_insensitive: true,
    });
    expect(insensitive).toContain("--ignore-case");

    const sensitive = await buildGrepArgs({
      pattern: "foo",
      case_insensitive: false,
    });
    expect(sensitive).toContain("--case-sensitive");

    const unset = await buildGrepArgs({ pattern: "foo" });
    expect(unset).not.toContain("--ignore-case");
    expect(unset).toContain("--case-sensitive");
  });

  it("keeps legacy comma-delimited glob strings working", async () => {
    const args = await buildGrepArgs({
      pattern: "foo",
      globs: "*test*.*,*spec*.*",
    });
    const globValues = args.reduce<string[]>((acc, val, idx) => {
      if (val === "-g") acc.push(args[idx + 1]);
      return acc;
    }, []);
    expect(globValues).toEqual([
      "*test*.*",
      "*spec*.*",
      ...RESTRICTED_FILES.map((restricted) => `!**/${restricted}`),
    ]);
  });

  it("passes the selected case mode to ripgrep and defaults to case-sensitive", async () => {
    const smart = await buildGrepArgs({ pattern: "foo", case_mode: "smart" });
    expect(smart).toContain("--smart-case");

    const sensitive = await buildGrepArgs({ pattern: "foo" });
    expect(sensitive).toContain("--case-sensitive");
    expect(sensitive).not.toContain("--smart-case");
  });

  it("preserves repeated patterns, paths, and glob values as separate native arguments", async () => {
    const args = await buildGrepArgs({
      patterns: ["first", "second"],
      paths: ["src", "-literal-path"],
      globs: ["*.ts,*.tsx", "!*.test.ts"],
    });
    expect(
      args.slice(args.indexOf("--regexp"), args.indexOf("--line-number")),
    ).toEqual(["--regexp", "first", "--regexp", "second"]);
    expect(args.slice(-3)).toEqual(["--", "src", "-literal-path"]);
    expect(args).toContain("*.ts,*.tsx");
    const globValues = args.reduce<string[]>((acc, val, idx) => {
      if (val === "-g") acc.push(args[idx + 1]);
      return acc;
    }, []);
    expect(globValues).toContain("*.ts,*.tsx");
  });
});
