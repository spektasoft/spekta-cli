import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const vitestCli = resolve(projectRoot, "node_modules/vitest/vitest.mjs");
const renderingFiles = [
  "src/commands/repl/session-runner.test.ts",
  "src/commands/repl/stream-consumer.test.ts",
  "src/commands/repl/tool-pipeline.test.ts",
];

const policies = [
  {
    label: "color disabled",
    forceColor: "0",
    testNamePattern: [
      "renders multiline user messages at the active terminal width",
      "keeps streamed output ANSI-free when color is disabled",
      "preserves proposed-tool and result box layouts at common terminal widths",
    ].join("|"),
    files: renderingFiles,
  },
  {
    label: "color enabled",
    forceColor: "1",
    testNamePattern:
      "renders user messages with Chalk and Boxen styling when color is enabled",
    files: [renderingFiles[0]],
  },
];

let exitCode = 0;

for (const policy of policies) {
  const env = { ...process.env, FORCE_COLOR: policy.forceColor };
  delete env.NO_COLOR;
  delete env.CLICOLOR;
  delete env.CLICOLOR_FORCE;
  delete env.SPEKTA_REPL_COLOR_POLICY;
  if (policy.forceColor === "1") {
    env.SPEKTA_REPL_COLOR_POLICY = "enabled";
  }

  console.log(
    `\n[REPL rendering: ${policy.label}; FORCE_COLOR=${policy.forceColor}; NO_COLOR, CLICOLOR, and CLICOLOR_FORCE unset]`,
  );

  const result = spawnSync(
    process.execPath,
    [
      vitestCli,
      "run",
      "--testNamePattern",
      policy.testNamePattern,
      ...policy.files,
    ],
    { cwd: projectRoot, env, stdio: "inherit" },
  );

  if (result.error) {
    console.error(
      `Could not start the ${policy.label} Vitest process:`,
      result.error,
    );
    exitCode = exitCode || 1;
  } else if (result.status !== 0) {
    if (result.status === null) {
      console.error(
        `The ${policy.label} Vitest process ended from signal ${result.signal ?? "unknown"}.`,
      );
    }
    exitCode = exitCode || result.status || 1;
  }
}

process.exitCode = exitCode;
