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

describe("previewCodexSetup", () => {
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
