import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatFile } from "./format-utils";
import prettier from "prettier";
import { execa } from "execa";
import fs from "fs-extra";

vi.mock("prettier", () => ({
  default: {
    resolveConfig: vi.fn(),
    format: vi.fn(),
  },
}));

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    ensureDir: vi.fn(),
  },
}));

describe("formatFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses Prettier for non-PHP files", async () => {
    const content = "const x = 1";
    const filePath = "test.ts";
    vi.mocked(prettier.resolveConfig).mockResolvedValue({ semi: true });
    vi.mocked(prettier.format).mockResolvedValue("const x = 1;");

    const result = await formatFile(filePath, content);

    expect(prettier.format).toHaveBeenCalledWith(
      content,
      expect.objectContaining({ filepath: filePath }),
    );
    expect(result).toBe("const x = 1;");
  });

  it("uses Pint for PHP files when vendor/bin/pint exists", async () => {
    const content = "<?php echo 'hi';";
    const filePath = "test.php";
    vi.mocked(fs.pathExists).mockResolvedValue(true); // Pint exists
    vi.mocked(fs.readFile).mockResolvedValue("<?php echo 'hi';\n");

    const result = await formatFile(filePath, content);

    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      content,
      "utf-8",
    );
    expect(execa).toHaveBeenCalledWith("./vendor/bin/pint", [filePath]);
    expect(result).toBe("<?php echo 'hi';\n");
  });

  it("falls back to Prettier for PHP files when Pint is missing", async () => {
    const content = "<?php echo 'hi';";
    const filePath = "test.php";
    vi.mocked(fs.pathExists).mockResolvedValue(false); // Pint missing
    vi.mocked(prettier.format).mockResolvedValue("<?php\n\necho 'hi';");

    const result = await formatFile(filePath, content);

    expect(prettier.format).toHaveBeenCalled();
    expect(result).toContain("<?php");
  });
});
