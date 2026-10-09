import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetInternalState } from "../config";
import { refreshPaths } from "./paths";
import { loadToolDefinitions } from "./tools";

describe("Tool Definitions & Overrides", () => {
  const testHome = path.join(os.tmpdir(), "spekta-test-overrides");

  beforeEach(async () => {
    resetInternalState();
    await fs.ensureDir(path.join(testHome, "tools"));
    process.env.SPEKTA_HOME_OVERRIDE = testHome;
    refreshPaths();
  });

  afterEach(async () => {
    const keysToClean = ["SPEKTA_HOME_OVERRIDE"];
    keysToClean.forEach((key) => delete process.env[key]);
    await fs.remove(testHome);
    refreshPaths();
  });

  it("should verify cache is cleared", async () => {
    await loadToolDefinitions();
    resetInternalState();
    const tools1 = await loadToolDefinitions();
    resetInternalState();
    const tools2 = await loadToolDefinitions();
    expect(tools1).not.toBe(tools2);
  });

  it("should prioritize user-defined tool descriptions", async () => {
    const overrideContent = `
name: read
description: "Custom Override Description"
params:
  paths:
    description: "Custom Param"
xml_example: "<read />"
`;
    await fs.writeFile(
      path.join(testHome, "tools", "read.yaml"),
      overrideContent,
    );

    const tools = await loadToolDefinitions();
    const readTool = tools.find((t) => t.name === "read");

    expect(readTool?.description).toBe("Custom Override Description");
  });

  it("bundles the basic rg MCP tool", async () => {
    const tools = await loadToolDefinitions();
    const rgTool = tools.find((tool) => tool.name === "spekta_rg");

    expect(rgTool?.params).toEqual({
      patterns: {
        description:
          "Regex patterns to search; repeated patterns match as alternatives. At least one is required.",
      },
      paths: {
        description:
          "File and directory paths to search. Empty or omitted searches the workspace root recursively.",
      },
      globs: {
        description:
          "Ordered ripgrep glob filters, supplied as separate values; values retain commas and later filters follow native ripgrep precedence.",
      },
      case_mode: {
        description:
          "Case mode: sensitive (default), insensitive (-i/--ignore-case), or smart (-S/--smart-case).",
      },
    });
  });

  it("does not load an old grep definition as the rg tool", async () => {
    await fs.writeFile(
      path.join(testHome, "tools", "grep.yaml"),
      "name: spekta_grep\ndescription: legacy search\nparams: {}\nxml_example: <grep />\n",
    );
    const tools = await loadToolDefinitions(true);

    expect(tools.some((tool) => tool.name === "spekta_grep")).toBe(false);
    expect(
      tools.find((tool) => tool.name === "spekta_rg")?.description,
    ).not.toBe("legacy search");
  });
});
