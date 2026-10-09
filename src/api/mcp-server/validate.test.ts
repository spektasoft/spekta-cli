import { beforeEach, describe, expect, it, vi } from "vitest";

import { validateToolDefinitions } from "./validate";
import { Logger } from "../../utils/logger";

vi.mock("../../utils/logger", () => ({
  Logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./registry", () => ({
  TOOL_REGISTRY: {
    spekta_rg: {},
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateToolDefinitions", () => {
  it("warns when YAML defines a tool without an implementation", () => {
    validateToolDefinitions([
      {
        name: "missing_tool",
        description: "Missing implementation",
        params: {},
      },
    ]);

    expect(Logger.warn).toHaveBeenCalledWith(
      "Configuration Mismatch: Tool 'missing_tool' is defined in YAML but has no implementation in TOOL_REGISTRY.",
    );
  });

  it("warns when a defined parameter has no description", () => {
    validateToolDefinitions([
      {
        name: "spekta_rg",
        description: "Search",
        params: {
          patterns: { description: "" },
        },
      },
    ]);

    expect(Logger.warn).toHaveBeenCalledWith(
      "Documentation Gap: Parameter 'patterns' for tool 'spekta_rg' lacks a description in YAML.",
    );
  });

  it("does not warn for implemented tools with documented parameters", () => {
    validateToolDefinitions([
      {
        name: "spekta_rg",
        description: "Search",
        params: {
          patterns: { description: "search patterns" },
          paths: { description: "workspace paths" },
          globs: { description: "ordered glob filters" },
          case_mode: { description: "case behavior" },
        },
      },
    ]);

    expect(Logger.warn).not.toHaveBeenCalled();
  });
});
