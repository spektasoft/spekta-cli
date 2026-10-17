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
import { applyCodexSetup, applyCodexUninstall } from "./codex-setup.js";

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
