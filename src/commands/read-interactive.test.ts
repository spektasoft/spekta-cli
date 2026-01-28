import { describe, it, expect, vi, beforeEach } from "vitest";
import { runReadInteractive } from "./read-interactive";
import { checkbox, input, select } from "@inquirer/prompts";
import autocomplete from "inquirer-autocomplete-standalone";
import * as readCmd from "./read";
import { openEditor } from "../editor-utils";
import { execa } from "execa";
import { getEnv } from "../config";

vi.mock("@inquirer/prompts");
vi.mock("inquirer-autocomplete-standalone");
vi.mock("execa");
vi.mock("../config", () => ({
  getEnv: vi.fn(),
  getIgnorePatterns: vi.fn().mockResolvedValue([]),
}));
vi.mock("../editor-utils", () => ({
  openEditor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./read", () => ({
  runRead: vi.fn(),
}));

describe("runReadInteractive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for execa to return a file list
    vi.mocked(execa).mockResolvedValue({
      stdout: "src/utils/helpers.ts\ntest.ts",
    } as any);
    // Default mock for getEnv
    vi.mocked(getEnv).mockResolvedValue({
      SPEKTA_EDITOR: "mock-editor",
    });
  });

  it("should support removing added files before finalizing", async () => {
    vi.mocked(select)
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("remove")
      .mockResolvedValueOnce("done");

    vi.mocked(autocomplete).mockResolvedValueOnce("test.ts");
    vi.mocked(input).mockResolvedValueOnce("f");
    vi.mocked(checkbox).mockResolvedValueOnce([0]); // Remove the only selected item

    await runReadInteractive();

    expect(readCmd.runRead).not.toHaveBeenCalled();
  });

  it("should handle range ending at end-of-file using $", async () => {
    vi.mocked(select)
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("done");

    vi.mocked(autocomplete).mockResolvedValueOnce("example.ts");
    vi.mocked(input).mockResolvedValueOnce("10").mockResolvedValueOnce("$");

    await runReadInteractive();

    expect(readCmd.runRead).toHaveBeenCalledWith(
      [{ path: "example.ts", range: { start: 10, end: "$" } }],
      { save: true, interactive: true },
    );
  });

  it("should process a full file selection without token validation", async () => {
    // Mock the menu flow: add file, then done
    vi.mocked(select)
      .mockResolvedValueOnce("add") // First menu: choose "add"
      .mockResolvedValueOnce("done"); // Second menu: choose "done"

    // Mock file selection
    vi.mocked(autocomplete).mockResolvedValueOnce("test.ts");

    // Mock line range input: 'f' for full file
    vi.mocked(input).mockResolvedValueOnce("f");

    await runReadInteractive();

    expect(readCmd.runRead).toHaveBeenCalledWith(
      [{ path: "test.ts", range: undefined }],
      { save: true, interactive: true },
    );
  });

  it("should verify mock call order", async () => {
    vi.mocked(select)
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("done");
    vi.mocked(autocomplete).mockResolvedValueOnce("test.ts");
    vi.mocked(input).mockResolvedValueOnce("f");

    await runReadInteractive();

    // Verify select was called twice (add, done)
    expect(select).toHaveBeenCalledTimes(2);
    // Verify autocomplete was called once
    expect(autocomplete).toHaveBeenCalledTimes(1);
    // Verify input was called once (for start line)
    expect(input).toHaveBeenCalledTimes(1);
  });

  it("should process a range selection with start and end lines", async () => {
    // Mock the menu flow: add file, then done
    vi.mocked(select)
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("done");

    // Mock file selection
    vi.mocked(autocomplete).mockResolvedValueOnce("example.ts");

    // Mock line range input: start line, then end line
    vi.mocked(input)
      .mockResolvedValueOnce("10") // Start line
      .mockResolvedValueOnce("20"); // End line

    await runReadInteractive();

    expect(readCmd.runRead).toHaveBeenCalledWith(
      [{ path: "example.ts", range: { start: 10, end: 20 } }],
      { save: true, interactive: true },
    );
  });

  it("should handle cancel action and exit without calling runRead", async () => {
    // Mock the menu to return cancel immediately
    vi.mocked(select).mockResolvedValueOnce("cancel");

    await runReadInteractive();

    // Verify runRead was never called
    expect(readCmd.runRead).not.toHaveBeenCalled();
  });

  it("should handle multiple file additions in sequence", async () => {
    // Mock the menu flow: add, add, done
    vi.mocked(select)
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("done");

    // Mock file selections
    vi.mocked(autocomplete)
      .mockResolvedValueOnce("file1.ts")
      .mockResolvedValueOnce("file2.ts");

    // Mock line range inputs: full file for first, range for second
    vi.mocked(input)
      .mockResolvedValueOnce("f") // First file: full
      .mockResolvedValueOnce("5") // Second file: start line
      .mockResolvedValueOnce("15"); // Second file: end line

    await runReadInteractive();

    expect(readCmd.runRead).toHaveBeenCalledWith(
      [
        { path: "file1.ts", range: undefined },
        { path: "file2.ts", range: { start: 5, end: 15 } },
      ],
      { save: true, interactive: true },
    );
  });

  it("should handle done without selecting any files", async () => {
    vi.mocked(select).mockResolvedValueOnce("done");

    await runReadInteractive();

    expect(readCmd.runRead).not.toHaveBeenCalled();
  });

  it("should open file in editor with 'o' and not add it to selection", async () => {
    // Setup environment for this specific test
    vi.mocked(getEnv).mockResolvedValue({
      SPEKTA_EDITOR: "mock-editor",
    });

    // First menu: add file, then after action is handled, next loop: done
    vi.mocked(select)
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("done");

    // Autocomplete selects the specific file
    vi.mocked(autocomplete).mockResolvedValueOnce("src/utils/helpers.ts");

    // Input receives 'o' command to open in editor
    vi.mocked(input).mockResolvedValueOnce("o");

    await runReadInteractive();

    // Verify editor was opened with correct path and command
    expect(openEditor).toHaveBeenCalledWith(
      "mock-editor",
      "src/utils/helpers.ts",
    );

    // Verify file was NOT added to final selection (runRead should be called with empty array if loop broke at 'done')
    // Or in this case, the test ends after 'done' and should confirm runRead was not called with the 'o' file.
    expect(readCmd.runRead).not.toHaveBeenCalled();
  });

  it("should warn when trying to open editor without SPEKTA_EDITOR configured", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(getEnv).mockResolvedValue({}); // No SPEKTA_EDITOR

    vi.mocked(select)
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("done");

    vi.mocked(autocomplete).mockResolvedValueOnce("src/utils/helpers.ts");
    vi.mocked(input).mockResolvedValueOnce("o");

    await runReadInteractive();

    expect(openEditor).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("SPEKTA_EDITOR not configured.");

    consoleSpy.mockRestore();
  });
});
