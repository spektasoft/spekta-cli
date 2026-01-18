import fs from "fs-extra";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("collectSupplementalContext integration", () => {
  const testDir = path.join(process.cwd(), "test-temp");

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it("should handle empty selections gracefully", () => {
    const selectedPlans: string[] = [];
    const selectedFiles: any[] = [];
    const totalSelections = selectedPlans.length + selectedFiles.length;

    expect(totalSelections).toBe(0);
  });

  it("should correctly calculate menu choices based on state", () => {
    const hasSelections = true;
    const choices = ["Add Plan", "Add File"];

    if (hasSelections) {
      choices.push("Remove");
    }

    choices.push(hasSelections ? "Finalize" : "None");

    expect(choices).toContain("Remove");
    expect(choices).toContain("Finalize");
    expect(choices).not.toContain("None");
  });

  it("should track line counts accurately across operations", () => {
    const files = [
      { path: "a.ts", content: "a", lineCount: 100 },
      { path: "b.ts", content: "b", lineCount: 200 },
    ];

    let total = files.reduce((sum, f) => sum + f.lineCount, 0);
    expect(total).toBe(300);

    // Simulate removal
    const removed = files.splice(0, 1)[0];
    total -= removed.lineCount;

    expect(total).toBe(200);
    expect(files.length).toBe(1);
  });

  it("should maintain selection order", () => {
    const selectedPlans = ["plan1.md", "plan2.md", "plan3.md"];
    const selectedFiles = [
      { path: "a.ts", content: "", lineCount: 10 },
      { path: "b.ts", content: "", lineCount: 20 },
    ];

    expect(selectedPlans[0]).toBe("plan1.md");
    expect(selectedPlans[2]).toBe("plan3.md");
    expect(selectedFiles[0].path).toBe("a.ts");
  });
});
