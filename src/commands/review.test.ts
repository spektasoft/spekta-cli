import { describe, it, expect, vi, beforeEach } from "vitest";
import { runReview } from "./review";
import fs from "fs-extra";
import * as prompts from "@inquirer/prompts";
import * as config from "../config";
import * as git from "../git";
import * as fsManager from "../fs-manager";
import { execa } from "execa";

vi.mock("fs-extra");
vi.mock("@inquirer/prompts");
vi.mock("../config");
vi.mock("../git");
vi.mock("../fs-manager");
vi.mock("execa");

describe("runReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(git.resolveHash).mockImplementation(async (ref) => ref);
    vi.mocked(git.getNearestMerge).mockResolvedValue("base-sha");
    vi.mocked(config.getEnv).mockResolvedValue({ SPEKTA_EDITOR: "code" });
    vi.mocked(config.getIgnorePatterns).mockResolvedValue([]);
    vi.mocked(config.getPromptContent).mockResolvedValue("TEMPLATE");
    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 1,
      lastFile: null,
    });
    vi.mocked(git.getGitDiff).mockResolvedValue("DIFF_CONTENT");
    vi.mocked(prompts.select).mockResolvedValue(true);
    vi.mocked(prompts.confirm).mockResolvedValue(true);
  });

  it("writes the prompt file and opens the editor", async () => {
    await runReview();

    const expectedPath = "/mock/dir/r-001-base-sh..HEAD.md";
    expect(fs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("DIFF_CONTENT")
    );
    expect(execa).toHaveBeenCalledWith("code", [expectedPath], {
      stdio: "inherit",
    });
  });

  it("handles missing editor gracefully by logging instructions", async () => {
    vi.mocked(config.getEnv).mockResolvedValue({ SPEKTA_EDITOR: "" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runReview();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Tip: Set SPEKTA_EDITOR")
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it("handles editor execution failure without crashing", async () => {
    vi.mocked(execa).mockRejectedValue(new Error("Editor not found"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(runReview()).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to open editor")
    );
  });

  it("includes previous review content in validation reviews", async () => {
    vi.mocked(prompts.select)
      .mockResolvedValueOnce(false) // isInitial = false
      .mockResolvedValueOnce("202401011200"); // folder selection

    vi.mocked(fsManager.listReviewFolders).mockResolvedValue(["202401011200"]);
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 2,
      lastFile: "r-001-abc..def.md",
    });
    // @ts-ignore
    vi.mocked(fs.readFile).mockResolvedValue("OLD_REVIEW_RESULTS");
    vi.mocked(fsManager.getHashesFromReviewFile).mockReturnValue({
      start: "abc",
      end: "def",
    });

    await runReview();

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(
        "PREVIOUS REVIEW:\n````markdown\nOLD_REVIEW_RESULTS"
      )
    );
  });
});
