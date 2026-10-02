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
      const limited = await both(["log", "--oneline", "-n", "1"]);
      expect(limited.mcp.content[0].text).toContain("SECOND_COMMIT");
      expect(limited.mcp.content[0].text).not.toContain("INITIAL_COMMIT");
      const range = await both(["log", "--oneline", "main~1..HEAD"]);
      expect(range.mcp.content[0].text).toContain("SECOND_COMMIT");
      expect(range.mcp.content[0].text).not.toContain("INITIAL_COMMIT");
      const patch = await both(["show", "HEAD", "--", "file.txt"]);
      expect(patch.mcp.content[0].text).toContain("safe-v2");
      expect(patch.mcp.content[0].text).not.toContain("other-v2");
      const blob = await both(["show", "HEAD:file.txt"]);
      expect(blob.mcp.content[0].text).toBe("safe-v2\n[REDACTED]");
      expect(blob.mcp.content[0].text).not.toContain("working-copy");
    });

    it("supports a hash revision and historical missing path", async () => {
      const hash = await fixtureGit(["rev-parse", "HEAD"]);
      const hashed = await both(["show", "--no-patch", hash]);
      expect(hashed.mcp.isError).toBe(false);
      expect(hashed.mcp.content[0].text).toContain("SECOND_COMMIT");
      const deleted = await both(["show", "HEAD^:gone.txt"]);
      expect(deleted.mcp.content[0].text).toBe("historical-only");
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
