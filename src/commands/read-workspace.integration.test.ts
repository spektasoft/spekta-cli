import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { getReadContent, getReadOutcome } from "./read";
import * as readUtils from "../utils/read-utils";

let fixture: WorkspaceFixture;
beforeEach(async () => {
  fixture = await createWorkspaceFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
});
const modes = ["full", "range", "interactive", "interactive-range"] as const;
function read(target: string, mode: (typeof modes)[number], root: string) {
  const range = mode.includes("range") ? { start: 1, end: 1 } : undefined;
  return getReadContent(
    [{ path: target, range }],
    mode.startsWith("interactive"),
    { root },
  );
}

describe("workspace reads", () => {
  it.each(modes)("reads canonical targets in %s mode", async (mode) => {
    process.chdir(fixture.ambient);
    const streams = vi.spyOn(readUtils, "getFileLines");
    const output = await read("internal-file.txt", mode, fixture.root);
    expect(output).toContain("needle INTERNAL");
    expect(output).not.toContain("WRONG_CWD");
    expect(streams).toHaveBeenCalledTimes(mode.includes("range") ? 2 : 1);
    for (const [file] of streams.mock.calls)
      expect(file).toBe(path.join(fixture.root, "real.txt"));
  });
  for (const mode of modes)
    it.each([
      "../sibling.txt",
      "external-file.txt",
      "external-dir/secret.txt",
      "hop/missing/deep.txt",
      "dangling.txt",
      "cycle-a",
      "missing.txt",
    ])(`denies %s in ${mode} mode before streaming`, async (target) => {
      const streams = vi.spyOn(readUtils, "getFileLines");
      const output = await read(target, mode, fixture.root);
      expect(output).toContain("Read rejected:");
      expect(output).not.toContain(target);
      expect(output).not.toContain("EXTERNAL");
      expect(streams).not.toHaveBeenCalled();
    });
  it.each(modes)(
    "supports eligible targets through a workspace alias in %s mode",
    async (mode) => {
      expect(await read("internal-file.txt", mode, fixture.alias)).toContain(
        "INTERNAL",
      );
    },
  );
  it("denies absolute escapes and preserves the size limit", async () => {
    const target = path.join(fixture.outside, "secret.txt");
    const rejected = await read(target, "full", fixture.root);
    expect(rejected).toContain("Read rejected:");
    expect(rejected).not.toContain(target);
    const handle = await fs.open(path.join(fixture.root, "huge.txt"), "w");
    try {
      await fs.ftruncate(handle, 10 * 1024 * 1024 + 1);
    } finally {
      await fs.close(handle);
    }
    expect(await read("huge.txt", "full", fixture.root)).toContain(
      "Read rejected:",
    );
  });
  it("withholds a partial multi-file read when any requested file is denied", async () => {
    const outcome = await getReadOutcome(
      [{ path: "internal-file.txt" }, { path: "../sibling.txt" }],
      false,
      { root: fixture.root },
    );
    expect(outcome.status).toBe("policy_rejection");
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("internal-file.txt");
    expect(serialized).not.toContain("sibling.txt");
    expect(serialized).not.toContain("INTERNAL");
    expect(serialized).not.toContain("SIBLING");
  });
  it("accepts absolute internal targets and nongit workspaces", async () => {
    expect(
      await read(path.join(fixture.root, "real.txt"), "full", fixture.alias),
    ).toContain("INTERNAL");
    const root = path.join(fixture.base, "nongit");
    await fs.outputFile(path.join(root, "file.txt"), "needle NO_GIT\n");
    expect(await read("file.txt", "full", root)).toContain("NO_GIT");
  });
  it("preserves empty request and conceals missing workspace diagnostics", async () => {
    expect(await getReadContent([])).toBe(
      "Read requires at least one file path.",
    );
    const missingWorkspace = await read(
      "real.txt",
      "full",
      path.join(fixture.base, "missing-root"),
    );
    expect(missingWorkspace).toBe("Read rejected: workspace is unavailable.");
    expect(missingWorkspace).not.toContain("missing-root");
  });
});
