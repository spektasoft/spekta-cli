import * as prompts from "@inquirer/prompts";
import fs from "fs-extra";
import autocomplete from "inquirer-autocomplete-standalone"; // Added
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../config";
import * as fsManager from "../fs-manager";
import * as git from "../git";
import * as gitUi from "../git-ui";
import { runReview } from "./review";
import * as reviewContext from "./review-context";

vi.mock("fs-extra");
vi.mock("@inquirer/prompts");
vi.mock("inquirer-autocomplete-standalone"); // Added
vi.mock("../config");
vi.mock("../git");
vi.mock("../fs-manager");
vi.mock("../git-ui");
vi.mock("execa");
vi.mock("./review-context");

describe("runReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(git.resolveHash).mockImplementation(async (ref) =>
      ref === "HEAD" ? "head-sha" : ref,
    );
    vi.mocked(git.getNearestMerge).mockResolvedValue("base-sha");
    vi.mocked(git.getInitialCommit).mockResolvedValue("initial-sha");
    vi.mocked(git.getGitDiff).mockResolvedValue("DIFF_CONTENT");

    vi.mocked(config.getEnv).mockResolvedValue({ SPEKTA_EDITOR: "code" });
    vi.mocked(config.getIgnorePatterns).mockResolvedValue([]);
    vi.mocked(config.getPromptContent).mockResolvedValue("TEMPLATE");

    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getSafeMetadata).mockResolvedValue({
      nextNum: 1,
      lastFile: null,
    });
    vi.mocked(fsManager.getHashesFromReviewFile).mockReturnValue(null);

    vi.mocked(prompts.select).mockResolvedValue(true);
    vi.mocked(prompts.confirm).mockResolvedValue(true);
    vi.mocked(prompts.input).mockResolvedValue("custom-hash");

    // Mock autocomplete to return the first value of choices by default
    vi.mocked(autocomplete).mockResolvedValue("folder-id");

    vi.mocked(reviewContext.collectSupplementalContext).mockResolvedValue(
      "SUPPLEMENTAL_CONTENT",
    );

    vi.mocked(gitUi.promptHashRange).mockImplementation(async (s, e) => ({
      start: s,
      end: e,
    }));
  });

  it("writes the prompt file and opens the editor", async () => {
    await runReview();

    const expectedPath = "/mock/dir/r-001-base-sh..head-sh.md";
    expect(fs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("DIFF_CONTENT"),
    );
  });

  it("calls collectSupplementalContext when isInitial is true", async () => {
    vi.mocked(prompts.select).mockResolvedValue(true);
    await runReview();
    expect(reviewContext.collectSupplementalContext).toHaveBeenCalled();
  });

  it("does not call collectSupplementalContext when isInitial is false", async () => {
    // 1. Set Review Type to False (Continue)
    vi.mocked(prompts.select).mockResolvedValueOnce(false);

    // 2. Setup folder mocks
    vi.mocked(fsManager.listReviewFolders).mockResolvedValue(["folder-id"]);
    vi.mocked(autocomplete).mockResolvedValue("folder-id");

    // 3. Setup metadata to have a lastFile to avoid the "Older commit hash" input prompt
    vi.mocked(fsManager.getSafeMetadata).mockResolvedValue({
      nextNum: 2,
      lastFile: "r-001-base..head.md",
    });
    vi.mocked(fsManager.getHashesFromReviewFile).mockReturnValue({
      start: "base",
      end: "head",
    });

    await runReview();

    expect(reviewContext.collectSupplementalContext).not.toHaveBeenCalled();
    // Verify it used the correct folderId for directory resolution
    expect(fsManager.getReviewDir).toHaveBeenCalledWith(false, "folder-id");
  });
});
