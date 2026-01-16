import { describe, it, expect, vi } from "vitest";
import { finalizeOutput, openEditor } from "../src/editor-utils";

vi.mock("../src/editor-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/editor-utils")>();
  return { ...actual, openEditor: vi.fn() };
});

describe("Editor Resilience", () => {
  it("should not throw error if openEditor fails", async () => {
    vi.mocked(openEditor).mockRejectedValue(new Error("Editor not found"));

    // This should resolve successfully despite the internal openEditor failure
    await expect(
      finalizeOutput("content", "prefix", "success")
    ).resolves.not.toThrow();
  });
});
