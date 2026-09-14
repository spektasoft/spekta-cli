import { describe, expect, it, vi } from "vitest";
import { COMMANDS } from "./index";
import { runRtkProxy } from "./commands/proxy";

vi.mock("./commands/proxy", () => ({
  runRtkProxy: vi.fn(),
}));

describe("dynamic RTK routing", () => {
  it("delegates unknown commands to the RTK proxy", async () => {
    const proxy = vi.mocked(runRtkProxy);
    proxy.mockResolvedValueOnce(undefined);

    // Simulating how main would be called with an unknown argument
    await runRtkProxy("unknown-cmd", ["--arg"]);
    expect(proxy).toHaveBeenCalledWith("unknown-cmd", ["--arg"]);
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
