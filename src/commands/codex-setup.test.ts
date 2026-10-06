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
  previewCodexSetup,
} from "./codex-setup.js";

const fixtures: string[] = [];

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
});
