import { describe, expect, it } from "vitest";
import { COMMANDS } from "./index";

describe("Interactive menu command visibility", () => {
  it("grep command is hidden from interactive menu", () => {
    expect(COMMANDS.grep).toBeDefined();
    expect(COMMANDS.grep.hidden).toBe(true);
  });

  it("critical user commands remain visible", () => {
    const visibleCommands = [
      "commit",
      "repl",
      "prompt",
      "review",
      "pr",
      "prompt",
    ];
    for (const cmd of visibleCommands) {
      expect(COMMANDS[cmd]).toBeDefined();
      expect(COMMANDS[cmd].hidden).not.toBe(true);
    }
  });

  it("agent-specific commands remain hidden", () => {
    const agentCommands = ["replace", "write", "mcp"];
    for (const cmd of agentCommands) {
      expect(COMMANDS[cmd].hidden).toBe(true);
    }
  });
});
