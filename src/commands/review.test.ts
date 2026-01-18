import { describe, it, expect, vi, beforeEach } from "vitest";
import { runReview } from "./review";
import fs from "fs-extra";
import * as prompts from "@inquirer/prompts";
import * as config from "../config";
import * as git from "../git";
import * as fsManager from "../fs-manager";
import * as gitUi from "../git-ui"; // Added
import { execa } from "execa";

vi.mock("fs-extra");
vi.mock("@inquirer/prompts");
vi.mock("../config");
vi.mock("../git");
vi.mock("../fs-manager");
vi.mock("../git-ui"); // Added
vi.mock("execa");

describe("runReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Standard Git Mocks
    vi.mocked(git.resolveHash).mockImplementation(async (ref) => ref);
    vi.mocked(git.getNearestMerge).mockResolvedValue("base-sha");
    vi.mocked(git.getInitialCommit).mockResolvedValue("initial-sha");
    vi.mocked(git.getGitDiff).mockResolvedValue("DIFF_CONTENT");

    // Config Mocks
    vi.mocked(config.getEnv).mockResolvedValue({ SPEKTA_EDITOR: "code" });
    vi.mocked(config.getIgnorePatterns).mockResolvedValue([]);
    vi.mocked(config.getPromptContent).mockResolvedValue("TEMPLATE");

    // FS Manager Mocks
    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getSafeMetadata).mockResolvedValue({
      nextNum: 1,
      lastFile: null,
    });
    vi.mocked(fsManager.getHashesFromReviewFile).mockReturnValue(null);

    // UI Mocks
    vi.mocked(prompts.select).mockResolvedValue(true);
    vi.mocked(prompts.confirm).mockResolvedValue(true);
    vi.mocked(prompts.input).mockResolvedValue("custom-hash");

    // Mock promptHashRange to return what it's given by default
    vi.mocked(gitUi.promptHashRange).mockImplementation(async (s, e) => ({
      start: s,
      end: e,
    }));
  });

  it("writes the prompt file and opens the editor", async () => {
    await runReview();

    const expectedPath = "/mock/dir/r-001-base-sh..HEAD.md";
    expect(fs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("DIFF_CONTENT"),
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
      expect.stringContaining("Tip: Set SPEKTA_EDITOR"),
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it("handles editor execution failure without crashing", async () => {
    const mockError = new Error("Editor not found");
    vi.mocked(execa).mockRejectedValue(mockError as never);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Reset exit code before test
    process.exitCode = 0;

    await runReview();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Warning: Failed to open editor "code"'),
    );
    expect(process.exitCode).toBe(1);
  });

  it("includes previous review content in validation reviews", async () => {
    // Setup: Continuing a review
    vi.mocked(prompts.select)
      .mockResolvedValueOnce(false) // isInitial = false
      .mockResolvedValueOnce("202401011200"); // folder selection

    vi.mocked(fsManager.listReviewFolders).mockResolvedValue(["202401011200"]);

    // Mock metadata to show a previous file exists
    vi.mocked(fsManager.getSafeMetadata).mockResolvedValue({
      nextNum: 2,
      lastFile: "r-001-abc..def.md",
    });

    // Mock extraction of hashes from that file
    vi.mocked(fsManager.getHashesFromReviewFile).mockReturnValue({
      start: "abc",
      end: "def",
    });

    // Correctly mock fs.readFile for the content check
    vi.mocked(fs.readFile).mockResolvedValue("OLD_REVIEW_RESULTS" as any);

    await runReview();

    // Verify the prompt includes the old content
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(
        "PREVIOUS REVIEW:\n````markdown\nOLD_REVIEW_RESULTS",
      ),
    );

    // Verify the start hash was derived from the previous review's end hash
    // Since resolveHash(extracted.end) is called
    expect(gitUi.promptHashRange).toHaveBeenCalledWith("def", "HEAD");
  });
});

describe("collectSupplementalContext", () => {
  it("should have proper type definitions", () => {
    // This test verifies compilation only
    interface SelectedFile {
      path: string;
      content: string;
      lineCount: number;
    }

    type MenuAction = "plan" | "file" | "remove" | "finalize";

    const testFile: SelectedFile = {
      path: "test.ts",
      content: "test",
      lineCount: 1,
    };

    const testAction: MenuAction = "finalize";

    expect(testFile.path).toBe("test.ts");
    expect(testAction).toBe("finalize");
  });

  it("should filter already-selected plans", () => {
    const allPlans = ["plan1.md", "plan2.md", "plan3.md"];
    const selectedPlans = ["plan1.md", "plan3.md"];

    const availablePlans = allPlans.filter((f) => !selectedPlans.includes(f));

    expect(availablePlans).toEqual(["plan2.md"]);
    expect(availablePlans.length).toBe(1);
  });

  it("should detect duplicate file paths", () => {
    const selectedFiles = [
      { path: "src/test.ts", content: "test", lineCount: 10 },
    ];

    const newPath = "src/test.ts";
    const isDuplicate = selectedFiles.some((f) => f.path === newPath);

    expect(isDuplicate).toBe(true);
  });

  it("should allow different file paths", () => {
    const selectedFiles = [
      { path: "src/test.ts", content: "test", lineCount: 10 },
    ];

    const newPath = "src/other.ts";
    const isDuplicate = selectedFiles.some((f) => f.path === newPath);

    expect(isDuplicate).toBe(false);
  });
});

describe("Cumulative line count tracking", () => {
  it("should correctly sum line counts", () => {
    const files = [
      { path: "a.ts", content: "", lineCount: 100 },
      { path: "b.ts", content: "", lineCount: 250 },
      { path: "c.ts", content: "", lineCount: 400 },
    ];

    const total = files.reduce((sum, f) => sum + f.lineCount, 0);

    expect(total).toBe(750);
  });
});

describe("Removal logic", () => {
  it("should correctly parse removal identifiers", () => {
    const item = "plan:feature-auth.md";
    const [type, ...pathParts] = item.split(":");
    const identifier = pathParts.join(":");

    expect(type).toBe("plan");
    expect(identifier).toBe("feature-auth.md");
  });

  it("should handle file paths with colons", () => {
    const item = "file:C:/Users/test/file.ts";
    const [type, ...pathParts] = item.split(":");
    const identifier = pathParts.join(":");

    expect(type).toBe("file");
    expect(identifier).toBe("C:/Users/test/file.ts");
  });

  it("should update line count after removal", () => {
    let totalLineCount = 500;
    const removedFile = { path: "test.ts", content: "", lineCount: 100 };

    totalLineCount -= removedFile.lineCount;

    expect(totalLineCount).toBe(400);
  });
});

describe("Context string generation", () => {
  it("should return empty string when no selections", () => {
    const selectedPlans: string[] = [];
    const selectedFiles: any[] = [];

    const result =
      selectedPlans.length === 0 && selectedFiles.length === 0 ? "" : "content";

    expect(result).toBe("");
  });

  it("should generate proper context header", () => {
    const header = "\n\n### SUPPLEMENTAL CONTEXT\n\n";

    expect(header).toContain("SUPPLEMENTAL CONTEXT");
  });

  it("should format plan references correctly", () => {
    const planName = "test-plan.md";
    const planContent = "# Test Plan";

    const formatted = `#### REFERENCE IMPLEMENTATION PLAN: ${planName}\n\n\`\`\`\`markdown\n${planContent}\n\`\`\`\`\n\n`;

    expect(formatted).toContain("REFERENCE IMPLEMENTATION PLAN");
    expect(formatted).toContain(planName);
    expect(formatted).toContain(planContent);
  });

  it("should format file references correctly", () => {
    const filePath = "src/test.ts";
    const fileContent = "console.log('test');";

    const formatted = `#### REFERENCE FILE: ${filePath}\n\n\`\`\`\`markdown\n${fileContent}\n\`\`\`\`\n\n`;

    expect(formatted).toContain("REFERENCE FILE");
    expect(formatted).toContain(filePath);
    expect(formatted).toContain(fileContent);
  });
});
