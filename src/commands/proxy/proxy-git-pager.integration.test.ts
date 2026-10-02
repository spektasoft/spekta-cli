import fs from "fs-extra";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { prepareRtkInvocation } from "./proxy-execution";
import { useRealGitFixture, missing } from "./proxy-git.integration-harness";

describe.skipIf(missing.length > 0)(
  `real Git/RTK terminal pager suppression${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  () => {
    const context = useRealGitFixture();
    const { fixtureGit, shellQuote, sentinel, snapshotRepository, both } =
      context;

    it("suppresses branch pagers in a terminal for environment and configuration controls", async () => {
      const pager = sentinel("branch-pager");
      await fixtureGit(["config", "core.pager", shellQuote(pager.program)]);
      await fixtureGit(["config", "pager.branch", shellQuote(pager.program)]);
      process.env.GIT_PAGER = shellQuote(pager.program);
      process.env.PAGER = shellQuote(pager.program);
      const controlEnv: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm" };
      delete controlEnv.GIT_PAGER;
      delete controlEnv.PAGER;
      const control = await execa(
        "script",
        ["-q", "-e", "-c", "git --paginate branch --list", "/dev/null"],
        { cwd: context.workspace, reject: false, env: controlEnv },
      );
      expect(control.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(true);
      fs.removeSync(pager.marker);
      const before = snapshotRepository();
      for (const args of [
        ["branch"],
        ["branch", "--list"],
        ["branch", "-l", "feature/*"],
        ["branch", "--all"],
        ["branch", "--remotes"],
        ["branch", "--verbose"],
        ["branch", "-v", "-v"],
        ["branch", "--list", "--", "feature/*"],
      ]) {
        const prepared = prepareRtkInvocation("git", args);
        const command = ["rtk", ...prepared.args].map(shellQuote).join(" ");
        for (const stripPagerEnv of [false, true]) {
          const env: NodeJS.ProcessEnv = { ...prepared.env, TERM: "xterm" };
          if (stripPagerEnv) {
            delete env.GIT_PAGER;
            delete env.PAGER;
          }
          const terminal = await execa(
            "script",
            ["-q", "-e", "-c", command, "/dev/null"],
            { cwd: prepared.cwd, reject: false, env },
          );
          expect(terminal.exitCode).toBe(0);
          expect(terminal.stdout).not.toContain("SENTINEL OUTPUT");
          expect(fs.existsSync(pager.marker)).toBe(false);
        }
        const result = await both(args);
        expect(result.mcp.isError).toBe(false);
        expect(result.cli).not.toContain("SENTINEL OUTPUT");
        expect(result.mcp.content[0].text).not.toContain("SENTINEL OUTPUT");
        expect(fs.existsSync(pager.marker)).toBe(false);
        expect(snapshotRepository()).toEqual(before);
      }
    }, 30000);

    it("suppresses configured pagers even with a terminal", async () => {
      const pager = sentinel("pager");
      for (const key of [
        "core.pager",
        "pager.status",
        "pager.log",
        "pager.show",
        "pager.diff",
      ]) {
        await fixtureGit(["config", key, shellQuote(pager.program)]);
      }
      process.env.GIT_PAGER = shellQuote(pager.program);
      process.env.PAGER = shellQuote(pager.program);
      const control = await execa(
        "script",
        ["-q", "-e", "-c", "git --paginate log -1 --oneline", "/dev/null"],
        {
          cwd: context.workspace,
          reject: false,
          env: { ...process.env, TERM: "xterm" },
        },
      );
      expect(control.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(true);
      fs.removeSync(pager.marker);
      for (const args of [
        ["status", "--short"],
        ["log", "--oneline", "-n", "1"],
        ["show", "--stat"],
        ["show", "HEAD:file.txt"],
        ["diff"],
        ["diff", "--cached"],
        ["diff", "--staged", "HEAD"],
        ["diff", "HEAD~1", "HEAD"],
        ["diff", "HEAD~1...HEAD"],
      ]) {
        const prepared = prepareRtkInvocation("git", args);
        // Exercise the exact argv/env used by the common executor with a PTY.
        const command = ["rtk", ...prepared.args].map(shellQuote).join(" ");
        const result = await execa(
          "script",
          ["-q", "-e", "-c", command, "/dev/null"],
          {
            cwd: prepared.cwd,
            reject: false,
            env: { ...prepared.env, TERM: "xterm" },
          },
        );
        expect(result.exitCode).toBe(0);
        expect(fs.existsSync(pager.marker)).toBe(false);
        const adapters = await both(args);
        expect(adapters.mcp.isError).toBe(false);
        expect(fs.existsSync(pager.marker)).toBe(false);
      }
      const diffPagerEnv: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm" };
      delete diffPagerEnv.GIT_PAGER;
      delete diffPagerEnv.PAGER;
      const diffPagerControl = await execa(
        "script",
        [
          "-q",
          "-e",
          "-c",
          "git --paginate diff --cached -- other.txt",
          "/dev/null",
        ],
        { cwd: context.workspace, reject: false, env: diffPagerEnv },
      );
      expect(diffPagerControl.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(true);
      fs.removeSync(pager.marker);
      // Also prove --no-pager defeats config when environment suppression is absent.
      const prepared = prepareRtkInvocation("git", [
        "diff",
        "--cached",
        "--",
        "other.txt",
      ]);
      const configEnv: NodeJS.ProcessEnv = { ...prepared.env, TERM: "xterm" };
      delete configEnv.GIT_PAGER;
      delete configEnv.PAGER;
      const command = ["rtk", ...prepared.args].map(shellQuote).join(" ");
      const configured = await execa(
        "script",
        ["-q", "-e", "-c", command, "/dev/null"],
        {
          cwd: prepared.cwd,
          reject: false,
          env: configEnv,
        },
      );
      expect(configured.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(false);
    });
  },
);
