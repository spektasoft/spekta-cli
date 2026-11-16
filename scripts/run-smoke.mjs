import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const vitestCli = resolve(projectRoot, "node_modules/vitest/vitest.mjs");
const tiers = {
  portable: [
    "src/commands/proxy/proxy-execution.real.test.ts",
    "src/api/mcp-server-process.integration.test.ts",
  ],
  "real-git": ["src/commands/proxy/proxy-git.integration.test.ts"],
};

export function assertRunnerSucceeded(result) {
  if (result.error) {
    throw new Error(`Could not start Vitest: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail =
      result.status === null
        ? `signal ${result.signal ?? "unknown"}`
        : `exit code ${result.status}`;
    throw new Error(`Vitest failed with ${detail}.`);
  }
}

export function readReport(reportPath) {
  let contents;
  try {
    contents = readFileSync(reportPath, "utf8");
  } catch (error) {
    throw new Error(
      `Vitest JSON report is missing or unreadable: ${error.message}`,
    );
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Vitest JSON report is malformed: ${error.message}`);
  }
}

function reportNameMatches(result, expectedPath) {
  if (typeof result?.name !== "string") return false;
  const actual = result.name.replaceAll("\\", "/");
  return actual === expectedPath || actual.endsWith(`/${expectedPath}`);
}

export function validateReport(report, expectedFiles) {
  if (
    report === null ||
    typeof report !== "object" ||
    report.success !== true ||
    !Array.isArray(report.testResults)
  ) {
    throw new Error(
      "Vitest JSON report has an invalid or unsuccessful result shape.",
    );
  }

  for (const expectedPath of expectedFiles) {
    const matching = report.testResults.filter((result) =>
      reportNameMatches(result, expectedPath),
    );
    if (matching.length !== 1) {
      throw new Error(
        `Expected exactly one Vitest result for ${expectedPath}; found ${matching.length}.`,
      );
    }

    const assertions = matching[0].assertionResults;
    if (matching[0].status !== "passed") {
      throw new Error(`Vitest marked ${expectedPath} as unsuccessful.`);
    }
    if (!Array.isArray(assertions) || assertions.length === 0) {
      throw new Error(`No test results were reported for ${expectedPath}.`);
    }
    const passed = assertions.filter(
      (assertion) => assertion?.status === "passed",
    );
    if (passed.length === 0) {
      throw new Error(`No tests passed in ${expectedPath}.`);
    }
    if (assertions.some((assertion) => assertion?.status !== "passed")) {
      throw new Error(
        `Failed or skipped tests were reported in ${expectedPath}.`,
      );
    }
  }

  const expected = new Set(expectedFiles);
  const unexpected = report.testResults.filter(
    (result) =>
      typeof result?.name !== "string" ||
      ![...expected].some((file) => reportNameMatches(result, file)),
  );
  if (unexpected.length > 0 || report.testResults.length !== expected.size) {
    throw new Error(
      "Vitest reported files outside the explicit smoke allowlist.",
    );
  }
}

export function runSmoke(tier, runProcess = spawnSync) {
  const files = tiers[tier];
  if (!files) {
    throw new Error(
      `Unknown smoke tier ${JSON.stringify(tier)}. Use portable or real-git.`,
    );
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "spekta-smoke-report-"));
  const reportPath = join(tempRoot, "vitest.json");
  const env = { ...process.env };
  if (tier === "real-git") env.SPEKTA_REQUIRE_GIT_INTEGRATION = "1";
  else delete env.SPEKTA_REQUIRE_GIT_INTEGRATION;

  try {
    const result = runProcess(
      process.execPath,
      [
        vitestCli,
        "run",
        "--reporter=verbose",
        "--reporter=json",
        `--outputFile.json=${reportPath}`,
        ...files,
      ],
      { cwd: projectRoot, env, stdio: "inherit" },
    );
    assertRunnerSucceeded(result);
    validateReport(readReport(reportPath), files);
    console.log(
      `Smoke tier ${tier} passed (${files.map((file) => basename(file)).join(", ")}).`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    runSmoke(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
