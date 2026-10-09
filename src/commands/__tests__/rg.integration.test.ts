import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../../__tests__/workspace-fixture";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
import { runRg } from "../rg";
import { getRgOutcome } from "../grep-search";

let fixture: WorkspaceFixture;
let originalCwd: string;
let originalPath: string | undefined;
let rtkAvailable = false;

beforeEach(async () => {
  fixture = await createWorkspaceFixture();
  originalCwd = process.cwd();
  originalPath = process.env.PATH;
  try {
    await execa("rtk", ["proxy", "rg", "--version"]);
    rtkAvailable = true;
  } catch {
    rtkAvailable = false;
  }
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  vi.restoreAllMocks();
  await fixture.cleanup();
});

describe("spekta rg public boundaries", () => {
  it("finds a nested eligible match through CLI and MCP using RTK when available", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    await fs.ensureDir(path.join(fixture.root, "nested"));
    await fs.writeFile(
      path.join(fixture.root, "nested", "lower.txt"),
      "needle lowercase\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "nested", "upper.txt"),
      "Needle uppercase\n",
    );

    process.chdir(fixture.root);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runRg(["needle"]);
    const cliText = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(cliText).toContain("nested/lower.txt");
    expect(cliText).not.toContain("nested/upper.txt");

    const mcp = await TOOL_REGISTRY.spekta_rg.handler(
      { pattern: "needle" },
      { root: fixture.root },
    );
    expect(mcp.content[0]?.text).toContain("nested/lower.txt");
    expect(mcp.content[0]?.text).not.toContain("nested/upper.txt");
  });

  it("reports missing RTK without exposing process diagnostics", async () => {
    const emptyPath = await fs.mkdtemp(path.join(os.tmpdir(), "no-rtk-"));
    process.env.PATH = emptyPath;
    try {
      const outcome = await getRgOutcome(
        {
          patterns: ["needle"],
          paths: [],
          globs: [],
          case_mode: "sensitive",
        },
        { root: fixture.root },
      );
      expect(outcome).toMatchObject({
        status: "engine_failure",
        message: "Search failed: RTK is unavailable.",
      });
      expect(outcome.message).not.toContain(emptyPath);
    } finally {
      await fs.remove(emptyPath);
    }
  });

  it("reports missing ripgrep through a controlled RTK executable", async () => {
    const binPath = await fs.mkdtemp(path.join(os.tmpdir(), "rtk-no-rg-"));
    await fs.writeFile(
      path.join(binPath, "rtk"),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nprintf \'controlled missing ripgrep details\\n\' >&2\nexit 127\n',
      { mode: 0o755 },
    );
    process.env.PATH = binPath;
    try {
      const outcome = await getRgOutcome(
        {
          patterns: ["needle"],
          paths: [],
          globs: [],
          case_mode: "sensitive",
        },
        { root: fixture.root },
      );
      expect(outcome).toMatchObject({
        status: "engine_failure",
        message: "Search failed: ripgrep is unavailable.",
      });
      expect(outcome.message).not.toContain("controlled missing");
      expect(outcome.message).not.toContain(binPath);
    } finally {
      await fs.remove(binPath);
    }
  });
});
