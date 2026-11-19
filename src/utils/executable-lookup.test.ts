import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findExecutableOnPath } from "./executable-lookup.js";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("findExecutableOnPath", () => {
  it("finds Windows npm command shims under PATH entries containing spaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "spekta-executable-"));
    fixtures.push(root);
    const directory = join(root, "Program Files", "Spekta npm bin");
    await mkdir(directory, { recursive: true });
    const extension = process.platform === "win32" ? ".cmd" : "";
    const executable = join(directory, `spekta-codex-hook${extension}`);
    await writeFile(executable, "shim fixture\n");

    expect(await findExecutableOnPath("spekta-codex-hook", directory)).toBe(
      executable,
    );
  });
});
