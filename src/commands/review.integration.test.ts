import fs from "fs-extra";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Helper to mock all prompts consistently
function mockAllPrompts(
  overrides?: Partial<{
    select: any[];
    input: any[];
    confirm: any[];
    checkbox: any[];
  }>,
) {
  vi.doMock("@inquirer/prompts", () => ({
    select: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(overrides?.select?.shift() ?? "finalize"),
      ),
    input: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(overrides?.input?.shift() ?? ""),
      ),
    confirm: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(overrides?.confirm?.shift() ?? true),
      ),
    checkbox: vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(overrides?.checkbox?.shift() ?? []),
      ),
  }));
}

describe("collectSupplementalContext integration", () => {
  const testDir = path.join(process.cwd(), "test-temp-1"); // Use unique temp dir per suite to be safe
  const testPlansDir = path.join(testDir, "plans");
  const testFilesDir = path.join(testDir, "files");

  beforeEach(async () => {
    await fs.ensureDir(testDir);
    await fs.ensureDir(testPlansDir);
    await fs.ensureDir(testFilesDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
    vi.clearAllMocks();
    vi.resetModules(); // Critical: Force module re-evaluation for next test
  });

  it("should include supplemental context header only when items are selected", async () => {
    // Create a test plan file
    const testPlanPath = path.join(testPlansDir, "test-plan.md");
    await fs.writeFile(
      testPlanPath,
      "# Test Implementation Plan\n\nThis is a test plan.",
    );

    // Mock the getPlansDir function
    const mockGetPlansDir = vi.fn().mockResolvedValue(testPlansDir);
    vi.doMock("../fs-manager", () => ({
      getPlansDir: mockGetPlansDir,
    }));

    mockAllPrompts({
      select: ["plan", "finalize"],
      confirm: [true],
    });

    vi.doMock("../ui", () => ({
      searchableSelect: vi.fn().mockResolvedValue("test-plan.md"),
    }));

    const { collectSupplementalContext: mockedCollect } =
      await import("./review-context");

    const result = await mockedCollect();

    expect(result).toContain("### SUPPLEMENTAL CONTEXT");
    expect(result).toContain(
      "#### REFERENCE IMPLEMENTATION PLAN: test-plan.md",
    );
    expect(result).toContain("# Test Implementation Plan");
    expect(result).toContain("This is a test plan.");
  });

  it("should return empty string when no items are selected", async () => {
    mockAllPrompts({
      select: ["finalize"],
    });

    vi.doMock("../ui", () => ({
      searchableSelect: vi.fn(),
    }));

    const { collectSupplementalContext: mockedCollect } =
      await import("./review-context");

    const result = await mockedCollect();

    expect(result).toBe("");
  });

  it("should include multiple items in supplemental context", async () => {
    const testPlanPath1 = path.join(testPlansDir, "plan1.md");
    const testPlanPath2 = path.join(testPlansDir, "plan2.md");
    await fs.writeFile(testPlanPath1, "# Plan 1\n\nContent for plan 1.");
    await fs.writeFile(testPlanPath2, "# Plan 2\n\nContent for plan 2.");

    const mockGetPlansDir = vi.fn().mockResolvedValue(testPlansDir);
    vi.doMock("../fs-manager", () => ({
      getPlansDir: mockGetPlansDir,
    }));

    mockAllPrompts({
      select: ["plan", "plan", "finalize"],
      confirm: [true, true],
    });

    vi.doMock("../ui", () => ({
      searchableSelect: vi
        .fn()
        .mockResolvedValueOnce("plan1.md")
        .mockResolvedValueOnce("plan2.md"),
    }));

    const { collectSupplementalContext: mockedCollect } =
      await import("./review-context");

    const result = await mockedCollect();

    expect(result).toContain("### SUPPLEMENTAL CONTEXT");
    expect(result).toContain("#### REFERENCE IMPLEMENTATION PLAN: plan1.md");
    expect(result).toContain("#### REFERENCE IMPLEMENTATION PLAN: plan2.md");
    expect(result).toContain("# Plan 1");
    expect(result).toContain("Content for plan 1.");
    expect(result).toContain("# Plan 2");
    expect(result).toContain("Content for plan 2.");
  });

  it("should include file references in supplemental context", async () => {
    const testFilePath = path.join(testFilesDir, "test-file.ts");
    await fs.writeFile(testFilePath, "const test = 'content';");

    mockAllPrompts({
      select: ["file", "finalize"],
      input: [testFilePath],
    });

    vi.doMock("../ui", () => ({
      searchableSelect: vi.fn(),
    }));

    const { collectSupplementalContext: mockedCollect } =
      await import("./review-context");

    const result = await mockedCollect();

    expect(result).toContain("### SUPPLEMENTAL CONTEXT");
    expect(result).toContain(`#### REFERENCE FILE: ${testFilePath}`);
    expect(result).toContain("const test = 'content';");
  });
});

describe("review command prompt integrity", () => {
  const testDir = path.join(process.cwd(), "test-temp-2"); // Unique temp dir

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
    vi.clearAllMocks();
    vi.resetModules(); // Critical: Force module re-evaluation for next test
  });

  it("should generate prompt with supplemental context header for initial reviews", async () => {
    const testPlansDir = path.join(testDir, "plans");
    await fs.ensureDir(testPlansDir);
    const testPlanPath = path.join(testPlansDir, "test-plan.md");
    await fs.writeFile(testPlanPath, "# Test Plan\n\nTest content.");

    const mockGetPlansDir = vi.fn().mockResolvedValue(testPlansDir);
    vi.doMock("../fs-manager", () => ({
      getPlansDir: mockGetPlansDir,
    }));

    // Manual mock here
    const mockSelect = vi
      .fn()
      .mockResolvedValueOnce("plan")
      .mockResolvedValueOnce("finalize");

    const mockSearchableSelect = vi.fn().mockResolvedValue("test-plan.md");

    vi.doMock("@inquirer/prompts", () => ({
      select: mockSelect,
      input: vi.fn(),
      checkbox: vi.fn(),
      confirm: vi.fn(),
    }));

    vi.doMock("../ui", () => ({
      searchableSelect: mockSearchableSelect,
    }));

    const { collectSupplementalContext: mockedCollect } =
      await import("./review-context");
    const supplementalContext = await mockedCollect();

    expect(supplementalContext).toContain("### SUPPLEMENTAL CONTEXT");
    expect(supplementalContext).toContain(
      "#### REFERENCE IMPLEMENTATION PLAN: test-plan.md",
    );
    expect(supplementalContext).toContain("# Test Plan");
    expect(supplementalContext).toContain("Test content.");
  });

  it("should not include supplemental context header when no items selected", async () => {
    mockAllPrompts({
      select: ["finalize"],
    });

    vi.doMock("../ui", () => ({
      searchableSelect: vi.fn(),
    }));

    const { collectSupplementalContext: mockedCollect } =
      await import("./review-context");
    const supplementalContext = await mockedCollect();

    expect(supplementalContext).toBe("");
    expect(supplementalContext).not.toContain("### SUPPLEMENTAL CONTEXT");
  });
});
