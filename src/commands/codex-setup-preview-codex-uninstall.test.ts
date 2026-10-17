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
import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_USAGE_END,
  CODEX_USAGE_START,
  applyCodexSetup,
  applyCodexUninstall,
  previewCodexUninstall,
} from "./codex-setup.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "spekta-codex-setup-"));
  fixtures.push(root);
  return root;
}

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("previewCodexUninstall", () => {
  it("treats an absent installation as a no-op without creating configuration", async () => {
    const root = await fixture();
    const plan = await previewCodexUninstall({ home: root, path: "" });
    const result = await applyCodexUninstall({ home: root, path: "" });
    expect(plan).toMatchObject({ status: "ready", files: [], diagnostics: [] });
    expect(result).toMatchObject({ status: "uninstalled", files: [] });
    expect(await readdir(root)).toEqual([]);
  });
  it("previews exact removal while preserving unrelated hooks, MCP servers, and prose", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await applyCodexSetup({ home: root, path: bin });
    const hooksPath = join(root, ".codex", "hooks.json");
    const instructionsPath = join(root, ".codex", "AGENTS.md");
    const installedHooks = JSON.parse(await readFile(hooksPath, "utf8")) as {
      hooks: Record<string, unknown>;
      mcpServers?: Record<string, unknown>;
    };
    installedHooks.mcpServers = { keep: { command: "mcp-server" } };
    installedHooks.hooks.SessionStart = [{ hooks: [{ command: "keep" }] }];
    installedHooks.hooks.PreToolUse = [
      {
        matcher: "^(Bash)$",
        hooks: [{ type: "command", command: "rtk rewrite" }],
      },
      ...((installedHooks.hooks.PreToolUse as unknown[]) ?? []),
    ];
    await writeFile(hooksPath, JSON.stringify(installedHooks, null, 2) + "\n");
    await writeFile(
      instructionsPath,
      `Keep this prose.\n\n${await readFile(instructionsPath, "utf8")}`,
    );
    const beforeHooks = await readFile(hooksPath, "utf8");
    const beforeInstructions = await readFile(instructionsPath, "utf8");
    const plan = await previewCodexUninstall({ home: root });
    expect(plan.status).toBe("ready");
    expect(plan.files.map(({ action }) => action)).toEqual([
      "update",
      "update",
    ]);
    expect(JSON.parse(plan.files[0].content)).toEqual({
      mcpServers: { keep: { command: "mcp-server" } },
      hooks: {
        SessionStart: [{ hooks: [{ command: "keep" }] }],
        PreToolUse: [
          {
            matcher: "^(Bash)$",
            hooks: [{ type: "command", command: "rtk rewrite" }],
          },
        ],
      },
    });
    expect(plan.files[1].content).toBe("Keep this prose.\n");
    expect(await readFile(hooksPath, "utf8")).toBe(beforeHooks);
    expect(await readFile(instructionsPath, "utf8")).toBe(beforeInstructions);
  });
  it("removes only a recognized Spekta MCP section and preserves other servers", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    await mkdir(codex);
    const config =
      '[mcp_servers.keep]\ncommand = "keep"\n\n[mcp_servers.spekta]\ncommand = "/opt/bin/spekta"\nargs = ["mcp"]\n';
    await writeFile(join(codex, "config.toml"), config);
    const plan = await previewCodexUninstall({ home: root });
    expect(plan).toMatchObject({
      status: "ready",
      files: [{ path: join(codex, "config.toml"), action: "update" }],
    });
    expect(plan.files[0].content).toBe(
      '[mcp_servers.keep]\ncommand = "keep"\n',
    );
  });
  it("preserves malformed or edited ownership and diagnoses it", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    await mkdir(codex);
    const hooks = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "^(Bash)$",
            hooks: [
              {
                type: "command",
                command: '"/x/spekta-codex-hook"',
                timeout: 3,
              },
            ],
            unexpected: true,
          },
        ],
      },
    });
    const instructions = `${CODEX_USAGE_START}\nEdited instructions\n${CODEX_USAGE_END}\n`;
    await writeFile(join(codex, "hooks.json"), hooks);
    await writeFile(join(codex, "AGENTS.md"), instructions);
    const plan = await previewCodexUninstall({ home: root });
    expect(plan.status).toBe("refused");
    expect(plan.diagnostics.join("\n")).toMatch(
      /conflicting Spekta-owned hook/i,
    );
    expect(plan.diagnostics.join("\n")).toMatch(/usage block was edited/i);
    expect(plan.files).toEqual([]);
    expect(await readFile(join(codex, "hooks.json"), "utf8")).toBe(hooks);
    expect(await readFile(join(codex, "AGENTS.md"), "utf8")).toBe(instructions);
  });
});
