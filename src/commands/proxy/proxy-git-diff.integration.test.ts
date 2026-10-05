import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../../utils/read-utils";
import {
  useRealGitFixture,
  missing,
  secret,
} from "./proxy-git.integration-harness";

describe.skipIf(missing.length > 0)(
  `real Git/RTK diff semantics${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  () => {
    const context = useRealGitFixture();
    const { fixtureGit, snapshotRepository, both } = context;

    it("keeps working-tree, staged, and HEAD diff meanings distinct", async () => {
      const before = snapshotRepository();
      const working = await both(["diff", "--", "other.txt"]);
      expect(working.mcp.isError).toBe(false);
      expect(working.mcp.content[0].text).toContain("-staged-copy");
      expect(working.mcp.content[0].text).toContain("+unstaged-copy");
      const staged = await both(["diff", "--cached", "--", "other.txt"]);
      expect(staged.mcp.isError).toBe(false);
      expect(staged.mcp.content[0].text).toContain("-other-v2");
      expect(staged.mcp.content[0].text).toContain("+staged-copy");
      expect(staged.mcp.content[0].text).not.toContain("unstaged-copy");
      const alias = await both(["diff", "--staged", "--", "other.txt"]);
      expect(alias.mcp.content[0].text).toBe(staged.mcp.content[0].text);
      const head = await both(["diff", "HEAD", "--", "other.txt"]);
      expect(head.mcp.isError).toBe(false);
      expect(head.mcp.content[0].text).toContain("-other-v2");
      expect(head.mcp.content[0].text).toContain("+unstaged-copy");
      expect(head.mcp.content[0].text).not.toContain("+staged-copy");
      expect(snapshotRepository()).toEqual(before);
    });

    it("renders revision patches for unusual quoted paths safely", async () => {
      const result = await both(["diff", "HEAD", "--", "space name"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.cli).toContain("diff --git");
      expect(result.cli).toContain("space name");
      expect(result.mcp.content[0].text).toContain("spaces-blob");
    });

    it("filters name-only, name-status, and stat summaries by eligible paths", async () => {
      fs.writeFileSync(
        path.join(context.workspace, ".gitignore"),
        "denied.txt\n",
      );
      fs.writeFileSync(path.join(context.workspace, "denied.txt"), "hidden\n");
      fs.writeFileSync(
        path.join(context.workspace, "visible.txt"),
        "visible\n",
      );
      await fixtureGit(["add", "--", ".gitignore", "visible.txt"]);
      await fixtureGit(["add", "-f", "--", "denied.txt"]);
      await fixtureGit(["commit", "-m", "SUMMARY_FIXTURE"]);
      fs.writeFileSync(
        path.join(context.workspace, "denied.txt"),
        "hidden changed\n",
      );
      fs.writeFileSync(
        path.join(context.workspace, "visible.txt"),
        "visible changed\n",
      );

      for (const args of [
        ["diff", "--name-only"],
        ["diff", "--name-status"],
        ["diff", "--stat"],
      ]) {
        const result = await both(args);
        expect(result.mcp.isError).toBe(false);
        expect(result.cli).toContain("visible.txt");
        expect(result.mcp.content[0].text).toContain("visible.txt");
        expect(result.cli).not.toContain("denied.txt");
        expect(result.mcp.content[0].text).not.toContain("denied.txt");
      }
    });

    it("filters ordinary patch sections by eligible paths", async () => {
      fs.writeFileSync(
        path.join(context.workspace, ".gitignore"),
        "denied.txt\n",
      );
      fs.writeFileSync(
        path.join(context.workspace, "denied.txt"),
        "private-v1\n",
      );
      fs.writeFileSync(
        path.join(context.workspace, "visible.txt"),
        "public-v1\n",
      );
      await fixtureGit(["add", "--", ".gitignore", "visible.txt"]);
      await fixtureGit(["add", "-f", "--", "denied.txt"]);
      await fixtureGit(["commit", "-m", "PATCH_FIXTURE"]);
      fs.writeFileSync(
        path.join(context.workspace, "denied.txt"),
        "private-v2\n",
      );
      fs.writeFileSync(
        path.join(context.workspace, "visible.txt"),
        "public-v2\n",
      );

      const result = await both(["diff"]);
      expect(result.cli).toContain("public-v1");
      expect(result.mcp.content[0].text).toContain("public-v2");
      for (const text of [result.cli, result.mcp.content[0].text]) {
        expect(text).not.toContain("denied.txt");
        expect(text).not.toContain("private-v1");
        expect(text).not.toContain("private-v2");
      }
    });

    it("rejects rename patch representations without returning paths", async () => {
      await fixtureGit(["mv", "filename-only", "renamed-file.txt"]);
      const result = await both(["diff", "--cached"]);
      expect(result.mcp.isError).toBe(true);
      expect(result.mcp.content[0].text).toContain(
        "rename and copy patches are unsupported",
      );
      expect(result.cli).not.toContain("file.txt");
      expect(result.cli).not.toContain("renamed-file.txt");
    });

    it("reports a failed patch child without forwarding its diagnostics", async () => {
      const result = await both(["diff", "missing-revision"]);
      expect(result.mcp.isError).toBe(true);
      expect(result.mcp.content[0].text).toMatch(/exit status/);
      expect(result.mcp.content[0].text).not.toContain("fatal:");
      expect(result.cli).not.toContain("fatal:");
    });

    it("compares revisions and preserves hashes and historical missing paths", async () => {
      const hash = await fixtureGit(["rev-parse", "HEAD"]);
      const before = snapshotRepository();
      const pair = await both(["diff", "HEAD~1", hash, "--", "file.txt"]);
      expect(pair.mcp.isError).toBe(false);
      expect(pair.mcp.content[0].text).toContain("-safe-v1");
      expect(pair.mcp.content[0].text).toContain("+safe-v2");
      expect(pair.mcp.content[0].text).not.toContain("working-copy");
      const range = await both(["diff", `HEAD~1..${hash}`, "--", "file.txt"]);
      expect(range.mcp.content[0].text).toBe(pair.mcp.content[0].text);
      const deleted = await both(["diff", "HEAD~1", hash, "--", "gone.txt"]);
      expect(deleted.mcp.isError).toBe(false);
      expect(deleted.mcp.content[0].text).toContain("-historical-only");
      expect(snapshotRepository()).toEqual(before);
    });

    it("distinguishes two-dot endpoints from three-dot merge-base comparison", async () => {
      await fixtureGit([
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        ".",
      ]);
      await fixtureGit(["checkout", "-b", "left", "HEAD~1"]);
      fs.writeFileSync(path.join(context.workspace, "left.txt"), "left-only\n");
      await fixtureGit(["add", "--", "left.txt"]);
      await fixtureGit(["commit", "-m", "LEFT_COMMIT", "--", "left.txt"]);
      await fixtureGit(["checkout", "-b", "right", "main"]);
      fs.writeFileSync(
        path.join(context.workspace, "right.txt"),
        "right-only\n",
      );
      await fixtureGit(["add", "--", "right.txt"]);
      await fixtureGit(["commit", "-m", "RIGHT_COMMIT", "--", "right.txt"]);
      const before = snapshotRepository();
      const endpoints = await both(["diff", "--name-status", "left..right"]);
      expect(endpoints.mcp.isError).toBe(false);
      expect(endpoints.mcp.content[0].text).toContain("left.txt");
      expect(endpoints.mcp.content[0].text).toContain("right.txt");
      const mergeBase = await both(["diff", "--name-status", "left...right"]);
      expect(mergeBase.mcp.isError).toBe(false);
      expect(mergeBase.mcp.content[0].text).not.toContain("left.txt");
      expect(mergeBase.mcp.content[0].text).toContain("right.txt");
      expect(snapshotRepository()).toEqual(before);
    });

    it("uses cwd-relative paths in a nested workspace", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(
        path.join(context.workspace, "nested"),
      );
      const before = snapshotRepository();
      const allowed = await both(["diff", "--", "file.txt"]);
      expect(allowed.mcp.isError).toBe(false);
      expect(allowed.mcp.content[0].text).toContain("-nested-blob");
      expect(allowed.mcp.content[0].text).toContain("+nested-working");
      expect(allowed.mcp.content[0].text).not.toContain("working-copy");
      const rejected = await both(["diff", "--", "../file.txt"]);
      expect(rejected.mcp.isError).toBe(true);
      expect(rejected.mcp.content[0].text).toMatch(
        /outside the project directory/i,
      );
      expect(snapshotRepository()).toEqual(before);
    });

    it("supports staged inspection before the first commit", async () => {
      const unborn = path.join(context.fixture, "unborn");
      fs.ensureDirSync(unborn);
      const init = await execa("git", ["init", "--template=", "-b", "main"], {
        cwd: unborn,
      });
      expect(init.exitCode).toBe(0);
      fs.writeFileSync(path.join(unborn, "new.txt"), "first-staged\n");
      await execa("git", ["add", "--", "new.txt"], { cwd: unborn });
      vi.spyOn(process, "cwd").mockReturnValue(unborn);
      const before = snapshotRepository(unborn);
      for (const selector of ["--cached", "--staged"]) {
        const result = await both(["diff", selector, "--", "new.txt"]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("+first-staged");
      }
      expect(snapshotRepository(unborn)).toEqual(before);
    });

    it("keeps index metadata unchanged for stat-only worktree changes", async () => {
      await fixtureGit(["config", "diff.autoRefreshIndex", "true"]);
      const unchanged = path.join(context.workspace, "filename-only");
      const stat = fs.statSync(unchanged);
      fs.utimesSync(unchanged, stat.atime, new Date(stat.mtimeMs + 10000));
      const before = snapshotRepository();
      const result = await both(["diff", "--", "filename-only"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toBe("");
      expect(snapshotRepository()).toEqual(before);
    });

    it("condenses and redacts real working-tree and staged patch output", async () => {
      for (const staged of [false, true]) {
        const name = staged ? "large-staged.txt" : "large-working.txt";
        fs.writeFileSync(path.join(context.workspace, name), "baseline\n");
        await fixtureGit(["add", "--", name]);
        await fixtureGit(["commit", "-m", "LARGE_BASE", "--", name]);
        fs.writeFileSync(
          path.join(context.workspace, name),
          `${secret}\n${"large diff line\n".repeat(3000)}`,
        );
        if (staged) await fixtureGit(["add", "--", name]);
        const before = snapshotRepository();
        const result = await both([
          "diff",
          ...(staged ? ["--cached"] : []),
          "--",
          name,
        ]);
        expect(result.mcp.isError).toBe(false);
        expect(result.cli).toContain("OUTPUT TRUNCATED");
        expect(result.mcp.content[0].text).toContain("lines collapsed");
        expect(result.cli).not.toContain(secret);
        expect(result.mcp.content[0].text).not.toContain(secret);
        expect(getTokenCount(result.mcp.content[0].text)).toBeLessThanOrEqual(
          1000,
        );
        expect(getTokenCount(`${result.cli}\n`)).toBeLessThanOrEqual(1000);
        expect(snapshotRepository()).toEqual(before);
      }
    });
  },
);
