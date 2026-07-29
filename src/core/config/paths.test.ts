import { describe, expect, it } from "vitest";
import {
  HOME_DIR,
  HOME_DEFAULT_IGNORE,
  HOME_PROVIDERS_USER,
  HOME_PROVIDERS_FREE,
  HOME_PROMPTS,
  HOME_IGNORE,
  HOME_TOOLS,
  refreshPaths,
} from "./paths";
import os from "os";
import path from "path";
import { vi } from "vitest";

describe("Asset Root Resolution & Paths", () => {
  it("should resolve correct default ignore path on refresh", () => {
    refreshPaths();
    expect(HOME_DEFAULT_IGNORE).toContain(".spektadefaultignore");
  });

  it("HOME_TOOLS points to ~/.spekta/tools by default", () => {
    expect(HOME_TOOLS).toContain(".spekta/tools");
  });

  it("refreshPaths updates HOME_TOOLS correctly", () => {
    const original = HOME_TOOLS;
    process.env.SPEKTA_HOME_OVERRIDE = "/custom/path";
    refreshPaths();
    expect(HOME_TOOLS).toBe("/custom/path/tools");
    delete process.env.SPEKTA_HOME_OVERRIDE;
    refreshPaths();
    expect(HOME_TOOLS).toBe(original);
  });

  it("should update provider paths when refreshPaths is called", () => {
    const originalProviderPath = HOME_PROVIDERS_USER;
    const customDir = path.join(os.tmpdir(), "manual-override");

    process.env.SPEKTA_HOME_OVERRIDE = customDir;
    refreshPaths();

    expect(HOME_PROVIDERS_USER).toBe(path.join(customDir, "providers.yaml"));
    expect(HOME_PROVIDERS_USER).not.toBe(originalProviderPath);

    delete process.env.SPEKTA_HOME_OVERRIDE;
    refreshPaths();
  });

  it("should update all HOME_* paths when SPEKTA_HOME_OVERRIDE is set", () => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        ...process.env,
        SPEKTA_HOME_OVERRIDE: "/custom/home/path",
      },
    });

    refreshPaths();

    expect(HOME_DIR).toBe("/custom/home/path");
    expect(HOME_PROVIDERS_USER).toBe("/custom/home/path/providers.yaml");
    expect(HOME_PROVIDERS_FREE).toBe("/custom/home/path/providers-free.yaml");
    expect(HOME_PROMPTS).toBe("/custom/home/path/prompts");
    expect(HOME_IGNORE).toBe("/custom/home/path/.spektaignore");
    expect(HOME_TOOLS).toBe("/custom/home/path/tools");
  });
});
