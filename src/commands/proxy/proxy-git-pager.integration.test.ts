import fs from "fs-extra";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { prepareRtkInvocation } from "./proxy-execution";
import { useRealGitFixture, missing } from "./proxy-git.integration-harness";

describe.skipIf(missing.length > 0)(
  `real Git/RTK terminal pager suppression${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  () => {
    const context = useRealGitFixture({ pagerFixture: true });
    const { fixtureGit, shellQuote, sentinel, snapshotRepository, both } =
      context;

    const branchCases = [
      { label: "branch", args: ["branch"] },
      { label: "branch --list", args: ["branch", "--list"] },
      { label: "branch -l pattern", args: ["branch", "-l", "feature/*"] },
      { label: "branch --all", args: ["branch", "--all"] },
      { label: "branch --remotes", args: ["branch", "--remotes"] },
      { label: "branch --verbose", args: ["branch", "--verbose"] },
      { label: "branch -vv", args: ["branch", "-v", "-v"] },
      {
        label: "branch --list -- pattern",
        args: ["branch", "--list", "--", "feature/*"],
      },
    ];
    const commandCases = [
      { label: "status", args: ["status", "--short"] },
      { label: "log", args: ["log", "--stat", "-n", "1"] },
      { label: "show stat", args: ["show", "--stat"] },
      { label: "show blob", args: ["show", "HEAD:file.txt"] },
      { label: "diff", args: ["diff"] },
      { label: "cached diff", args: ["diff", "--cached"] },
      { label: "staged HEAD diff", args: ["diff", "--staged", "HEAD"] },
      { label: "two-endpoint diff", args: ["diff", "HEAD~1", "HEAD"] },
      { label: "three-dot diff", args: ["diff", "HEAD~1...HEAD"] },
    ];
    const branchPagerKeys = ["core.pager", "pager.branch"];
    const commandPagerKeys = [
      "core.pager",
      "pager.status",
      "pager.log",
      "pager.show",
      "pager.diff",
    ];

    async function configurePager(keys: string[], program: string) {
      for (const key of keys) {
        await fixtureGit(["config", key, shellQuote(program)]);
      }
    }

    it("confirms the branch pager positive control in a terminal", async () => {
      const pager = sentinel("branch-pager");
      await configurePager(branchPagerKeys, pager.program);
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
    }, 30000);

    it.each(branchCases)(
      "suppresses branch pager for $label in terminals and CLI/MCP",
      async ({ args }) => {
        const pager = sentinel("branch-pager");
        await configurePager(branchPagerKeys, pager.program);
        process.env.GIT_PAGER = shellQuote(pager.program);
        process.env.PAGER = shellQuote(pager.program);
        const before = snapshotRepository();

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
      },
      30000,
    );

    it("confirms configured log and diff pagers and the --no-pager override", async () => {
      const pager = sentinel("pager");
      await configurePager(commandPagerKeys, pager.program);
      process.env.GIT_PAGER = shellQuote(pager.program);
      process.env.PAGER = shellQuote(pager.program);
      const logControl = await execa(
        "script",
        ["-q", "-e", "-c", "git --paginate log -1 --stat", "/dev/null"],
        {
          cwd: context.workspace,
          reject: false,
          env: { ...process.env, TERM: "xterm" },
        },
      );
      expect(logControl.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(true);
      fs.removeSync(pager.marker);

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
    }, 30000);

    it.each(commandCases)(
      "suppresses configured pager for $label in a terminal and CLI/MCP",
      async ({ args }) => {
        const pager = sentinel("pager");
        await configurePager(commandPagerKeys, pager.program);
        process.env.GIT_PAGER = shellQuote(pager.program);
        process.env.PAGER = shellQuote(pager.program);

        const prepared = prepareRtkInvocation("git", args);
        // Exercise the exact argv/env used by the common executor with a PTY.
        const command = ["rtk", ...prepared.args].map(shellQuote).join(" ");
        const terminal = await execa(
          "script",
          ["-q", "-e", "-c", command, "/dev/null"],
          {
            cwd: prepared.cwd,
            reject: false,
            env: { ...prepared.env, TERM: "xterm" },
          },
        );
        expect(terminal.exitCode).toBe(0);
        expect(fs.existsSync(pager.marker)).toBe(false);

        const adapters = await both(args);
        expect(adapters.mcp.isError).toBe(false);
        expect(fs.existsSync(pager.marker)).toBe(false);
      },
      30000,
    );
  },
);
