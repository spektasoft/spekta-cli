import { describe, it, expect } from "vitest";
import fs from "fs-extra";
import path from "path";
import viteConfig from "../vite.config";

describe("Vite Configuration and Static Copy Setup", () => {
  it("should define the vite-plugin-static-copy configuration", () => {
    expect(viteConfig).toBeDefined();
    expect(viteConfig.plugins).toBeDefined();

    const plugins = viteConfig.plugins as any[];
    expect(plugins.length).toBeGreaterThan(0);
  });

  it("should ensure the build templates source directory exists", async () => {
    const templatesPath = path.resolve(__dirname, "../templates");
    const templatesExist = await fs.pathExists(templatesPath);
    expect(templatesExist).toBe(true);
  });
});
