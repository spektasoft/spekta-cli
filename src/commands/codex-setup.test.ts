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
  readCodexStatus,
  previewCodexUninstall,
  previewCodexSetup,
} from "./codex-setup.js";

const fixtures: string[] = [];

function installedHookCommand(content: string): string {
  const parsed = JSON.parse(content) as {
    hooks: { PreToolUse: { hooks: { command: string }[] }[] };
  };
  return parsed.hooks.PreToolUse[0].hooks[0].command;
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "spekta-codex-setup-"));
  fixtures.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("readCodexStatus", () => {
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

  it("keeps setup configuration unverified and reports a missing hook executable as broken", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await applyCodexSetup({ home: root, path: bin, cwd: root });
    await rm(join(bin, "spekta-codex-hook"));

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

describe("previewCodexSetup", () => {
  it("adds MCP only when explicitly requested and binds it to the Codex session cwd", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await writeFile(join(bin, "spekta"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta"), 0o755);
    await writeFile(
      join(bin, "codex"),
      "#!/bin/sh\nprintf 'codex-cli 0.160.1\\n'\n",
    );
    await chmod(join(bin, "codex"), 0o755);

    const defaults = await previewCodexSetup({ home: root, path: bin });
    expect(defaults.files).toHaveLength(2);

    const optedIn = await previewCodexSetup({
      home: root,
      path: bin,
      mcp: true,
    });
    expect(optedIn.status).toBe("ready");
    expect(optedIn.files).toHaveLength(3);
    expect(optedIn.files[2]).toMatchObject({
      path: join(root, ".codex", "config.toml"),
      action: "create",
    });
    expect(optedIn.files[2].content).toContain(
      `command = ${JSON.stringify(join(bin, "spekta"))}`,
    );
    expect(optedIn.files[2].content).toContain('args = ["mcp"]');
    expect(optedIn.files[2].content).not.toContain("cwd =");
  });

  it("refuses MCP opt-in when the installed Codex runtime cannot be verified", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await writeFile(join(bin, "spekta"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta"), 0o755);
    await writeFile(
      join(bin, "codex"),
      "#!/bin/sh\nprintf 'codex-cli 0.159.9\\n'\n",
    );
    await chmod(join(bin, "codex"), 0o755);

    const plan = await previewCodexSetup({ home: root, path: bin, mcp: true });

    expect(plan.status).toBe("refused");
    expect(plan.files).toEqual([]);
    expect(plan.diagnostics.join(" ")).toMatch(
      /incompatible.*older than 0\.160\.1/i,
    );
    expect(await readdir(root)).toEqual(["bin"]);
  });

  it("previews exact global hook and usage instructions without creating artifacts", async () => {
    const root = await fixture();
    const bin = join(root, "bin with spaces");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);

    const plan = await previewCodexSetup({ home: root, path: bin });

    expect(plan.status).toBe("ready");
    expect(plan.files).toEqual([
      expect.objectContaining({
        path: join(root, ".codex", "hooks.json"),
        action: "create",
      }),
      expect.objectContaining({
        path: join(root, ".codex", "AGENTS.md"),
        action: "create",
      }),
    ]);
    expect(plan.files[0].content).toContain(
      JSON.stringify(JSON.stringify(join(bin, "spekta-codex-hook"))),
    );
    expect(plan.files[1].content).toContain(
      "<!-- spekta:codex-usage:start -->",
    );
    expect(await readdir(root)).toEqual(["bin with spaces"]);
  });

  it("refuses to activate when an active RTK hook can already rewrite Bash", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    const codex = join(root, ".codex");
    await mkdir(bin);
    await mkdir(codex);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await writeFile(
      join(codex, "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "^Bash$",
              hooks: [{ type: "command", command: "rtk rewrite" }],
            },
          ],
        },
      }),
    );

    const plan = await previewCodexSetup({ home: root, path: bin, cwd: root });

    expect(plan.status).toBe("refused");
    expect(plan.diagnostics.join("\n")).toMatch(
      /hooks\.json: contains an active RTK/i,
    );
    expect(await readdir(codex)).toEqual(["hooks.json"]);
  });

  it("reports inherited project hooks that match Bash and ignores nonmatching hooks", async () => {
    const root = await fixture();
    const repo = join(root, "repo");
    const cwd = join(repo, "nested");
    const bin = join(root, "bin");
    await mkdir(join(repo, ".codex"), { recursive: true });
    await mkdir(cwd);
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await writeFile(
      join(repo, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "^apply_patch$",
              hooks: [{ type: "command", command: "patch-check" }],
            },
            {
              matcher: "^Bash$",
              hooks: [{ type: "command", command: "local-policy" }],
            },
          ],
        },
      }),
    );

    const plan = await previewCodexSetup({ home: root, path: bin, cwd });

    expect(plan.status).toBe("refused");
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        kind: "competing-hook",
        source: join(repo, ".codex", "hooks.json"),
      }),
    ]);
    expect(plan.diagnostics.join("\n")).toMatch(
      /resolve the competing rewrite manually/,
    );
  });

  it("refuses to change activation planning when an inherited hook source is malformed", async () => {
    const root = await fixture();
    const repo = join(root, "repo");
    const bin = join(root, "bin");
    await mkdir(join(repo, ".codex"), { recursive: true });
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await writeFile(join(repo, ".codex", "hooks.json"), "{");

    const plan = await previewCodexSetup({ home: root, path: bin, cwd: repo });

    expect(plan.status).toBe("refused");
    expect(plan.files).toEqual([]);
    expect(plan.conflicts[0]).toEqual(
      expect.objectContaining({ kind: "ambiguous-source" }),
    );
  });

  it("allows active hooks that do not match the execution tool", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    const bin = join(root, "bin");
    await mkdir(codex);
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await writeFile(
      join(codex, "hooks.json"),
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "session-note" }] },
          ],
          PreToolUse: [
            {
              matcher: "^apply_patch$",
              hooks: [{ type: "command", command: "patch-policy" }],
            },
          ],
        },
      }),
    );

    const plan = await previewCodexSetup({ home: root, path: bin });

    expect(plan.status).toBe("ready");
    expect(plan.conflicts).toEqual([]);
  });

  it("reports each duplicate active RTK rewrite without modifying its source", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    const bin = join(root, "bin");
    await mkdir(codex);
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    const config = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "^Bash$",
            hooks: [{ type: "command", command: "rtk rewrite-one" }],
          },
          {
            matcher: "^Bash$",
            hooks: [{ type: "command", command: "rtk rewrite-two" }],
          },
        ],
      },
    });
    await writeFile(join(codex, "hooks.json"), config);

    const plan = await previewCodexSetup({ home: root, path: bin });

    expect(plan.status).toBe("refused");
    expect(
      plan.conflicts.filter(({ kind }) => kind === "rtk-rewrite"),
    ).toHaveLength(2);
    expect(await readFile(join(codex, "hooks.json"), "utf8")).toBe(config);
  });

  it("preserves unrelated hook configuration and instructions", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    await mkdir(codex);
    const hooks = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }],
      },
    };
    await writeFile(
      join(codex, "hooks.json"),
      `${JSON.stringify(hooks, null, 2)}\n`,
    );
    await writeFile(join(codex, "AGENTS.md"), "Keep my existing guidance.\n");
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);

    const plan = await previewCodexSetup({ home: root, path: bin });

    expect(plan.files[0].content).toContain('"command": "echo hello"');
    expect(plan.files[0].content.match(/"PreToolUse"/g)).toHaveLength(1);
    expect(plan.files[1].content).toContain("Keep my existing guidance.");
    expect(await readFile(join(codex, "hooks.json"), "utf8")).toBe(
      `${JSON.stringify(hooks, null, 2)}\n`,
    );
  });

  it("refuses malformed and duplicate owned content and missing executables", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    await mkdir(codex);
    await writeFile(join(codex, "hooks.json"), "{");
    const absent = await previewCodexSetup({ home: root, path: "" });
    expect(absent.status).toBe("refused");
    expect(absent.diagnostics.join("\n")).toMatch(/hooks\.json.*invalid JSON/i);
    expect(absent.diagnostics.join("\n")).toMatch(
      /spekta-codex-hook.*not found/i,
    );

    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    const duplicateHook = {
      matcher: "^(Bash)$",
      hooks: [
        {
          type: "command",
          command: '"/any/path/spekta-codex-hook"',
          timeout: 3,
        },
      ],
    };
    await writeFile(
      join(codex, "hooks.json"),
      JSON.stringify({ hooks: { PreToolUse: [duplicateHook, duplicateHook] } }),
    );
    const duplicate = await previewCodexSetup({ home: root, path: bin });
    expect(duplicate.status).toBe("refused");
    expect(duplicate.diagnostics.join("\n")).toMatch(/duplicate Spekta hook/i);
  });

  it("refuses edited usage blocks and conflicting Spekta hook definitions", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    const bin = join(root, "bin");
    await mkdir(codex);
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await writeFile(
      join(codex, "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "^Other$",
              hooks: [
                {
                  type: "command",
                  command: '"/old/spekta-codex-hook"',
                  timeout: 3,
                },
              ],
            },
          ],
        },
      }),
    );
    await writeFile(
      join(codex, "AGENTS.md"),
      `${CODEX_USAGE_START}\nEdited Spekta instructions\n${CODEX_USAGE_END}\n`,
    );

    const plan = await previewCodexSetup({ home: root, path: bin });

    expect(plan.status).toBe("refused");
    expect(plan.diagnostics.join("\n")).toMatch(
      /conflicting Spekta-owned hook/i,
    );
    expect(plan.diagnostics.join("\n")).toMatch(/usage block was edited/i);
  });

  it("refuses a Spekta hook definition with unfamiliar fields", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    const bin = join(root, "bin");
    await mkdir(codex);
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    const original = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "^(Bash)$",
            hooks: [
              {
                type: "command",
                command: JSON.stringify("/old/spekta-codex-hook"),
                timeout: 3,
              },
            ],
            userData: "keep this unfamiliar change",
          },
        ],
      },
    });
    await writeFile(join(codex, "hooks.json"), original);

    const plan = await previewCodexSetup({ home: root, path: bin });

    expect(plan.status).toBe("refused");
    expect(plan.diagnostics.join("\n")).toMatch(
      /conflicting Spekta-owned hook/i,
    );
    expect(await readFile(join(codex, "hooks.json"), "utf8")).toBe(original);
  });
});

describe("applyCodexSetup", () => {
  it("installs and updates opt-in MCP registration while preserving other servers", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    const bin = join(root, "bin");
    await mkdir(codex);
    await mkdir(bin);
    for (const name of ["spekta-codex-hook", "spekta"]) {
      await writeFile(join(bin, name), "#!/bin/sh\n");
      await chmod(join(bin, name), 0o755);
    }
    await writeFile(
      join(bin, "codex"),
      "#!/bin/sh\nprintf 'codex-cli 0.160.1\\n'\n",
    );
    await chmod(join(bin, "codex"), 0o755);
    const configPath = join(codex, "config.toml");
    await writeFile(configPath, '[mcp_servers.other]\ncommand = "other"\n');
    const options = { home: root, path: bin, mcp: true };

    const installed = await applyCodexSetup(options);
    expect(installed.status).toBe("configured");
    expect(installed.files.at(-1)?.action).toBe("update");
    const before = await readFile(configPath, "utf8");
    expect(before).toContain("[mcp_servers.other]");
    expect(before).toContain("[mcp_servers.spekta]");
    expect(before).not.toContain("cwd =");

    const repeated = await applyCodexSetup(options);
    expect(repeated.files.at(-1)?.action).toBe("unchanged");
    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  it("installs once and keeps repeated setup unchanged", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    const options = { home: root, path: bin, cwd: root };

    const first = await applyCodexSetup(options);
    expect(first.status).toBe("configured");
    expect(first.activation).toBe("unverified");
    expect(first.files.map(({ action }) => action)).toEqual([
      "create",
      "create",
    ]);
    const hooksBefore = await readFile(
      join(root, ".codex", "hooks.json"),
      "utf8",
    );
    const instructionsBefore = await readFile(
      join(root, ".codex", "AGENTS.md"),
      "utf8",
    );

    const repeated = await applyCodexSetup(options);
    expect(repeated.status).toBe("configured");
    expect(repeated.files.map(({ action }) => action)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    expect(await readFile(join(root, ".codex", "hooks.json"), "utf8")).toBe(
      hooksBefore,
    );
    expect(await readFile(join(root, ".codex", "AGENTS.md"), "utf8")).toBe(
      instructionsBefore,
    );
  });

  it("updates the owned executable path and completes a partial installation", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    const oldBin = join(root, "old-bin");
    const newBin = join(root, "new-bin");
    await mkdir(codex);
    await mkdir(oldBin);
    await mkdir(newBin);
    await writeFile(join(oldBin, "spekta-codex-hook"), "");
    await chmod(join(oldBin, "spekta-codex-hook"), 0o755);
    await writeFile(join(newBin, "spekta-codex-hook"), "");
    await chmod(join(newBin, "spekta-codex-hook"), 0o755);
    await writeFile(
      join(codex, "hooks.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "^(Bash)$",
              hooks: [
                {
                  type: "command",
                  command: JSON.stringify(join(oldBin, "spekta-codex-hook")),
                  timeout: 3,
                },
              ],
            },
          ],
        },
      }),
    );

    const preview = await previewCodexSetup({ home: root, path: newBin });

    expect(preview.status).toBe("ready");
    expect(preview.files.map(({ action }) => action)).toEqual([
      "update",
      "create",
    ]);
    expect(installedHookCommand(preview.files[0].content)).toBe(
      JSON.stringify(join(newBin, "spekta-codex-hook")),
    );
    expect(await readdir(codex)).toEqual(["hooks.json"]);

    const applied = await applyCodexSetup({ home: root, path: newBin });
    expect(applied.status).toBe("configured");
    expect(applied.activation).toBe("unverified");
    expect(applied.files.map(({ action }) => action)).toEqual([
      "update",
      "create",
    ]);
    expect(await readFile(join(codex, "AGENTS.md"), "utf8")).toContain(
      CODEX_USAGE_START,
    );
    expect(
      installedHookCommand(await readFile(join(codex, "hooks.json"), "utf8")),
    ).toBe(JSON.stringify(join(newBin, "spekta-codex-hook")));
  });

  it("refuses conflicts and missing executables without writing configuration", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    await mkdir(codex);
    await writeFile(
      join(codex, "hooks.json"),
      JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ command: "rtk rewrite" }] }] },
      }),
    );

    const conflict = await applyCodexSetup({ home: root, path: "", cwd: root });
    expect(conflict.status).toBe("refused");
    expect(conflict.activation).toBe("unverified");
    expect(await readdir(codex)).toEqual(["hooks.json"]);

    await writeFile(join(codex, "hooks.json"), "{}");
    const missing = await applyCodexSetup({ home: root, path: "" });
    expect(missing.status).toBe("refused");
    expect(missing.diagnostics.join("\n")).toMatch(/not found/i);
    expect(await readdir(codex)).toEqual(["hooks.json"]);
  });

  it("reports a write failure without claiming activation", async () => {
    const root = await fixture();
    const codex = join(root, ".codex");
    const bin = join(root, "bin");
    await mkdir(codex);
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);

    let writeCount = 0;
    const result = await applyCodexSetup(
      { home: root, path: bin },
      (path, content, encoding) => {
        writeCount += 1;
        if (writeCount === 2)
          return Promise.reject(new Error("fixture write failure"));
        return writeFile(path, content, encoding);
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      activation: "unverified",
    });
    expect(result.diagnostics.join("\n")).toMatch(/fixture write failure/i);
    expect(await readdir(codex)).toEqual([]);
  });
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

describe("applyCodexUninstall", () => {
  it("removes owned files when no unrelated content remains and completes a partial install", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await applyCodexSetup({ home: root, path: bin });
    const agents = join(root, ".codex", "AGENTS.md");
    await rm(agents);

    const result = await applyCodexUninstall({ home: root });

    expect(result.status).toBe("uninstalled");
    expect(result.files.map(({ action }) => action)).toEqual(["delete"]);
    expect(await readdir(join(root, ".codex"))).toEqual([]);
  });

  it("restores already removed artifacts when a later removal fails", async () => {
    const root = await fixture();
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "spekta-codex-hook"), "#!/bin/sh\n");
    await chmod(join(bin, "spekta-codex-hook"), 0o755);
    await applyCodexSetup({ home: root, path: bin });
    const hooksPath = join(root, ".codex", "hooks.json");
    const instructionsPath = join(root, ".codex", "AGENTS.md");
    const hookConfig = JSON.parse(await readFile(hooksPath, "utf8")) as {
      hooks: Record<string, unknown>;
    };
    hookConfig.hooks.SessionStart = [{ hooks: [{ command: "keep" }] }];
    await writeFile(hooksPath, JSON.stringify(hookConfig));
    await writeFile(
      instructionsPath,
      `Keep this prose.\n\n${await readFile(instructionsPath, "utf8")}`,
    );
    const before = [
      await readFile(hooksPath, "utf8"),
      await readFile(instructionsPath, "utf8"),
    ];

    let writes = 0;
    const result = await applyCodexUninstall(
      { home: root },
      async (path, content, encoding) => {
        writes += 1;
        if (writes === 2) throw new Error("fixture removal failure");
        return writeFile(path, content, encoding);
      },
    );

    expect(result.status).toBe("failed");
    expect(result.diagnostics.join("\n")).toMatch(/fixture removal failure/i);
    expect(await readFile(hooksPath, "utf8")).toBe(before[0]);
    expect(await readFile(instructionsPath, "utf8")).toBe(before[1]);
  });
});
