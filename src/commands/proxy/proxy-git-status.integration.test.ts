import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../../utils/read-utils";
import { resolveAllowanceSettings } from "../../core/config/allowance";
import { formatProxyOutput } from "./proxy-output";
import { boundGitCliResponse } from "./proxy-git-response-budget";
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
    it("reports eligible untracked files while native ignored entries remain absent", async () => {
      fs.writeFileSync(
        path.join(context.workspace, ".gitignore"),
        "ignored-new.txt\n",
      );
      fs.writeFileSync(
        path.join(context.workspace, "ignored-new.txt"),
        "hidden\n",
      );
      const result = await context.both(["status"]);
      expect(result.mcp.content[0].text).toContain(
        "eligible untracked entries may appear",
      );
      expect(result.mcp.content[0].text).toContain('"untracked.txt"');
      expect(JSON.stringify(result)).not.toContain("ignored-new.txt");
    });
    it("uses explicit allowances and rejects values above the configured ceiling", async () => {
      process.env.SPEKTA_GIT_TOKEN_CEILING = "1200";
      for (let index = 0; index < 60; index++)
        fs.writeFileSync(
          path.join(context.workspace, `allowance-long-filename-${index}.txt`),
          "safe",
        );
      const small = await context.both(["status"], 300);
      expect(small.cli).toContain("OUTPUT TRUNCATED");
      expect(getTokenCount(small.cli + "\n")).toBeLessThanOrEqual(300);
      const larger = await context.both(["status"], 1200);
      expect(larger.cli).not.toContain("OUTPUT TRUNCATED");
      const rejected = await context.both(["status"], 1201);
      expect(rejected.mcp.isError).toBe(true);
      expect(rejected.mcp.content[0].text).toContain(
        "configured Git ceiling of 1200 tokens",
      );
    }, 20000);
    it("budgets unsupported option guidance across the complete CLI response", async () => {
      const wide = await context.both(["status", "--not-supported"], 1000);
      expect(wide.cli).toContain("spekta help git status");
      expect(wide.mcp.content[0].text).toContain("spekta help git status");

      const narrow = await context.both(["status", "--not-supported"], 20);
      expect(narrow.cli).toContain("output_limit_exceeded");
      expect(getTokenCount(narrow.cli + "\n")).toBeLessThanOrEqual(20);

      const tooSmall = await context.both(["status"], 1);
      expect(tooSmall.cli).toContain("usage_error");
      expect(tooSmall.mcp.content[0].text).toContain("usage_error");
      expect(getTokenCount(tooSmall.cli + "\n")).toBeLessThanOrEqual(
        resolveAllowanceSettings("git").defaultTokens,
      );
    });
    it("counts the newline written by console.log at the allowance boundary", async () => {
      const rendered = formatProxyOutput("git", "output_limit_exceeded", {
        exitCode: 1,
      });
      expect(getTokenCount(rendered)).toBe(19);
      expect(getTokenCount(`${rendered}\n`)).toBe(20);
      expect(boundGitCliResponse(rendered, 19, "bounded fallback")).toBe(
        "bounded fallback",
      );

      const result = await context.both(["status"], 19);
      expect(result.cli).toContain("usage_error");
      expect(getTokenCount(`${result.cli}\n`)).toBeLessThanOrEqual(
        resolveAllowanceSettings("git").defaultTokens,
      );
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
