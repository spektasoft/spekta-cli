import { describe, it, expect, vi, beforeEach } from "vitest";
import { runReadInteractive } from "./read-interactive";
import { checkbox, input, select } from "@inquirer/prompts";
import autocomplete from "inquirer-autocomplete-standalone";
import * as readCmd from "./read";
import { openEditor } from "../editor-utils";

vi.mock("@inquirer/prompts");
vi.mock("inquirer-autocomplete-standalone");
vi.mock("../editor-utils", () => ({
  openEditor: vi.fn(),
}));
vi.mock("./read", () => ({
  runRead: vi.fn(),
}));

describe("runReadInteractive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // Mock the menu to select done immediately
    vi.mocked(select).mockResolvedValueOnce("done");

    await runReadInteractive();

    // Verify runRead was never called (no files selected)
    expect(readCmd.runRead).not.toHaveBeenCalled();
  });
});
