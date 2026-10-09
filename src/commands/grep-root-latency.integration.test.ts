import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import * as execaModule from "execa";
import type { Options as ExecaOptions } from "execa";
import * as security from "../utils/security";
import * as grepOutputParser from "./grep-output-parser";
import { runGrep } from "./grep";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";

vi.mock("execa", async () => {
  const actual = await vi.importActual<typeof import("execa")>("execa");
  return { ...actual, execa: vi.fn(actual.execa) };
});

vi.mock("../utils/security", async () => {
  const actual =
    await vi.importActual<typeof import("../utils/security")>(
      "../utils/security",
    );
  return {
    ...actual,
    isWhitelisted: vi.fn(actual.isWhitelisted),
    validateReadPathAccess: vi.fn(actual.validateReadPathAccess),
  };
});

vi.mock("./grep-output-parser", async () => {
  const actual = await vi.importActual<typeof import("./grep-output-parser")>(
    "./grep-output-parser",
  );
  return { ...actual, parseGrepOutput: vi.fn(actual.parseGrepOutput) };
});

let fixture: WorkspaceFixture;
let originalCwd: string;
let fixtureNeedsCleanup = false;
const marker = "root_latency_probe_7c5e9a";
const outputs: string[] = [];
let baseExeca: ObservedExeca | undefined;
let baseValidateReadPathAccess:
  typeof security.validateReadPathAccess | undefined;
let baseIsWhitelisted: typeof security.isWhitelisted | undefined;
let baseParseGrepOutput: typeof grepOutputParser.parseGrepOutput | undefined;
type ObservedExeca = (
  command: string | URL,
  args?: string[] | string,
  options?: ExecaOptions,
) => ReturnType<typeof execaModule.execa>;
type KillableProcess = { kill: (signal?: NodeJS.Signals) => boolean };
const activeProcesses = new Set<KillableProcess>();
let profilingCutoff = false;
const telemetry = {
  pathValidationCalls: 0,
  pathValidationMs: 0,
  normalEnumerationCalls: 0,
  normalEnumerationMs: 0,
  normalEnumerationFileCount: 0,
  ignoredEnumerationCalls: 0,
  ignoredEnumerationMs: 0,
  ignoredEnumerationFileCount: 0,
  gitClassificationCalls: 0,
  gitClassificationMs: 0,
  gitCandidateCount: 0,
  gitIgnoredCount: 0,
  whitelistChecks: 0,
  whitelistAllowed: 0,
  whitelistMs: 0,
  contentSearchLaunches: 0,
  contentSearchMs: 0,
  responseProcessingCalls: 0,
  responseProcessingMs: 0,
};

function clearTelemetry(): void {
  for (const key of Object.keys(telemetry) as Array<keyof typeof telemetry>) {
    telemetry[key] = 0;
  }
}

function snapshotTelemetry(): typeof telemetry {
  return { ...telemetry };
}

function telemetryDelta(before: typeof telemetry): typeof telemetry {
  return Object.fromEntries(
    Object.entries(telemetry).map(([key, value]) => [
      key,
      value - before[key as keyof typeof telemetry],
    ]),
  ) as typeof telemetry;
}

function stdoutFrom(result: unknown): string {
  if (typeof result !== "object" || result === null || !("stdout" in result)) {
    return "";
  }
  return typeof result.stdout === "string" ? result.stdout : "";
}

function instrumentSearch(): void {
  baseExeca ??= vi
    .mocked(execaModule.execa)
    .getMockImplementation() as unknown as ObservedExeca;
  const originalExeca = baseExeca;
  const instrumentedExeca: ObservedExeca = (command, args, options) => {
    if (profilingCutoff) throw new Error("Profile time limit reached.");
    const commandArgs = Array.isArray(args) ? args : [];
    let phase:
      | "normal-enumeration"
      | "ignored-enumeration"
      | "git"
      | "content"
      | undefined;
    if (command === "rg" && commandArgs.includes("--files")) {
      phase = commandArgs.includes("--no-ignore-vcs")
        ? "ignored-enumeration"
        : "normal-enumeration";
      if (phase === "ignored-enumeration") telemetry.ignoredEnumerationCalls++;
      else telemetry.normalEnumerationCalls++;
    } else if (
      command === "git" &&
      commandArgs[0] === "check-ignore" &&
      commandArgs.includes("--stdin")
    ) {
      phase = "git";
      telemetry.gitClassificationCalls++;
      const input = options?.input;
      telemetry.gitCandidateCount +=
        typeof input === "string"
          ? input.split("\0").filter(Boolean).length
          : 0;
    } else if (command === "rg" && commandArgs.includes("--json")) {
      phase = "content";
      telemetry.contentSearchLaunches++;
    }

    const started = performance.now();
    const child = originalExeca(command, args, options);
    const killable = child as unknown as KillableProcess;
    activeProcesses.add(killable);
    void child.then(
      () => activeProcesses.delete(killable),
      () => activeProcesses.delete(killable),
    );
    if (phase) {
      void child.then(
        (result) => {
          const elapsed = performance.now() - started;
          const stdout = stdoutFrom(result);
          if (
            phase === "normal-enumeration" ||
            phase === "ignored-enumeration"
          ) {
            const count = stdout.split("\0").filter(Boolean).length;
            if (phase === "normal-enumeration") {
              telemetry.normalEnumerationMs += elapsed;
              telemetry.normalEnumerationFileCount += count;
            } else {
              telemetry.ignoredEnumerationMs += elapsed;
              telemetry.ignoredEnumerationFileCount += count;
            }
          } else if (phase === "git") {
            telemetry.gitClassificationMs += elapsed;
            telemetry.gitIgnoredCount += stdout
              .split("\0")
              .filter(Boolean).length;
          } else {
            telemetry.contentSearchMs += elapsed;
          }
        },
        () => {
          const elapsed = performance.now() - started;
          if (phase === "normal-enumeration")
            telemetry.normalEnumerationMs += elapsed;
          else if (phase === "ignored-enumeration")
            telemetry.ignoredEnumerationMs += elapsed;
          else if (phase === "git") telemetry.gitClassificationMs += elapsed;
          else telemetry.contentSearchMs += elapsed;
        },
      );
    }
    return child;
  };
  vi.mocked(execaModule.execa).mockImplementation(
    instrumentedExeca as typeof execaModule.execa,
  );

  baseValidateReadPathAccess ??= vi
    .mocked(security.validateReadPathAccess)
    .getMockImplementation()!;
  const originalValidate = baseValidateReadPathAccess;
  vi.mocked(security.validateReadPathAccess).mockImplementation(
    async (...args) => {
      if (profilingCutoff) throw new Error("Profile time limit reached.");
      telemetry.pathValidationCalls++;
      const started = performance.now();
      try {
        return await originalValidate(...args);
      } finally {
        telemetry.pathValidationMs += performance.now() - started;
      }
    },
  );

  baseIsWhitelisted ??= vi
    .mocked(security.isWhitelisted)
    .getMockImplementation()!;
  const originalWhitelist = baseIsWhitelisted;
  vi.mocked(security.isWhitelisted).mockImplementation((...args) => {
    if (profilingCutoff) return false;
    const started = performance.now();
    try {
      const allowed = originalWhitelist(...args);
      telemetry.whitelistChecks++;
      if (allowed) telemetry.whitelistAllowed++;
      return allowed;
    } finally {
      telemetry.whitelistMs += performance.now() - started;
    }
  });

  baseParseGrepOutput ??= vi
    .mocked(grepOutputParser.parseGrepOutput)
    .getMockImplementation()!;
  const originalParser = baseParseGrepOutput;
  vi.mocked(grepOutputParser.parseGrepOutput).mockImplementation(
    async (...args) => {
      telemetry.responseProcessingCalls++;
      const started = performance.now();
      try {
        return await originalParser(...args);
      } finally {
        telemetry.responseProcessingMs += performance.now() - started;
      }
    },
  );
}

beforeEach(async () => {
  fixture = await createWorkspaceFixture();
  fixtureNeedsCleanup = true;
  originalCwd = process.cwd();
  process.chdir(fixture.root);
  outputs.length = 0;
  clearTelemetry();
  instrumentSearch();
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    outputs.push(String(chunk));
    return true;
  });
  await fs.emptyDir(fixture.root);
  await fs.outputFile("nested/target.txt", `${marker} eligible\n`);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (baseExeca)
    vi.mocked(execaModule.execa).mockImplementation(
      baseExeca as typeof execaModule.execa,
    );
  if (baseValidateReadPathAccess)
    vi.mocked(security.validateReadPathAccess).mockImplementation(
      baseValidateReadPathAccess,
    );
  if (baseIsWhitelisted)
    vi.mocked(security.isWhitelisted).mockImplementation(baseIsWhitelisted);
  if (baseParseGrepOutput)
    vi.mocked(grepOutputParser.parseGrepOutput).mockImplementation(
      baseParseGrepOutput,
    );
  process.chdir(originalCwd);
  if (fixtureNeedsCleanup) await fixture.cleanup();
});

async function search(
  args: string[],
): Promise<{ elapsedMs: number; output: string; phases: typeof telemetry }> {
  const before = performance.now();
  const telemetryBefore = snapshotTelemetry();
  await runGrep(args);
  return {
    elapsedMs: performance.now() - before,
    output: outputs.splice(0).join(""),
    phases: telemetryDelta(telemetryBefore),
  };
}

describe("root search latency reproduction at the CLI boundary", () => {
  it("compares a nested match across paths and incrementally adds ignored work", async () => {
    const results: Record<
      string,
      { elapsedMs: number; fileCount: number; phases: typeof telemetry }
    > = {};
    const cases: Array<[string, string[]]> = [
      ["explicit-file", [marker, "nested/target.txt"]],
      ["containing-directory", [marker, "nested"]],
      ["explicit-root", [marker, fixture.root]],
      ["omitted-path", [marker]],
    ];

    for (const [name, args] of cases) {
      const result = await search(args);
      expect(result.output).toContain(marker);
      results[name] = {
        elapsedMs: result.elapsedMs,
        fileCount: 1,
        phases: result.phases,
      };
    }

    await fs.writeFile(".gitignore", "unrelated-git-ignored/\n");
    await fs.ensureDir("unrelated-git-ignored");
    for (let index = 0; index < 400; index++) {
      await fs.writeFile(
        path.join("unrelated-git-ignored", `file-${index}.txt`),
        `unrelated ignored payload ${index}\n`,
      );
    }
    const gitIgnored = await search([marker]);
    expect(gitIgnored.output).toContain(marker);
    results["git-ignored-tree"] = {
      elapsedMs: gitIgnored.elapsedMs,
      fileCount: 400,
      phases: gitIgnored.phases,
    };

    await fs.writeFile(".spektaignore", "!unrelated-git-ignored/allowed.txt\n");
    await fs.writeFile(
      "unrelated-git-ignored/allowed.txt",
      "unrelated whitelisted payload\n",
    );
    const whitelist = await search([marker]);
    expect(whitelist.output).toContain(marker);
    expect(whitelist.output).not.toContain("unrelated-git-ignored");
    results["narrow-spekta-negation"] = {
      elapsedMs: whitelist.elapsedMs,
      fileCount: 401,
      phases: whitelist.phases,
    };

    await fs.writeFile(
      ".gitignore",
      "unrelated-git-ignored/\nlarge-unrelated-tree/\n",
    );
    await fs.ensureDir("large-unrelated-tree");
    for (let index = 0; index < 1600; index++) {
      await fs.writeFile(
        path.join("large-unrelated-tree", `file-${index}.txt`),
        `additional ignored payload ${index}\n`,
      );
    }
    const enlarged = await search([marker]);
    expect(enlarged.output).toContain(marker);
    expect(enlarged.output).not.toContain("large-unrelated-tree");
    results["enlarged-ignored-trees"] = {
      elapsedMs: enlarged.elapsedMs,
      fileCount: 2001,
      phases: enlarged.phases,
    };

    vi.restoreAllMocks();
    expect(Object.keys(results)).toEqual([
      "explicit-file",
      "containing-directory",
      "explicit-root",
      "omitted-path",
      "git-ignored-tree",
      "narrow-spekta-negation",
      "enlarged-ignored-trees",
    ]);
    expect(Object.values(results).every(({ elapsedMs }) => elapsedMs > 0)).toBe(
      true,
    );
    console.info(`[root-latency-probe] ${JSON.stringify(results)}`);
  }, 30_000);

  it.skipIf(process.env.SPEKTA_PROFILE_WORKTREE_ROOT !== "1")(
    "profiles a root search of the current workspace with its actual ignore configuration",
    async () => {
      await fixture.cleanup();
      fixtureNeedsCleanup = false;
      profilingCutoff = false;
      const before = snapshotTelemetry();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timed-out">((resolve) => {
        timeout = setTimeout(() => {
          profilingCutoff = true;
          for (const child of activeProcesses) child.kill("SIGTERM");
          resolve("timed-out");
        }, 15_000);
      });
      const searchPromise = search([marker]);
      const outcome = await Promise.race([
        searchPromise.then((result) => ({
          status: "completed" as const,
          result,
        })),
        timedOut.then((status) => ({ status, result: undefined })),
      ]);
      if (timeout) clearTimeout(timeout);
      const phases = telemetryDelta(before);
      if (outcome.status === "completed") {
        expect(outcome.result.output).toContain(marker);
      } else {
        await searchPromise;
        process.exitCode = undefined;
      }
      console.info(
        `[root-latency-working-tree] ${JSON.stringify({
          status: outcome.status,
          elapsedMs:
            outcome.status === "completed" ? outcome.result.elapsedMs : 15_000,
          phases,
        })}`,
      );
    },
    60_000,
  );

  it.skipIf(process.env.SPEKTA_PROFILE_WHITELIST_FIXTURE !== "1")(
    "profiles candidate path validation in a minimal ignored workspace",
    async () => {
      const candidateCount = 1800;
      await fs.writeFile(
        ".gitignore",
        "unrelated-git-ignored/\nwhitelist-candidates/\n",
      );
      await fs.writeFile(
        ".spektaignore",
        "!unrelated-git-ignored/allowed.txt\n!whitelist-candidates/**\n",
      );
      await fs.ensureDir("whitelist-candidates");
      for (let index = 0; index < candidateCount; index++) {
        await fs.writeFile(
          path.join("whitelist-candidates", `candidate-${index}.txt`),
          `eligible ignored payload ${index}\n`,
        );
      }

      const result = await search([marker]);
      expect(result.output).toContain(marker);
      expect(result.output).not.toContain("whitelist-candidates");
      expect(result.phases.whitelistAllowed).toBe(candidateCount);
      console.info(
        `[root-latency-whitelist-fixture] ${JSON.stringify({
          candidateCount,
          elapsedMs: result.elapsedMs,
          phases: result.phases,
        })}`,
      );
    },
    60_000,
  );
});
