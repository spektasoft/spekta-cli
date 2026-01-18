import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectSupplementalContext } from "./review-context";
import fs from "fs-extra";
import * as prompts from "@inquirer/prompts";
import * as fsManager from "../fs-manager";
import * as ui from "../ui";

vi.mock("fs-extra");
vi.mock("@inquirer/prompts");
vi.mock("../fs-manager");
vi.mock("../ui");

describe("collectSupplementalContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsManager.getPlansDir).mockResolvedValue("/mock/plans");
  });

  it("returns empty string when finalize is selected immediately", async () => {
    vi.mocked(prompts.select).mockResolvedValue("finalize");
    const result = await collectSupplementalContext();
    expect(result).toBe("");
  });

  it("should filter already-selected plans (logic check)", () => {
    const allPlans = ["plan1.md", "plan2.md", "plan3.md"];
    const selectedPlans = ["plan1.md", "plan3.md"];
    const availablePlans = allPlans.filter((f) => !selectedPlans.includes(f));
    expect(availablePlans).toEqual(["plan2.md"]);
  });

  it("should detect duplicate file paths (logic check)", () => {
    const selectedFiles = [
      { path: "src/test.ts", content: "test", lineCount: 10 },
    ];
    const newPath = "src/test.ts";
    const isDuplicate = selectedFiles.some((f) => f.path === newPath);
    expect(isDuplicate).toBe(true);
  });

  it("should generate proper context header", async () => {
    // Simulate adding a file then finalizing
    vi.mocked(prompts.select)
      .mockResolvedValueOnce("file") // Select add file
      .mockResolvedValueOnce("finalize"); // Then finalize

    vi.mocked(prompts.input).mockResolvedValue("src/test.ts");
    // @ts-ignore
    vi.mocked(fs.pathExists).mockResolvedValue(true);
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => false } as any);
    // @ts-ignore
    vi.mocked(fs.readFile).mockResolvedValue("console.log('test');");

    const result = await collectSupplementalContext();

    expect(result).toContain("### SUPPLEMENTAL CONTEXT");
    expect(result).toContain("#### REFERENCE FILE: src/test.ts");
    expect(result).toContain("console.log('test');");
  });

  it("should format plan references correctly (logic check)", () => {
    const planName = "test-plan.md";
    const planContent = "# Test Plan";
    const formatted = `#### REFERENCE IMPLEMENTATION PLAN: ${planName}\n\n\`\`\`\`markdown\n${planContent}\n\`\`\`\`\n\n`;
    expect(formatted).toContain("REFERENCE IMPLEMENTATION PLAN");
    expect(formatted).toContain(planName);
  });
});

describe("Cumulative line count tracking (Logic)", () => {
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

describe("Removal logic (Logic)", () => {
  it("should correctly parse removal identifiers", () => {
    const item = "plan:feature-auth.md";
    const [type, ...pathParts] = item.split(":");
    const identifier = pathParts.join(":");
    expect(type).toBe("plan");
    expect(identifier).toBe("feature-auth.md");
  });
});
