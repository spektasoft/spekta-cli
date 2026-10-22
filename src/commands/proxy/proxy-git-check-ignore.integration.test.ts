import fs from "fs-extra";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../../utils/read-utils";
import { missing, useRealGitFixture } from "./proxy-git.integration-harness";

describe.skipIf(missing.length > 0)("Git check-ignore through CLI/MCP", () => {
  const context = useRealGitFixture();

  it("reports whether one accessible path matches Git ignore rules", async () => {
    fs.writeFileSync(path.join(context.workspace, ".gitignore"), "file.txt\n");

    const ignored = await context.both(["check-ignore", "file.txt"]);
    expect(ignored.cli).toContain("git_ignored");
    expect(ignored.mcp.isError).toBe(false);
    expect(ignored.mcp.content[0].text).toBe("git_ignored");

    const allowed = await context.both(["check-ignore", "other.txt"]);
    expect(allowed.cli).toContain("not_git_ignored");
    expect(allowed.mcp.isError).toBe(false);
    expect(allowed.mcp.content[0].text).toBe("not_git_ignored");
  });

  it("uses --no-index and checks the supplied and canonical symlink paths", async () => {
    fs.writeFileSync(
      path.join(context.workspace, ".gitignore"),
      "file.txt\ntarget.txt\ntarget-link.txt\nalias-only.txt\n",
    );
    fs.writeFileSync(path.join(context.workspace, "target.txt"), "safe\n");
    fs.writeFileSync(path.join(context.workspace, "target-two.txt"), "safe\n");
    fs.symlinkSync(
      path.join(context.workspace, "target.txt"),
      path.join(context.workspace, "target-link.txt"),
    );
    fs.symlinkSync(
      path.join(context.workspace, "target-two.txt"),
      path.join(context.workspace, "alias-only.txt"),
    );

    for (const target of ["file.txt", "target-link.txt", "alias-only.txt"]) {
      const result = await context.both(["check-ignore", target]);
      expect(result.mcp.content[0].text, target).toBe("git_ignored");
      expect(result.mcp.isError).toBe(false);
      expect(result.cli).toContain("git_ignored");
    }
  });

  it("applies Git negations while keeping Spekta-ignored paths unavailable", async () => {
    fs.writeFileSync(
      path.join(context.workspace, ".gitignore"),
      "*.log\n!keep.log\n",
    );
    fs.writeFileSync(
      path.join(context.workspace, ".spektaignore"),
      "private.log\nprivate-target.txt\n!allowed.log\n",
    );
    for (const name of [
      "private.log",
      "private-target.txt",
      "allowed.log",
      "keep.log",
    ]) {
      fs.writeFileSync(path.join(context.workspace, name), "safe\n");
    }
    fs.symlinkSync(
      path.join(context.workspace, "private-target.txt"),
      path.join(context.workspace, "private-alias.txt"),
    );

    const spektaDenied = await context.both(["check-ignore", "private.log"]);
    expect(spektaDenied.mcp.content[0].text).toBe(
      "unavailable_access: Path is unavailable.",
    );
    expect(spektaDenied.mcp.isError).toBe(true);
    const canonicalDenied = await context.both([
      "check-ignore",
      "private-alias.txt",
    ]);
    expect(canonicalDenied.mcp.content[0].text).toBe(
      "unavailable_access: Path is unavailable.",
    );

    const spektaAllowed = await context.both(["check-ignore", "allowed.log"]);
    expect(spektaAllowed.mcp.content[0].text).toBe("git_ignored");
    const gitNegated = await context.both(["check-ignore", "keep.log"]);
    expect(gitNegated.mcp.content[0].text).toBe("not_git_ignored");

    const dashPath = await context.both(["check-ignore", "--", "-file"]);
    expect(dashPath.mcp.content[0].text).toBe("not_git_ignored");
  });

  it("checks directories themselves without enumerating ignored descendants", async () => {
    fs.ensureDirSync(path.join(context.workspace, "container"));
    fs.writeFileSync(
      path.join(context.workspace, "container", "child.txt"),
      "safe\n",
    );
    fs.writeFileSync(
      path.join(context.workspace, ".gitignore"),
      "child.txt\nignored-directory/\n",
    );
    fs.ensureDirSync(path.join(context.workspace, "ignored-directory"));

    const parent = await context.both(["check-ignore", "container"]);
    expect(parent.mcp.content[0].text).toBe("not_git_ignored");
    expect(JSON.stringify(parent)).not.toContain("child.txt");
    const ignoredDirectory = await context.both([
      "check-ignore",
      "ignored-directory",
    ]);
    expect(ignoredDirectory.mcp.content[0].text).toBe("git_ignored");
  });

  it("conceals denied and nonexistent paths with the same response and disposition", async () => {
    fs.writeFileSync(
      path.join(context.workspace, ".gitignore"),
      "missing*.txt\n",
    );
    fs.writeFileSync(
      path.join(context.workspace, ".spektaignore"),
      "private.txt\n",
    );
    fs.writeFileSync(path.join(context.workspace, "private.txt"), "secret\n");
    fs.writeFileSync(path.join(context.workspace, ".env"), "secret\n");
    fs.writeFileSync(path.join(context.fixture, "outside.txt"), "outside\n");
    fs.symlinkSync(
      path.join(context.fixture, "outside.txt"),
      path.join(context.workspace, "escaping-link.txt"),
    );
    fs.symlinkSync(
      path.join(context.workspace, "missing-target.txt"),
      path.join(context.workspace, "dangling-link.txt"),
    );

    const cases = [
      "private.txt",
      ".env",
      "missing-match.txt",
      "missing-plain.txt",
      "../outside.txt",
      "escaping-link.txt",
      "dangling-link.txt",
    ];
    const results = [];
    for (const target of cases) {
      results.push(await context.both(["check-ignore", target]));
    }
    for (const result of results) {
      expect(result.mcp.content[0].text).toBe(
        "unavailable_access: Path is unavailable.",
      );
      expect(result.mcp.isError).toBe(true);
      expect(result.cli).toContain("unavailable_access: Path is unavailable.");
    }
    const baseline = results[cases.indexOf("missing-plain.txt")];
    for (const target of [
      "private.txt",
      ".env",
      "missing-match.txt",
      "../outside.txt",
      "escaping-link.txt",
      "dangling-link.txt",
    ]) {
      const denied = results[cases.indexOf(target)];
      expect(denied.cli).toBe(baseline.cli);
      expect(denied.mcp).toEqual(baseline.mcp);
    }
    expect(JSON.stringify(results)).not.toMatch(
      /private\.txt|\.env|missing-match|missing-plain|outside\.txt|escaping-link|dangling-link|secret|outside/,
    );
  });

  it("requires exactly one explicit path and preserves complete response budgets", async () => {
    for (const args of [
      ["check-ignore"],
      ["check-ignore", "file.txt", "other.txt"],
      ["check-ignore", "--not-a-path"],
    ]) {
      const rejected = await context.both(args);
      expect(rejected.mcp.isError).toBe(true);
    }

    const result = await context.both(["check-ignore", "other.txt"], 100);
    expect(result.mcp.isError).toBe(false);
    expect(result.mcp.content[0].text).toBe("not_git_ignored");
    expect(getTokenCount(result.cli + "\n")).toBeLessThanOrEqual(100);
    expect(getTokenCount(JSON.stringify(result.mcp))).toBeLessThanOrEqual(100);
  });

  it("returns a generic internal failure when Git cannot inspect the repository", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-non-git-"));
    fs.writeFileSync(path.join(directory, "visible.txt"), "safe\n");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
    try {
      const result = await context.both(["check-ignore", "visible.txt"]);
      expect(result.mcp.isError).toBe(true);
      expect(result.mcp.content[0].text).toBe(
        "internal_failure: Git ignore check failed.",
      );
      expect(result.cli).toContain(
        "internal_failure: Git ignore check failed.",
      );
      expect(JSON.stringify(result)).not.toContain(directory);
    } finally {
      cwd.mockRestore();
      fs.removeSync(directory);
    }
  });
});
