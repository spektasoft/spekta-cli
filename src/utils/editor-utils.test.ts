import { describe, it, expect, vi } from "vitest";
import { processOutput, openEditor } from "./editor-utils";

vi.mock("./editor-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor-utils")>();
  return { ...actual, openEditor: vi.fn() };
});

describe("Editor Resilience", () => {
  it("should not throw error if openEditor fails", async () => {
    vi.mocked(openEditor).mockRejectedValue(new Error("Editor not found"));

    // This should resolve successfully despite the internal openEditor failure
    await expect(processOutput("content", "prefix")).resolves.not.toThrow();
  });
});
