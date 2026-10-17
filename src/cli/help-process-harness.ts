import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { execa } from "execa";
import { expect } from "vitest";

export interface HelpProcessHarness {
  build(): Promise<void>;
  cleanup(): Promise<void>;
  invoke(
    args: string[],
    seeded?: boolean,
    operational?: boolean,
  ): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>;
  readonly tempRoot: string;
}

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function snapshotTree(root: string): Promise<Record<string, string>> {
  if (!(await fs.pathExists(root))) return {};
  const snapshot: Record<string, string> = {};
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    const stat = await fs.stat(file);
    snapshot[item.name] = item.isDirectory()
      ? `directory:${stat.mtimeMs}`
      : `${stat.mtimeMs}:${(await fs.readFile(file)).toString("base64")}`;
    if (item.isDirectory()) {
      for (const [name, value] of Object.entries(await snapshotTree(file))) {
        snapshot[path.join(item.name, name)] = value;
      }
    }
  }
  return snapshot;
}

export function createHelpProcessHarness(): HelpProcessHarness {
  let tempRoot = "";
  let entry = "";
  let caseNumber = 0;

  async function build() {
    tempRoot = await fs.mkdtemp(path.join(projectRoot, ".help-process-"));
    const buildDir = path.join(tempRoot, "build");
    await execa("npm", ["run", "build", "--", "--outDir", buildDir], {
      cwd: projectRoot,
    });
    entry = path.join(buildDir, "index.js");
  }

  async function cleanup() {
    if (tempRoot) await fs.remove(tempRoot);
  }

  async function invoke(args: string[], seeded = false, operational = false) {
    const root = path.join(tempRoot, `case-${++caseNumber}`);
    const workspace = path.join(root, "workspace");
    const home = path.join(root, "home");
    const tmp = path.join(root, "tmp");
    const backendBin = path.join(root, "backend-bin");
    const backendMarker = path.join(root, "backend-invocations.txt");
    const stdoutPath = path.join(root, "stdout.txt");
    const stderrPath = path.join(root, "stderr.txt");
    await fs.ensureDir(workspace);
    await fs.ensureDir(tmp);
    if (!operational) {
      await fs.ensureDir(backendBin);
      for (const backend of ["rtk", "git", "find"]) {
        const executable = path.join(backendBin, backend);
        await fs.writeFile(
          executable,
          `#!/bin/sh\nprintf '%s\\n' '${backend}' >> "$SPEKTA_BACKEND_MARKER"\nexit 0\n`,
          { mode: 0o755 },
        );
        await fs.chmod(executable, 0o755);
      }
    }
    if (operational) {
      await fs.writeFile(path.join(workspace, "--help"), "literal-help-file\n");
      await fs.writeFile(
        path.join(workspace, "-h"),
        "literal-short-help-file\n",
      );
      await fs.writeFile(
        path.join(workspace, "existing.ts"),
        "const keep = true;\n",
      );
    }
    if (seeded) {
      await fs.outputFile(
        path.join(home, ".spekta", ".env"),
        "SPEKTA_EDITOR=missing-editor\n",
      );
      await fs.outputFile(
        path.join(home, ".spekta", "providers.yaml"),
        "invalid: [\n",
      );
      await fs.outputFile(
        path.join(home, ".codex", "hooks.json"),
        "not valid JSON\n",
      );
      await fs.outputFile(
        path.join(home, ".codex", "AGENTS.md"),
        "Personal instructions\n",
      );
      await fs.outputFile(
        path.join(home, ".codex", "config.toml"),
        "personal = true\n",
      );
      await fs.writeFile(
        path.join(workspace, "existing.ts"),
        "Keep this content\n",
      );
      await fs.writeFile(
        path.join(workspace, ".env"),
        "SPEKTA_READ_TOKEN_LIMIT=invalid\n",
      );
    }
    const homeBefore = await snapshotTree(home);
    const workspaceBefore = await snapshotTree(workspace);
    const stdoutFd = fs.openSync(stdoutPath, "w");
    const stderrFd = fs.openSync(stderrPath, "w");
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: workspace,
      env: {
        HOME: home,
        SPEKTA_HOME_OVERRIDE: path.join(home, ".spekta"),
        SPEKTA_ASSET_ROOT_OVERRIDE: operational
          ? path.dirname(entry)
          : path.join(root, "missing-assets"),
        PATH: operational ? "" : backendBin,
        TMPDIR: tmp,
        NO_COLOR: "1",
        SPEKTA_BACKEND_MARKER: backendMarker,
      },
      // Regular files also capture output on hosts where Node treats child
      // process socket descriptors as an unsupported stdout handle.
      stdio: ["pipe", stdoutFd, stderrFd],
    });
    let exitCode: number | null;
    try {
      exitCode = await new Promise<number | null>((resolve, reject) => {
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, 5000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          if (timedOut)
            reject(new Error(`CLI did not terminate: ${args.join(" ")}`));
          else resolve(code);
        });
        child.stdin?.end();
      });
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
    }
    expect(await fs.pathExists(home)).toBe(seeded);
    expect(path.isAbsolute(process.execPath)).toBe(true);
    if (!operational) expect(await fs.pathExists(backendMarker)).toBe(false);
    expect(await snapshotTree(home)).toEqual(homeBefore);
    expect(await snapshotTree(workspace)).toEqual(workspaceBefore);
    expect(await fs.readdir(tmp)).toEqual([]);
    return {
      exitCode,
      stdout: await fs.readFile(stdoutPath, "utf8"),
      stderr: await fs.readFile(stderrPath, "utf8"),
    };
  }

  return {
    build,
    cleanup,
    invoke,
    get tempRoot() {
      return tempRoot;
    },
  };
}
