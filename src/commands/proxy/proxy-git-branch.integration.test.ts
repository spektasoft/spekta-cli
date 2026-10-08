import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../../utils/read-utils";
import { rejectedBranchRequests } from "./proxy-branch.test-fixtures";
import { useRealGitFixture, missing } from "./proxy-git.integration-harness";

describe.skipIf(missing.length > 0)(
  `real Git/RTK branch inspection${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  () => {
    const context = useRealGitFixture();
    const { fixtureGit, snapshotRepository, both } = context;

    it("lists local and remote branches and filters patterns without creating refs", async () => {
      await fixtureGit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      await fixtureGit([
        "update-ref",
        "refs/remotes/origin/topic",
        "feature/topic",
      ]);
      await fixtureGit(["config", "branch.feature/topic.remote", "origin"]);
      await fixtureGit([
        "config",
        "branch.feature/topic.merge",
        "refs/heads/topic",
      ]);
      const before = snapshotRepository();
      const local = await both(["branch"]);
      expect(local.mcp.isError).toBe(false);
      expect(local.mcp.content[0].text).toContain("main");
      expect(local.mcp.content[0].text).toContain("feature/topic");
      expect(local.mcp.content[0].text).not.toContain("origin/");
      for (const flag of ["--all", "-a"]) {
        const result = await both(["branch", flag]);
        expect(result.mcp.isError, result.mcp.content[0].text).toBe(false);
        expect(result.mcp.content[0].text).toContain("feature/topic");
        expect(result.mcp.content[0].text).toContain("origin/main");
      }
      for (const flag of ["--remotes", "-r"]) {
        const result = await both(["branch", flag]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("origin/topic");
        expect(result.mcp.content[0].text).not.toContain("feature/topic");
      }
      for (const pattern of ["feature/*", "feature/to?ic", "feature/[t]opic"]) {
        const result = await both(["branch", "--list", pattern]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("feature/topic");
        expect(result.mcp.content[0].text).not.toContain("main");
        expect(result.cli).toContain("feature/topic");
      }
      const multiple = await both(["branch", "-l", "--", "main", "feature/*"]);
      expect(multiple.mcp.isError).toBe(false);
      expect(multiple.mcp.content[0].text).toContain("main");
      expect(multiple.mcp.content[0].text).toContain("feature/topic");
      const remotePattern = await both([
        "branch",
        "-r",
        "--list",
        "origin/to*",
      ]);
      expect(remotePattern.mcp.isError).toBe(false);
      expect(remotePattern.mcp.content[0].text).toContain("origin/topic");
      expect(remotePattern.mcp.content[0].text).not.toContain("origin/main");
      const unmatched = await both(["branch", "--list", "new-branch"]);
      expect(unmatched.mcp.isError).toBe(false);
      expect(unmatched.mcp.content[0].text).toBe("");
      const nested = vi
        .spyOn(process, "cwd")
        .mockReturnValue(path.join(context.workspace, "nested"));
      const nestedResult = await both(["branch", "--list", "feature/*"]);
      expect(nestedResult.mcp.isError).toBe(false);
      expect(nestedResult.mcp.content[0].text).toContain("feature/topic");
      nested.mockReturnValue(context.workspace);
      expect(snapshotRepository()).toEqual(before);
    }, 30000);

    it("leaves refs, reflogs, and branch configuration unchanged for every rejection", async () => {
      await fixtureGit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      await fixtureGit(["config", "branch.feature/topic.remote", "origin"]);
      await fixtureGit([
        "config",
        "branch.feature/topic.merge",
        "refs/heads/main",
      ]);
      const before = snapshotRepository();
      for (const [args, reason] of rejectedBranchRequests) {
        process.exitCode = undefined;
        const result = await both(args);
        expect(result.mcp.isError).toBe(true);
        expect(result.mcp.content[0].text).toMatch(reason);
        expect(result.cli).toBe("");
        expect(vi.mocked(console.error).mock.calls[0][0]).toBe(
          result.mcp.content[0].text,
        );
        expect(process.exitCode).toBe(1);
        expect(snapshotRepository()).toEqual(before);
      }
      for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) {
        process.env[key] = context.workspace;
        const result = await both(["branch", "--list", "*"]);
        expect(result.mcp.isError).toBe(true);
        expect(result.mcp.content[0].text).toMatch(/workspace override/i);
        expect(snapshotRepository()).toEqual(before);
        delete process.env[key];
      }
    }, 30000);

    it("lists an unborn repository without creating branches and reports a nonrepository failure", async () => {
      const unborn = path.join(context.fixture, "branch-unborn");
      const outside = path.join(context.fixture, "branch-nonrepository");
      fs.ensureDirSync(unborn);
      fs.ensureDirSync(outside);
      await execa("git", ["init", "--template=", "-b", "main"], {
        cwd: unborn,
      });
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(unborn);
      const before = snapshotRepository(unborn);
      for (const args of [
        ["branch"],
        ["branch", "--list"],
        ["branch", "--list", "new-branch"],
        ["branch", "--all"],
        ["branch", "--remotes"],
      ]) {
        const result = await both(args);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toBe("");
        expect(snapshotRepository(unborn)).toEqual(before);
      }
      cwd.mockReturnValue(outside);
      const outsideBefore = snapshotRepository(outside);
      const result = await both(["branch"]);
      expect(result.mcp.isError).toBe(true);
      expect(result.mcp.content[0].text).toMatch(
        /RTK command failed with exit status/i,
      );
      expect(result.cli).toContain("FAILED: Exit");
      expect(process.exitCode).not.toBe(0);
      expect(snapshotRepository(outside)).toEqual(outsideBefore);
    });

    it("withholds verbose commit text while retaining the selected branch names", async () => {
      const denied = "DENIED_BRANCH_COMMIT_SUBJECT_7f91";
      await fixtureGit(["commit", "--allow-empty", "-m", denied]);
      await fixtureGit(["branch", "metadata-check"]);

      for (const args of [
        ["branch", "--verbose"],
        ["branch", "-v", "-v"],
        [
          "branch",
          "--all",
          "--list",
          "--verbose",
          "--",
          "main",
          "metadata-check",
        ],
      ]) {
        const result = await both(args);
        expect(result.mcp.isError, result.mcp.content[0].text).toBe(false);
        expect(result.cli).toContain("metadata-check");
        expect(result.mcp.content[0].text).toContain("metadata-check");
        expect(result.cli).not.toContain(denied);
        expect(result.mcp.content[0].text).not.toContain(denied);
      }
    });

    it("bounds the complete CLI and MCP response for long branch listings", async () => {
      const head = await fixtureGit(["rev-parse", "HEAD"]);
      const refs = Array.from(
        { length: 600 },
        (_, index) =>
          `create refs/heads/budget-${String(index).padStart(3, "0")} ${head}`,
      ).join("\n");
      await execa("git", ["update-ref", "--stdin"], {
        cwd: context.workspace,
        input: `${refs}\n`,
      });

      const result = await both(["branch", "--list", "budget-*"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.cli).toContain("OUTPUT TRUNCATED");
      expect(getTokenCount(`${result.cli}\n`)).toBeLessThanOrEqual(1000);
      expect(
        getTokenCount(
          JSON.stringify({
            isError: result.mcp.isError,
            content: result.mcp.content,
          }),
        ),
      ).toBeLessThanOrEqual(1000);
      expect(result.mcp.content[0].text).toContain("lines collapsed");
    });
  },
);
