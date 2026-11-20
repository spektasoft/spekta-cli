import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { TOOL_REGISTRY } from "./mcp-server/registry";
import { dispatchCommand } from "../cli/commands";
import { Logger } from "../utils/logger";

let fixture: WorkspaceFixture;
let originalExitCode: typeof process.exitCode;

beforeEach(async () => {
  originalExitCode = process.exitCode;
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
  process.exitCode = originalExitCode;
});

describe("CLI sensitive search policy", () => {
  it("filters denied explicit and discovered results", async () => {
    const target = "keys/private.key";
    await fs.outputFile(
      path.join(fixture.root, target),
      "SYNTHETIC_CLI_PRIVATE\n",
    );

    const output: string[] = [];
    const errors: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(Logger, "error").mockImplementation((message) => {
      errors.push(String(message));
      return true;
    });

    await dispatchCommand("rg", ["SYNTHETIC_CLI_PRIVATE", target]);
    expect(process.exitCode).toBe(1);
    expect(output.join("") + errors.join("")).not.toContain(target);
    expect(output.join("") + errors.join("")).not.toContain(
      "SYNTHETIC_CLI_PRIVATE",
    );

    output.length = 0;
    errors.length = 0;
    process.exitCode = undefined;
    await dispatchCommand("rg", ["SYNTHETIC_CLI_PRIVATE"]);
    expect(output.join("") + errors.join("")).not.toContain(target);
    expect(output.join("") + errors.join("")).not.toContain(
      "SYNTHETIC_CLI_PRIVATE",
    );

    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      `!${target}\n`,
    );
    output.length = 0;
    errors.length = 0;
    process.exitCode = undefined;
    await dispatchCommand("rg", ["SYNTHETIC_CLI_PRIVATE", target]);
    expect(output.join("")).toContain("SYNTHETIC_CLI_PRIVATE");
  });
});

describe("MCP sensitive search policy", () => {
  it("conceals files denied by workspace Spekta-ignore rules", async () => {
    const target = "private-data.txt";
    const marker = "SYNTHETIC_CONFIG_RESTRICTED";
    await fs.writeFile(path.join(fixture.root, target), `${marker}\n`);
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      `${target}\n`,
    );

    const mcp = await TOOL_REGISTRY.spekta_rg.handler({
      patterns: [marker],
      paths: [target],
    });
    expect(JSON.stringify(mcp)).not.toContain(target);
    expect(JSON.stringify(mcp)).not.toContain(marker);

    const cliOutput: string[] = [];
    const cliError: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      cliOutput.push(String(chunk));
      return true;
    });
    vi.spyOn(Logger, "error").mockImplementation((message) => {
      cliError.push(String(message));
      return true;
    });
    await dispatchCommand("rg", [marker, target]);
    expect(cliOutput.join("") + cliError.join("")).not.toContain(target);
    expect(cliOutput.join("") + cliError.join("")).not.toContain(marker);
  });

  it("conceals denied files and permits one exact workspace exception", async () => {
    const target = "keys/private.key";
    const sibling = "keys/other.key";
    await fs.outputFile(
      path.join(fixture.root, target),
      "SYNTHETIC_SEARCH_PRIVATE\n",
    );
    await fs.outputFile(
      path.join(fixture.root, sibling),
      "SYNTHETIC_SEARCH_SIBLING\n",
    );

    const deniedExplicit = await TOOL_REGISTRY.spekta_rg.handler({
      patterns: ["SYNTHETIC_SEARCH"],
      paths: [target],
    });
    expect(deniedExplicit.isError).toBe(true);
    expect(JSON.stringify(deniedExplicit)).not.toContain(target);
    expect(JSON.stringify(deniedExplicit)).not.toContain(
      "SYNTHETIC_SEARCH_PRIVATE",
    );

    const deniedDiscovery = await TOOL_REGISTRY.spekta_rg.handler({
      patterns: ["SYNTHETIC_SEARCH"],
    });
    expect(JSON.stringify(deniedDiscovery)).not.toContain(target);
    expect(JSON.stringify(deniedDiscovery)).not.toContain(sibling);
    expect(JSON.stringify(deniedDiscovery)).not.toContain(
      "SYNTHETIC_SEARCH_PRIVATE",
    );
    expect(JSON.stringify(deniedDiscovery)).not.toContain(
      "SYNTHETIC_SEARCH_SIBLING",
    );

    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      `!${target}\n`,
    );
    const allowed = await TOOL_REGISTRY.spekta_rg.handler({
      patterns: ["SYNTHETIC_SEARCH"],
      paths: [target],
    });
    expect(allowed.content[0].text).toContain("SYNTHETIC_SEARCH_PRIVATE");

    const deniedSibling = await TOOL_REGISTRY.spekta_rg.handler({
      patterns: ["SYNTHETIC_SEARCH"],
      paths: [sibling],
    });
    expect(deniedSibling.isError).toBe(true);
    expect(JSON.stringify(deniedSibling)).not.toContain(sibling);
    expect(JSON.stringify(deniedSibling)).not.toContain(
      "SYNTHETIC_SEARCH_SIBLING",
    );
  });
});
