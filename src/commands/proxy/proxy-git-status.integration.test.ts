import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../../utils/read-utils";
import { missing, useRealGitFixture } from "./proxy-git.integration-harness";

describe.skipIf(missing.length > 0)(
  "Git status disclosure through CLI/MCP",
  () => {
    const context = useRealGitFixture();
    it("filters implicit and directory targets across supported status forms", async () => {
      fs.writeFileSync(path.join(context.workspace, ".env"), "changed secret");
      fs.writeFileSync(
        path.join(context.workspace, ".spektaignore"),
        "denied.txt\nnested/denied.txt\n",
      );
      fs.writeFileSync(path.join(context.workspace, "denied.txt"), "hidden");
      fs.writeFileSync(
        path.join(context.workspace, "nested/denied.txt"),
        "hidden",
      );
      for (const flags of [
        [],
        ["--short"],
        ["--porcelain"],
        ["--porcelain=v2"],
        ["--branch"],
      ]) {
        for (const operands of [[], ["--", "nested"]]) {
          const result = await context.both(["status", ...flags, ...operands]);
          expect(result.mcp.isError).toBe(false);
          expect(result.mcp.content[0].text).toContain("file.txt");
          expect(JSON.stringify(result)).not.toMatch(
            /denied\.txt|\.env|\.spektaignore/,
          );
        }
      }
    });
    it("retains requested branch metadata", async () => {
      for (const flag of ["--porcelain=v1", "--porcelain=v2"]) {
        const result = await context.both(["status", flag, "--branch"]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("main");
      }
    });
    it("retains eligible rename endpoints and deleted paths while hiding denied endpoints", async () => {
      await context.fixtureGit(["mv", "file.txt", "renamed.txt"]);
      await context.fixtureGit(["mv", "space name", ".env-renamed"]);
      await context.fixtureGit(["mv", "--", "-file", "denied-destination.txt"]);
      fs.removeSync(path.join(context.workspace, "filename-only"));
      fs.writeFileSync(
        path.join(context.workspace, ".spektaignore"),
        "space name\ndenied-destination.txt\n",
      );
      for (const flag of ["--porcelain=v1", "--porcelain=v2"]) {
        const result = await context.both(["status", flag]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("renamed.txt");
        expect(result.mcp.content[0].text).toContain("filename-only");
        expect(JSON.stringify(result)).not.toMatch(
          /space name|env-renamed|denied-destination|"-file"/,
        );
      }
    });
    it("expands untracked directories without denied counts and honors untracked=no", async () => {
      fs.ensureDirSync(path.join(context.workspace, "new-directory"));
      fs.writeFileSync(
        path.join(context.workspace, "new-directory/eligible.txt"),
        "safe",
      );
      fs.writeFileSync(
        path.join(context.workspace, "new-directory/.env"),
        "secret",
      );
      for (const mode of ["normal", "all"]) {
        const result = await context.both([
          "status",
          `--untracked-files=${mode}`,
        ]);
        expect(result.mcp.content[0].text).toContain(
          "new-directory/eligible.txt",
        );
        expect(JSON.stringify(result)).not.toContain(".env");
      }
      const hidden = await context.both(["status", "--untracked-files=no"]);
      expect(JSON.stringify(hidden)).not.toContain("new-directory");
    });
    it("limits broad status to a nested workspace", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(
        path.join(context.workspace, "nested"),
      );
      const result = await context.both(["status", "--porcelain=v2"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toContain('"file.txt"');
      expect(JSON.stringify(result)).not.toMatch(
        /other.txt|untracked.txt|nested\//,
      );
    });
    it("reports staged eligible files and branch metadata in an unborn repository", async () => {
      const unborn = path.join(context.fixture, "unborn");
      fs.ensureDirSync(unborn);
      await execa("git", ["init", "--template=", "-b", "main"], {
        cwd: unborn,
      });
      fs.writeFileSync(path.join(unborn, "first.txt"), "first");
      fs.writeFileSync(path.join(unborn, ".env"), "secret");
      await execa("git", ["add", "--", "."], { cwd: unborn });
      vi.spyOn(process, "cwd").mockReturnValue(unborn);
      for (const flag of ["--porcelain=v1", "--porcelain=v2"]) {
        const result = await context.both(["status", flag, "--branch"]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("first.txt");
        expect(result.mcp.content[0].text).toContain("main");
        expect(JSON.stringify(result)).not.toContain(".env");
      }
    });
    it("rejects unsafe names instead of interpreting record-shaped filenames", async () => {
      fs.writeFileSync(
        path.join(context.workspace, "unsafe\nname.txt"),
        "safe",
      );
      const result = await context.both(["status"]);
      expect(result.mcp.isError).toBe(true);
      expect(result.mcp.content[0].text).toContain("could not be attributed");
      expect(JSON.stringify(result)).not.toContain("unsafe");
      expect(process.exitCode).toBe(1);
    });
    it("preserves child failures without forwarding path-bearing diagnostics", async () => {
      const directory = path.join(context.fixture, "not-a-repository");
      fs.ensureDirSync(directory);
      vi.spyOn(process, "cwd").mockReturnValue(directory);
      const result = await context.both(["status"]);
      expect(result.mcp.isError).toBe(true);
      expect(result.mcp.content[0].text).toContain("exit status 128");
      expect(JSON.stringify(result)).not.toContain(directory);
      expect(process.exitCode).toBe(128);
    });
    it("bounds complete CLI and MCP responses after filtering and branch metadata", async () => {
      for (let index = 0; index < 150; index++) {
        fs.writeFileSync(
          path.join(context.workspace, `eligible-long-name-${index}.txt`),
          "safe",
        );
      }
      const result = await context.both(["status", "--branch"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.cli).toContain("OUTPUT TRUNCATED");
      expect(getTokenCount(result.cli + "\n")).toBeLessThanOrEqual(1000);
      expect(getTokenCount(JSON.stringify(result.mcp))).toBeLessThanOrEqual(
        1000,
      );
    }, 20000);

    it("enforces Git ignore rules on tracked files and omits escaping symlinks", async () => {
      fs.writeFileSync(
        path.join(context.workspace, ".gitignore"),
        "file.txt\n",
      );
      fs.writeFileSync(path.join(context.fixture, "outside.txt"), "outside");
      fs.symlinkSync(
        path.join(context.fixture, "outside.txt"),
        path.join(context.workspace, "escape.txt"),
      );
      const result = await context.both(["status"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toContain("other.txt");
      expect(result.mcp.content[0].text).not.toContain('"file.txt"');
      expect(JSON.stringify(result)).not.toMatch(
        /escape.txt|outside.txt|gitignore/,
      );
    });
  },
);
