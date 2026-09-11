import { afterEach, describe, it, expect, vi } from "vitest";
import * as config from "../core/config";
import { processOutput, openEditor } from "./editor-utils";

vi.mock("./editor-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor-utils")>();
  return { ...actual, openEditor: vi.fn() };
});

describe("Editor Resilience", () => {
  afterEach(() => vi.restoreAllMocks());

  it("should not throw error if openEditor fails", async () => {
    vi.mocked(openEditor).mockRejectedValue(new Error("Editor not found"));

    // This should resolve successfully despite the internal openEditor failure
    await expect(processOutput("content", "prefix")).resolves.not.toThrow();
  });

  it("persists output without opening the editor when SPEKTA_NO_EDITOR is enabled", async () => {
    vi.spyOn(config, "getEnv").mockResolvedValue({
      SPEKTA_EDITOR: "editor",
      SPEKTA_NO_EDITOR: "1",
    });
    await processOutput("content", "prefix");
    expect(openEditor).not.toHaveBeenCalled();
  });
});
