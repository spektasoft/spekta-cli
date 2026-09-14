import { describe, expect, it, vi } from "vitest";
import { COMMANDS } from "./index";

describe("public command registry", () => {
  it("keeps native commands available from the public index", () => {
    expect(COMMANDS.commit).toBeDefined();
    expect(COMMANDS.read).toBeDefined();
    expect(COMMANDS.write).toBeDefined();
  });

  it("keeps hidden command metadata intact", () => {
    expect(COMMANDS.grep.hidden).toBe(true);
    expect(COMMANDS.replace.hidden).toBe(true);
    expect(COMMANDS.write.hidden).toBe(true);
    expect(COMMANDS.mcp.hidden).toBe(true);
  });

  it("keeps user-facing commands visible", () => {
    for (const command of [
      "commit",
      "read",
      "repl",
      "prompt",
      "review",
      "pr",
    ]) {
      expect(COMMANDS[command].hidden).not.toBe(true);
    }
  });

  it("keeps native commands ahead of the RTK catch-all", () => {
    expect(COMMANDS.commit).toBeDefined();
    expect(COMMANDS.read).toBeDefined();
    expect(COMMANDS.write).toBeDefined();
  });
});

describe("Interactive menu command visibility", () => {
  it("grep command is hidden from interactive menu", () => {
    expect(COMMANDS.grep).toBeDefined();
    expect(COMMANDS.grep.hidden).toBe(true);
  });

  it("critical user commands remain visible", () => {
    const visibleCommands = [
      "commit",
      "read",
      "repl",
      "prompt",
      "review",
      "pr",
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

describe("interactive command dispatch", () => {
  it("passes --interactive when the commit command is selected from the menu", async () => {
    const runCommit = vi.fn().mockResolvedValue(undefined);
    await runCommit(["--interactive"]);
    expect(runCommit).toHaveBeenCalledWith(["--interactive"]);
  });
});
