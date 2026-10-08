import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { useRealGitFixture, missing } from "./proxy-git.integration-harness";

describe.skipIf(missing.length > 0)(
  `real Git/RTK external helper safety${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  () => {
    const context = useRealGitFixture();
    const { git, fixtureGit, shellQuote, sentinel, snapshotRepository, both } =
      context;

    it("does not invoke configured external diff or textconv programs", async () => {
      const diff = sentinel("diff");
      const conversion = sentinel("textconv");
      await fixtureGit(["config", "diff.external", shellQuote(diff.program)]);
      await fixtureGit([
        "config",
        "diff.inspect.command",
        shellQuote(diff.program),
      ]);
      await fixtureGit([
        "config",
        "diff.inspect.textconv",
        shellQuote(conversion.program),
      ]);
      fs.writeFileSync(
        path.join(context.workspace, ".gitattributes"),
        "file.txt diff=inspect\n",
      );
      process.env.GIT_EXTERNAL_DIFF = shellQuote(diff.program);
      const diffControl = await git([
        "--no-pager",
        "show",
        "--ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
        "file.txt",
      ]);
      expect(diffControl.exitCode).toBe(0);
      expect(fs.existsSync(diff.marker)).toBe(true);
      fs.removeSync(diff.marker);
      const conversionControl = await git([
        "--no-pager",
        "show",
        "--no-ext-diff",
        "--textconv",
        "HEAD",
        "--",
        "file.txt",
      ]);
      expect(conversionControl.exitCode).toBe(0);
      expect(fs.existsSync(conversion.marker)).toBe(true);
      fs.removeSync(conversion.marker);
      for (const args of [
        ["show"],
        ["show", "-p", "HEAD", "--", "file.txt"],
        ["show", "--stat"],
        ["show", "HEAD:file.txt"],
        ["log", "-p", "-n", "1"],
        ["log", "--stat", "-n", "1"],
        ["log", "--name-status"],
      ]) {
        const result = await both(args);
        expect(
          result.mcp.isError,
          `${args.join(" ")}: ${result.mcp.content[0].text}`,
        ).toBe(false);
        expect(fs.existsSync(diff.marker)).toBe(false);
        expect(fs.existsSync(conversion.marker)).toBe(false);
        expect(result.mcp.content[0].text).not.toContain("SENTINEL OUTPUT");
      }
    }, 30000);

    it("forces short submodule output despite configured inline diff helpers", async () => {
      const child = path.join(context.workspace, "child");
      const helper = sentinel("submodule-diff");
      fs.ensureDirSync(child);
      async function childGit(args: string[]) {
        const result = await execa("git", args, { cwd: child, reject: false });
        if (result.exitCode !== 0) throw new Error(result.stderr);
        return result.stdout;
      }
      await childGit(["init", "--template=", "-b", "main"]);
      await childGit(["config", "user.name", "Proxy Fixture"]);
      await childGit(["config", "user.email", "fixture@example.invalid"]);
      await childGit(["config", "commit.gpgsign", "false"]);
      fs.writeFileSync(path.join(child, "child.txt"), "child-v1\n");
      await childGit(["add", "--", "child.txt"]);
      await childGit(["commit", "-m", "CHILD_INITIAL"]);
      const first = await childGit(["rev-parse", "HEAD"]);
      fs.writeFileSync(
        path.join(context.workspace, ".gitmodules"),
        '[submodule "child"]\n\tpath = child\n\turl = ./child\n',
      );
      await fixtureGit(["add", "--", ".gitmodules"]);
      await fixtureGit([
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${first},child`,
      ]);
      await fixtureGit([
        "commit",
        "-m",
        "CHILD_LINK",
        "--",
        ".gitmodules",
        "child",
      ]);
      fs.writeFileSync(path.join(child, "child.txt"), "child-v2\n");
      await childGit(["add", "--", "child.txt"]);
      await childGit(["commit", "-m", "CHILD_SECOND"]);
      fs.writeFileSync(path.join(child, "child.txt"), "child-working\n");
      await childGit(["config", "diff.external", shellQuote(helper.program)]);
      await fixtureGit(["config", "diff.submodule", "diff"]);
      const control = await git([
        "--no-pager",
        "diff",
        "--submodule=diff",
        "--ext-diff",
        "--",
        "child",
      ]);
      expect(control.exitCode).toBe(0);
      expect(fs.existsSync(helper.marker)).toBe(true);
      fs.removeSync(helper.marker);
      const before = snapshotRepository();
      const result = await both(["diff", "--", "child"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toContain("Subproject commit");
      expect(result.mcp.content[0].text).not.toContain("child-working");
      expect(result.cli).not.toContain("SENTINEL OUTPUT");
      expect(fs.existsSync(helper.marker)).toBe(false);
      expect(snapshotRepository()).toEqual(before);
    });

    it("suppresses every configured diff helper across supported diff forms", async () => {
      const external = sentinel("diff-global");
      const driver = sentinel("diff-driver");
      const ambient = sentinel("diff-ambient");
      const conversion = sentinel("diff-conversion");
      fs.writeFileSync(
        path.join(context.workspace, "file.txt"),
        "sentinel-staged\n",
      );
      await fixtureGit(["add", "--", "file.txt"]);
      fs.writeFileSync(
        path.join(context.workspace, "file.txt"),
        "sentinel-working\n",
      );
      await fixtureGit([
        "config",
        "diff.external",
        shellQuote(external.program),
      ]);
      const globalControl = await git([
        "--no-pager",
        "diff",
        "--ext-diff",
        "--no-textconv",
        "--",
        "file.txt",
      ]);
      expect(globalControl.exitCode).toBe(0);
      expect(fs.existsSync(external.marker)).toBe(true);
      fs.removeSync(external.marker);
      await fixtureGit(["config", "--unset", "diff.external"]);

      fs.writeFileSync(
        path.join(context.workspace, ".gitattributes"),
        "file.txt diff=inspect\n",
      );
      await fixtureGit([
        "config",
        "diff.inspect.command",
        shellQuote(driver.program),
      ]);
      const driverControl = await git([
        "--no-pager",
        "diff",
        "--ext-diff",
        "--no-textconv",
        "--",
        "file.txt",
      ]);
      expect(driverControl.exitCode).toBe(0);
      expect(fs.existsSync(driver.marker)).toBe(true);
      fs.removeSync(driver.marker);
      await fixtureGit(["config", "--unset", "diff.inspect.command"]);

      process.env.GIT_EXTERNAL_DIFF = shellQuote(ambient.program);
      const ambientControl = await git([
        "--no-pager",
        "diff",
        "--ext-diff",
        "--no-textconv",
        "--",
        "file.txt",
      ]);
      expect(ambientControl.exitCode).toBe(0);
      expect(fs.existsSync(ambient.marker)).toBe(true);
      fs.removeSync(ambient.marker);
      delete process.env.GIT_EXTERNAL_DIFF;

      await fixtureGit([
        "config",
        "diff.inspect.textconv",
        shellQuote(conversion.program),
      ]);
      const conversionControl = await git([
        "--no-pager",
        "diff",
        "--no-ext-diff",
        "--textconv",
        "--",
        "file.txt",
      ]);
      expect(conversionControl.exitCode).toBe(0);
      expect(fs.existsSync(conversion.marker)).toBe(true);
      fs.removeSync(conversion.marker);

      await fixtureGit([
        "config",
        "diff.external",
        shellQuote(external.program),
      ]);
      await fixtureGit([
        "config",
        "diff.inspect.command",
        shellQuote(driver.program),
      ]);
      process.env.GIT_EXTERNAL_DIFF = shellQuote(ambient.program);
      const before = snapshotRepository();
      for (const args of [
        ["diff"],
        ["diff", "--cached"],
        ["diff", "--staged", "HEAD"],
        ["diff", "HEAD"],
        ["diff", "HEAD~1", "HEAD"],
        ["diff", "HEAD~1..HEAD"],
        ["diff", "HEAD~1...HEAD"],
        ["diff", "-p", "--", "file.txt"],
        ["diff", "--patch", "--", "file.txt"],
        ["diff", "--stat"],
        ["diff", "--name-only"],
        ["diff", "--name-status"],
        ["diff", "--cached", "--stat", "--", "file.txt"],
      ]) {
        const result = await both(args);
        expect(
          result.mcp.isError,
          `${args.join(" ")}: ${result.mcp.content[0].text}`,
        ).toBe(false);
        for (const helper of [external, driver, ambient, conversion]) {
          expect(fs.existsSync(helper.marker)).toBe(false);
        }
        expect(result.cli).not.toContain("SENTINEL OUTPUT");
        expect(result.mcp.content[0].text).not.toContain("SENTINEL OUTPUT");
        expect(snapshotRepository()).toEqual(before);
      }
    }, 120000);
  },
);
