import fs from "fs-extra";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../../utils/read-utils";
import {
  useRealGitFixture,
  missing,
  secret,
} from "./proxy-git.integration-harness";

describe.skipIf(missing.length > 0)(
  `real Git/RTK revisions and blobs${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  () => {
    const context = useRealGitFixture();
    const { fixtureGit, both } = context;

    it("selects requested commits and files rather than unrelated ones", async () => {
      const limited = await both(["log", "--name-only", "-n", "1"]);
      expect(limited.mcp.content[0].text).toContain("file.txt");
      expect(limited.mcp.content[0].text).not.toContain("nested/file.txt");
      const range = await both(["log", "--name-only", "main~1..HEAD"]);
      expect(range.mcp.content[0].text).toContain("file.txt");
      expect(range.mcp.content[0].text).not.toContain("nested/file.txt");
      const patch = await both(["show", "HEAD", "--", "file.txt"]);
      expect(patch.mcp.content[0].text).toContain("safe-v2");
      expect(patch.mcp.content[0].text).not.toContain("other-v2");
      const blob = await both(["show", "HEAD:file.txt"]);
      expect(blob.mcp.content[0].text).toBe("safe-v2\n[REDACTED]");
      expect(blob.mcp.content[0].text).not.toContain("working-copy");
    });

    it("renders ordinary multi-commit history patches without commit prose", async () => {
      const result = await both(["log", "-p", "-n", "2", "--", "file.txt"]);
      expect(
        result.mcp.isError,
        `${result.cli}\n${JSON.stringify(result.mcp.content)}`,
      ).toBe(false);
      expect(result.cli).toContain("safe-v2");
      expect(result.cli).toContain("safe-v1");
      expect(result.mcp.content[0].text).toContain("safe-v2");
      expect(result.mcp.content[0].text).not.toContain("MIXED_HISTORY_SECRET");
      const range = await both([
        "log",
        "--patch",
        "main~1..HEAD",
        "--",
        "file.txt",
      ]);
      expect(range.mcp.isError).toBe(false);
      expect(range.mcp.content[0].text).toContain("safe-v2");
      expect(range.mcp.content[0].text).not.toContain("nested/file.txt");
    });

    it("preserves nested-cwd path selection for historical patches", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(
        path.join(context.workspace, "nested"),
      );
      const result = await both(["log", "-p", "-n", "1", "--", "file.txt"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toContain("nested-blob");
      expect(result.mcp.content[0].text).not.toContain("safe-v2");
    });

    it("filters deleted and denied paths in default show patches", async () => {
      fs.writeFileSync(
        path.join(context.workspace, ".gitignore"),
        "denied.txt\n",
      );
      fs.writeFileSync(
        path.join(context.workspace, "denied.txt"),
        "DENIED_PATCH_BODY\n",
      );
      fs.writeFileSync(
        path.join(context.workspace, "deleted-history.txt"),
        "VISIBLE_DELETED_BODY\n",
      );
      await fixtureGit(["add", "--", ".gitignore", "deleted-history.txt"]);
      await fixtureGit(["add", "-f", "--", "denied.txt"]);
      await fixtureGit(["commit", "-m", "DENIED_PATCH_MESSAGE"]);
      await fixtureGit(["rm", "--", "deleted-history.txt"]);
      await fixtureGit(["commit", "-m", "DELETE_PATCH_MESSAGE"]);

      const result = await both([
        "show",
        "HEAD",
        "--",
        "deleted-history.txt",
        "denied.txt",
      ]);
      expect(result.mcp.isError).toBe(false);
      for (const text of [result.cli, result.mcp.content[0].text]) {
        expect(text).toContain("VISIBLE_DELETED_BODY");
        expect(text).not.toContain("DENIED_PATCH_BODY");
        expect(text).not.toContain("denied.txt");
        expect(text).not.toContain("DENIED_PATCH_MESSAGE");
        expect(text).not.toContain("DELETE_PATCH_MESSAGE");
      }
    });

    it("bounds large history patches and marks condensed output incomplete", async () => {
      fs.writeFileSync(
        path.join(context.workspace, "large-history.txt"),
        "base\n",
      );
      await fixtureGit(["add", "--", "large-history.txt"]);
      await fixtureGit(["commit", "-m", "LARGE_HISTORY_BASE"]);
      fs.writeFileSync(
        path.join(context.workspace, "large-history.txt"),
        `${"history patch line\n".repeat(4000)}`,
      );
      await fixtureGit(["add", "--", "large-history.txt"]);
      await fixtureGit(["commit", "-m", "LARGE_HISTORY_CHANGE"]);

      const result = await both(["show", "HEAD", "--", "large-history.txt"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.cli).toContain("OUTPUT TRUNCATED");
      expect(result.mcp.content[0].text).toContain("lines collapsed");
      expect(getTokenCount(`${result.cli}\n`)).toBeLessThanOrEqual(1000);
      expect(getTokenCount(result.mcp.content[0].text)).toBeLessThanOrEqual(
        1000,
      );
    });

    it("supports a hash revision and historical missing path", async () => {
      const hash = await fixtureGit(["rev-parse", "HEAD"]);
      const hashed = await both(["show", "--name-only", hash]);
      expect(hashed.mcp.isError).toBe(false);
      expect(hashed.mcp.content[0].text).toContain("file.txt");
      const deleted = await both(["show", "HEAD^:gone.txt"]);
      expect(deleted.mcp.content[0].text).toBe("historical-only");
    });

    it("filters historical summary paths and withholds commit prose", async () => {
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
      await fixtureGit(["commit", "-m", "MIXED_HISTORY_SECRET"]);
      fs.removeSync(path.join(context.workspace, "denied.txt"));

      for (const args of [
        ["log", "--name-only", "-n", "1"],
        ["log", "--stat", "-n", "1"],
        ["show", "--name-status", "HEAD"],
        ["show", "--stat", "HEAD"],
      ]) {
        const result = await both(args);
        expect(result.mcp.isError).toBe(false);
        expect(result.cli).toContain("visible.txt");
        expect(result.mcp.content[0].text).toContain("visible.txt");
        expect(result.cli).not.toContain("denied.txt");
        expect(result.mcp.content[0].text).not.toContain("denied.txt");
        expect(result.cli).not.toContain("MIXED_HISTORY_SECRET");
        expect(result.mcp.content[0].text).not.toContain(
          "MIXED_HISTORY_SECRET",
        );
      }

      const freeText = await both(["log", "--oneline", "-n", "1"]);
      expect(freeText.mcp.isError).toBe(true);
      expect(freeText.mcp.content[0].text).not.toContain(
        "MIXED_HISTORY_SECRET",
      );
    });

    it("filters both historical rename identities", async () => {
      await fixtureGit(["mv", "filename-only", "renamed-history.txt"]);
      await fixtureGit(["commit", "-m", "SAFE_RENAME"]);
      const allowed = await both(["show", "--name-status", "HEAD"]);
      expect(allowed.mcp.isError).toBe(false);
      expect(allowed.mcp.content[0].text).toContain("filename-only");
      expect(allowed.mcp.content[0].text).toContain("renamed-history.txt");

      fs.writeFileSync(
        path.join(context.workspace, ".gitignore"),
        "*.private\n",
      );
      await fixtureGit(["mv", "renamed-history.txt", "denied.private"]);
      await fixtureGit(["commit", "-m", "DENIED_RENAME"]);
      const denied = await both(["show", "--name-status", "HEAD"]);
      expect(denied.mcp.isError).toBe(false);
      for (const text of [denied.cli, denied.mcp.content[0].text]) {
        expect(text).not.toContain("renamed-history.txt");
        expect(text).not.toContain("denied.private");
        expect(text).not.toContain("DENIED_RENAME");
      }
    });

    it("keeps repo-relative blob meaning from nested cwd", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(
        path.join(context.workspace, "nested"),
      );
      const allowed = await both(["show", "HEAD:nested/file.txt"]);
      expect(allowed.mcp.content[0].text).toBe("nested-blob");
      const rejected = await both(["show", "HEAD:file.txt"]);
      expect(rejected.mcp.isError).toBe(true);
      expect(rejected.mcp.content[0].text).toMatch(
        /outside the project directory/i,
      );
      expect(console.error).toHaveBeenCalled();
    });

    it("supports a real worktree repository marker", async () => {
      const worktree = path.join(context.fixture, "worktree");
      await fixtureGit(["worktree", "add", "--detach", worktree, "HEAD"]);
      vi.spyOn(process, "cwd").mockReturnValue(worktree);
      const result = await both(["show", "HEAD:nested/file.txt"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toBe("nested-blob");
    });

    it("condenses and redacts actual blob contents", async () => {
      const { cli, mcp } = await both(["show", "HEAD:big.txt"]);
      expect(mcp.isError).toBe(false);
      expect(cli).toContain("OUTPUT TRUNCATED");
      expect(mcp.content[0].text).toContain("lines collapsed");
      expect(cli).not.toContain(secret);
      expect(mcp.content[0].text).not.toContain(secret);
      expect(getTokenCount(mcp.content[0].text)).toBeLessThanOrEqual(1000);
    });

    it.each([
      ["show", "missing-revision"],
      ["show", "HEAD:missing.txt"],
      ["show", "filename-only"],
      ["log", "filename-only"],
      ["diff", "missing-revision"],
      ["diff", "filename-only"],
      ["diff", "--cached", "missing-revision"],
      ["diff", "missing-revision..HEAD"],
      ["diff", "HEAD~1...missing-revision"],
    ])("preserves Git failures for %j", async (...args) => {
      const { cli, mcp } = await both(args);
      expect(mcp.isError).toBe(true);
      expect(cli).toContain("FAILED: Exit");
      expect(mcp.content[0].text).not.toContain("ambiguous-filename");
    });

    it.each(["log", "diff"])(
      "preserves a non-repository failure for %s",
      async (subcommand) => {
        const empty = path.join(context.fixture, "not-a-repository");
        fs.ensureDirSync(empty);
        vi.spyOn(process, "cwd").mockReturnValue(empty);
        const { cli, mcp } = await both([subcommand]);
        expect(mcp.isError).toBe(true);
        expect(cli).toContain("FAILED: Exit");
        expect(mcp.content[0].text).toMatch(/not a git repository/i);
      },
    );
  },
);
