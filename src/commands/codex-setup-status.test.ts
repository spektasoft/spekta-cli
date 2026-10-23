import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleHelp } from "../cli/help";
import {
  findExecutable,
  findHook,
  verifyCodexSessionCwdContract,
} from "./codex-setup-status.js";
import {
  applyCodexSetup,
  readCodexStatus,
  runCodexStatus,
  previewCodexSetup,
} from "./codex-setup.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "spekta-codex-setup-"));
  fixtures.push(root);
  return root;
}

const fixtures: string[] = [];

function stubUserHome(home: string): void {
  vi.stubEnv(process.platform === "win32" ? "USERPROFILE" : "HOME", home);
}

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("readCodexStatus", () => {
  it("finds Windows npm command shims from PATH entries containing spaces", async () => {
    const root = await fixture();
    const bin = join(root, "Program Files", "Spekta npm bin");
    await mkdir(bin, { recursive: true });
    const extension = process.platform === "win32" ? ".cmd" : "";
    const hook = join(bin, `spekta-codex-hook${extension}`);
    const codex = join(bin, `codex${extension}`);
    const script =
      process.platform === "win32"
        ? '@echo off\r\nif "%~1"=="--version" if "%~2"=="" echo codex-cli 0.161.0\r\n'
        : '#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = "--version" ] && echo "codex-cli 0.161.0"\n';
    await writeFile(hook, script);
    await writeFile(codex, script);
    if (process.platform !== "win32") {
      await chmod(hook, 0o755);
      await chmod(codex, 0o755);
    }

    expect(await findHook(bin)).toBe(hook);
    expect(await findExecutable("codex", bin)).toBe(codex);
    expect(await verifyCodexSessionCwdContract(bin)).toBeUndefined();

    const setup = await applyCodexSetup({ home: root, path: bin, cwd: root });
    expect(setup.status).toBe("configured");
    const status = await readCodexStatus({ home: root, path: bin, cwd: root });
    expect(status.components.hooks.state).toBe("configured");
  });

  it("keeps routing unknown when global hook configuration cannot be read", async () => {
    const root = await fixture();
    await mkdir(join(root, ".codex", "hooks.json"), { recursive: true });
    const status = await readCodexStatus({ home: root, path: "", cwd: root });
    expect(status.routing).toBe("unknown");
    expect(status.components.hooks.state).toBe("conflicting");
    expect(status).toMatchObject({ trust: "unknown", activation: "unknown" });
  });
  it("explains running command attribution through public status help without inspecting configuration", () => {
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      expect(handleHelp(["status", "--help"], {})).toBe(true);
      const help = output.mock.calls.map(([text]) => text).join("");
      expect(help).toContain("same executable");
      expect(help).toContain("SHA-256");
      expect(help).toContain("build time");
      expect(help).toContain("source correspondence remains unknown");
    } finally {
      output.mockRestore();
    }
  });
  it("reports recognized hook routing without exposing configuration values or denied paths", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await applyCodexSetup({ home: root, path: bin, cwd: root });
    const hooksPath = join(root, ".codex", "hooks.json");
    const hooks = JSON.parse(await readFile(hooksPath, "utf8")) as {
      secret?: string;
      hooks: {
        PreToolUse: {
          hooks: {
            command: string;
          }[];
        }[];
      };
    };
    hooks.secret = "PRIVATE-CONFIG-VALUE";
    hooks.hooks.PreToolUse[0].hooks[0].command = JSON.stringify(
      join(root, ".env", "PRIVATE-DENIED-DIRECTORY", "spekta-codex-hook"),
    );
    await writeFile(hooksPath, JSON.stringify(hooks));
    await writeFile(
      join(root, ".codex", "config.toml"),
      '[mcp_servers.spekta]\ncommand = "/PRIVATE-MCP-PATH"\nargs = ["mcp"]\n',
    );
    const status = await readCodexStatus({ home: root, path: bin, cwd: root });
    expect(status).toMatchObject({
      routing: {
        event: "PreToolUse",
        matcher: "^(Bash)$",
        target: "spekta-codex-hook",
      },
      trust: "unknown",
      activation: "unknown",
    });
    const output = JSON.stringify(status);
    expect(output).not.toMatch(/PRIVATE|\.env|hooks\.json|config\.toml/);
    expect(output.length).toBeLessThan(4000);
  });
  it("withholds a denied running executable and its artifact identity", async () => {
    const root = await fixture();
    await writeFile(join(root, ".spektaignore"), "private.js\n");
    const invoked = join(root, "private.js");
    await writeFile(invoked, "private artifact\n");
    const previousArgv = process.argv;
    process.argv = [process.execPath, invoked];
    try {
      const status = await readCodexStatus({ home: root, path: "", cwd: root });
      expect(status.running).toEqual({
        executable: "unknown",
        artifactSha256: "unknown",
      });
      expect(JSON.stringify(status)).not.toContain("private.js");
    } finally {
      process.argv = previousArgv;
    }
  });
  it("attributes public status to the invoked executable rather than another PATH installation", async () => {
    const root = await fixture();
    const invoked = join(root, "index.js");
    await writeFile(invoked, "running artifact\n");
    await writeFile(join(root, "spekta"), "other installation\n");
    const previousArgv = process.argv;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    stubUserHome(root);
    vi.stubEnv("PATH", root);
    process.argv = [process.execPath, invoked];
    try {
      await runCodexStatus(["--global", "--codex"]);
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain(`executable: ${invoked}`);
      expect(output).toMatch(/artifact SHA-256: [a-f0-9]{64}/);
      expect(output).toContain("source revision: unknown");
      expect(output).toContain("source correspondence: unknown");
      expect(output).toContain("trust: unknown");
      expect(output).toContain("activation: unknown");
    } finally {
      process.argv = previousArgv;
      vi.unstubAllEnvs();
      log.mockRestore();
    }
  });
  it("reports absent integration components without creating Codex configuration", async () => {
    const root = await fixture();
    const status = await readCodexStatus({ home: root, path: "", cwd: root });
    expect(status.components).toMatchObject({
      hooks: { state: "absent" },
      instructions: { state: "absent" },
      mcp: { state: "absent" },
    });
    expect(status.verificationSteps.length).toBeGreaterThan(0);
    expect(await readdir(root)).toEqual([]);
  });
  it("reports effective allowance defaults, overrides, ceilings, and invalid settings safely", async () => {
    const root = await fixture();
    vi.stubEnv("SPEKTA_READ_TOKEN_LIMIT", "300");
    vi.stubEnv("SPEKTA_READ_TOKEN_CEILING", "900");
    vi.stubEnv("SPEKTA_GREP_TOKEN_LIMIT", "not-a-budget-secret");
    vi.stubEnv("SPEKTA_GREP_TOKEN_CEILING", "not-a-ceiling-secret");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const status = await readCodexStatus({ home: root, path: "", cwd: root });
      expect(status.allowances).toMatchObject({
        read: {
          defaultTokens: 300,
          ceilingTokens: 900,
          defaultConfiguration: "configured",
          ceilingConfiguration: "configured",
          honorsRequestAllowance: true,
        },
        search: {
          defaultTokens: 2000,
          ceilingTokens: 16000,
          defaultConfiguration: "invalid",
          ceilingConfiguration: "invalid",
          honorsRequestAllowance: true,
        },
        list: { defaultTokens: 1000, ceilingTokens: 8000 },
        git: { defaultTokens: 1000, ceilingTokens: 8000 },
      });
      expect(warning.mock.calls.flat().join(" ")).not.toContain("secret");
      stubUserHome(root);
      vi.stubEnv("PATH", "");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCodexStatus(["--global", "--codex"]);
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain(
        "read: default 300; ceiling 900; caller allowance honored",
      );
      expect(output).toContain(
        "search: default 2000; ceiling 16000; caller allowance honored; default setting invalid; fallback used, ceiling setting invalid; fallback used",
      );
      expect(output).not.toContain("not-a-budget-secret");
      expect(output).not.toContain("not-a-ceiling-secret");
      log.mockRestore();
    } finally {
      vi.unstubAllEnvs();
      warning.mockRestore();
    }
  });
  it("keeps setup configuration unverified and reports a missing hook executable as broken", async () => {
    const root = await fixture();
    const bin = join(root, "Program Files", "Spekta npm bin");
    await mkdir(bin, { recursive: true });
    const hook = join(
      bin,
      `spekta-codex-hook${process.platform === "win32" ? ".cmd" : ""}`,
    );
    await writeFile(
      hook,
      process.platform === "win32"
        ? "@echo off\r\nexit /b 0\r\n"
        : "#!/bin/sh\n",
    );
    if (process.platform !== "win32") await chmod(hook, 0o755);
    const setup = await applyCodexSetup({ home: root, path: bin, cwd: root });
    expect(setup).toMatchObject({
      status: "configured",
      activation: "unverified",
    });
    const hooks = JSON.parse(
      await readFile(join(root, ".codex", "hooks.json"), "utf8"),
    ) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    expect(JSON.parse(hooks.hooks.PreToolUse[0].hooks[0].command)).toBe(hook);
    await rm(hook);
    const status = await readCodexStatus({ home: root, path: bin, cwd: root });
    expect(status.components).toMatchObject({
      hooks: { state: "broken" },
      instructions: { state: "configured" },
      mcp: { state: "absent" },
    });
    expect(status.verificationSteps.join(" ")).toMatch(
      /new supported Codex session/i,
    );
  });
  it("reports hook ownership conflicts independently from configured instructions and MCP", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    const bin = join(root, "bin");
    await mkdir(codex, { recursive: true });
    await mkdir(bin);
    const executable = join(bin, "spekta-mcp");
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    const setup = await previewCodexSetup({ home: root, path: bin });
    const instructions = setup.files.find(({ path }) =>
      path.endsWith("AGENTS.md"),
    );
    if (!instructions) throw new Error("Expected setup instructions");
    await writeFile(
      join(codex, "config.toml"),
      `[mcp_servers.spekta]\ncommand = ${JSON.stringify(executable)}\nargs = ["mcp"]\n`,
    );
    await writeFile(
      join(codex, "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "^(Bash)$",
              hooks: [
                { type: "command", command: '"/missing/spekta-codex-hook"' },
              ],
            },
          ],
        },
      }),
    );
    await writeFile(join(codex, "AGENTS.md"), instructions.content);
    const status = await readCodexStatus({ home: root, path: bin, cwd: root });
    expect(status.components).toMatchObject({
      hooks: { state: "conflicting" },
      instructions: { state: "configured" },
      mcp: { state: "configured" },
    });
    expect(status).toMatchObject({ trust: "unknown", activation: "unknown" });
  });
});
