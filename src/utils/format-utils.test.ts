import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatFileInPlace } from "./format-utils";
import { formatKotlinFileInPlace } from "./gradle-format-utils";

import prettier from "prettier";
import { execa } from "execa";
import fs from "fs-extra";
import path from "path";

vi.mock("./gradle-format-utils", () => ({
  formatKotlinFileInPlace: vi.fn(),
}));

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
    const absolutePath = path.resolve(filePath);

    vi.mocked(fs.readFile).mockResolvedValue(content);
    vi.mocked(prettier.resolveConfig).mockResolvedValue({ semi: true });
    vi.mocked(prettier.format).mockResolvedValue("const x = 1;");

    await formatFileInPlace(filePath);

    expect(prettier.format).toHaveBeenCalledWith(
      content,
      expect.objectContaining({ filepath: absolutePath }),
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      absolutePath,
      "const x = 1;",
      "utf-8",
    );
  });

  it("uses Pint for PHP files when vendor/bin/pint exists", async () => {
    const filePath = "test.php";
    vi.mocked(fs.pathExists).mockImplementation(
      async (p) => p === "./vendor/bin/pint",
    );

    await formatFileInPlace(filePath);

    expect(execa).toHaveBeenCalledWith("./vendor/bin/pint", [filePath]);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(prettier.format).not.toHaveBeenCalled();
  });

  it("falls back to Prettier for PHP files when Pint is missing", async () => {
    const content = "<?php echo 'hi';";
    const filePath = "test.php";
    const absolutePath = path.resolve(filePath);
    vi.mocked(fs.pathExists).mockResolvedValue(false); // Pint missing
    vi.mocked(fs.readFile).mockResolvedValue(content);
    vi.mocked(prettier.format).mockResolvedValue("<?php\n\necho 'hi';");
    await formatFileInPlace(filePath);
    expect(prettier.format).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(
      absolutePath,
      "<?php\n\necho 'hi';",
      "utf-8",
    );
  });

  it("uses Gradle formatting for Kotlin files", async () => {
    const filePath = "src/Main.kt";

    await formatFileInPlace(filePath);

    expect(formatKotlinFileInPlace).toHaveBeenCalledWith(filePath);
    expect(prettier.format).not.toHaveBeenCalled();
  });

  it("uses Gradle formatting for Kotlin script files", async () => {
    const filePath = "build.gradle.kts";

    await formatFileInPlace(filePath);

    expect(formatKotlinFileInPlace).toHaveBeenCalledWith(filePath);
    expect(prettier.format).not.toHaveBeenCalled();
  });
});
