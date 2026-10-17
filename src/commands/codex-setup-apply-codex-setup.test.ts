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
  CODEX_USAGE_START,
  applyCodexSetup,
  previewCodexSetup,
} from "./codex-setup.js";

function installedHookCommand(content: string): string {
  const parsed = JSON.parse(content) as {
    hooks: {
      PreToolUse: {
        hooks: {
          command: string;
        }[];
      }[];
    };
  };
  return parsed.hooks.PreToolUse[0].hooks[0].command;
}

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
    const generatedInstructions = await readFile(
      join(codex, "AGENTS.md"),
      "utf8",
    );
    expect(generatedInstructions).toContain(CODEX_USAGE_START);
    expect(generatedInstructions).toContain("spekta rg");
    expect(generatedInstructions).toContain("spekta_rg");
    expect(generatedInstructions).toContain("eligible-file restrictions");
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
