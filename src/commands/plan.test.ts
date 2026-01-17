import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPlan } from "./plan";
import * as fsManager from "../fs-manager";
import * as config from "../config";

vi.mock("../config");
vi.mock("../fs-manager");
vi.mock("fs-extra");
vi.mock("execa");

describe("runPlan", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined; // Reset exit code before each test
    vi.mocked(config.getEnv).mockResolvedValue({});
    vi.mocked(fsManager.generateId).mockReturnValue("202601171200");
    vi.mocked(fsManager.getPlansDir).mockResolvedValue("/mock/plans");
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("logs error and sets exit code if plan.md template lacks {{ID}} placeholder", async () => {
    vi.mocked(config.getPromptContent).mockResolvedValue(
      "No placeholder here."
    );

    await runPlan();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error: Template "plan.md" must contain the placeholder {{ID}}.'
    );
    expect(process.exitCode).toBe(1);
  });

  it("handles editor launch failure gracefully", async () => {
    vi.mocked(config.getEnv).mockResolvedValue({
      SPEKTA_EDITOR: "nonexistent",
    });
    vi.mocked(config.getPromptContent).mockResolvedValue("Context ID: {{ID}}");
    const execaMock = vi.fn().mockRejectedValue(new Error("spawn ENOENT"));
    const execaOrig = await import("execa");
    vi.spyOn(execaOrig, "execa").mockImplementation(execaMock);

    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runPlan();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open editor")
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("You can manually open the plan at")
    );
    // Ensure no error was logged and exit code remains unset (or 0)
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined(); // or 0, but currently unset on success
  });
});
