import { beforeEach, describe, expect, it, vi } from "vitest";

import { COMMANDS, dispatchCommand, runInteractiveMenu } from "./commands";
import { runRtkProxy } from "../commands/proxy";
import { searchableSelect } from "../ui/ui";

vi.mock("../commands/proxy", () => ({
  runRtkProxy: vi.fn(),
}));

vi.mock("../ui/ui", () => ({
  searchableSelect: vi.fn(),
}));

describe("dispatchCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches native commands before the RTK catch-all", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const original = COMMANDS.commit.run;

    COMMANDS.commit.run = run;

    await dispatchCommand("commit", ["--message"]);

    expect(run).toHaveBeenCalledWith(["--message"]);
    expect(runRtkProxy).not.toHaveBeenCalled();

    COMMANDS.commit.run = original;
  });

  it("delegates unknown commands to the RTK proxy", async () => {
    vi.mocked(runRtkProxy).mockResolvedValueOnce(undefined);

    await dispatchCommand("unknown-cmd", ["--arg"]);

    expect(runRtkProxy).toHaveBeenCalledTimes(1);
    expect(runRtkProxy).toHaveBeenCalledWith("unknown-cmd", ["--arg"]);
  });
});

describe("runInteractiveMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides commands marked hidden and adds Exit", async () => {
    vi.mocked(searchableSelect).mockResolvedValueOnce("exit");

    await runInteractiveMenu();

    const [, choices] = vi.mocked(searchableSelect).mock.calls[0];

    expect(choices).toEqual(
      expect.arrayContaining([
        { name: "Generate Commit Message", value: "commit" },
        { name: "Read Files", value: "read" },
        { name: "Exit", value: "exit" },
      ]),
    );
    expect(choices).not.toEqual(
      expect.arrayContaining([
        { name: "Search Project (ripgrep)", value: "grep" },
        { name: "Replace Code in File", value: "replace" },
        { name: "Write New File (agent tool)", value: "write" },
        { name: "Start the MCP Server", value: "mcp" },
      ]),
    );
  });

  it("passes --interactive when commit is selected", async () => {
    vi.mocked(searchableSelect).mockResolvedValueOnce("commit");

    const run = vi.fn().mockResolvedValue(undefined);
    const original = COMMANDS.commit.run;
    COMMANDS.commit.run = run;

    await runInteractiveMenu();

    expect(run).toHaveBeenCalledWith(["--interactive"]);

    COMMANDS.commit.run = original;
  });

  it("runs a non-commit selection without arguments", async () => {
    vi.mocked(searchableSelect).mockResolvedValueOnce("read");

    const run = vi.fn().mockResolvedValue(undefined);
    const original = COMMANDS.read.run;
    COMMANDS.read.run = run;

    await runInteractiveMenu();

    expect(run).toHaveBeenCalledWith();

    COMMANDS.read.run = original;
  });

  it("does nothing when Exit is selected", async () => {
    vi.mocked(searchableSelect).mockResolvedValueOnce("exit");

    const run = vi.fn().mockResolvedValue(undefined);
    const original = COMMANDS.commit.run;
    COMMANDS.commit.run = run;

    await runInteractiveMenu();

    expect(run).not.toHaveBeenCalled();

    COMMANDS.commit.run = original;
  });
});
