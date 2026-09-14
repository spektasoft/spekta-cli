import { describe, it, expect } from "vitest";
import { buildGrepArgs } from "./grep-args-builder";

describe("buildGrepArgs", () => {
  it("always disables git-requirement so nested blanket .gitignore files are honored regardless of git detection", async () => {
    const args = await buildGrepArgs({ pattern: "foo" });
    expect(args).toContain("--no-require-git");
  });

  it("includes the pattern and default search path", async () => {
    const args = await buildGrepArgs({ pattern: "foo" });
    expect(args[0]).toBe("foo");
    expect(args[1]).toBe(".");
  });

  it("respects an explicit search path", async () => {
    const args = await buildGrepArgs({ pattern: "foo", path: "src" });
    expect(args[1]).toBe("src");
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
    expect(unset).not.toContain("--case-sensitive");
  });

  it("expands a comma-separated globs string into multiple -g flags", async () => {
    const args = await buildGrepArgs({
      pattern: "foo",
      globs: "*test*.*,*spec*.*",
    });
    const gIndices = args.reduce<number[]>((acc, val, idx) => {
      if (val === "-g") acc.push(idx);
      return acc;
    }, []);
    expect(gIndices.length).toBe(2);
    expect(args[gIndices[0] + 1]).toBe("*test*.*");
    expect(args[gIndices[1] + 1]).toBe("*spec*.*");
  });
});
