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
    spekta_grep: {},
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
        name: "spekta_grep",
        description: "Search",
        params: {
          pattern: { description: "" },
        },
      },
    ]);

    expect(Logger.warn).toHaveBeenCalledWith(
      "Documentation Gap: Parameter 'pattern' for tool 'spekta_grep' lacks a description in YAML.",
    );
  });

  it("does not warn for implemented tools with documented parameters", () => {
    validateToolDefinitions([
      {
        name: "spekta_grep",
        description: "Search",
        params: {
          pattern: { description: "search pattern" },
        },
      },
    ]);

    expect(Logger.warn).not.toHaveBeenCalled();
  });
});
