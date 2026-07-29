import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { getProviders } from "./providers";
import {
  HOME_PROVIDERS_USER,
  HOME_PROVIDERS_FREE,
  refreshPaths,
} from "./paths";
import { Provider } from "./types";
import { writeYaml } from "../../utils/yaml";

describe("Provider Merging Logic & Interface", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-providers-test");

  beforeEach(() => {
    fs.ensureDirSync(tempTestDir);
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    refreshPaths();
  });

  afterEach(() => {
    delete process.env.SPEKTA_HOME_OVERRIDE;
    fs.removeSync(tempTestDir);
    refreshPaths();
  });

  it("preserves duplicate model IDs with user providers first", async () => {
    const mockUser = {
      providers: [{ name: "User Model", model: "test/model" }],
    };
    const mockFree = {
      providers: [
        { name: "[Free] Free Model", model: "test/model" },
        { name: "[Free] Unique", model: "unique/free" },
      ],
    };

    await writeYaml(HOME_PROVIDERS_USER, mockUser);
    await writeYaml(HOME_PROVIDERS_FREE, mockFree);

    const result = await getProviders();

    expect(result.providers).toHaveLength(3);
    expect(result.providers[0].name).toBe("User Model");
    expect(result.providers[1].name).toBe("[Free] Free Model");
    expect(result.providers[2].name).toBe("[Free] Unique");
  });

  it("Provider type field is optional and defaults to undefined", () => {
    const p: Provider = { name: "Test", model: "some/model" };
    expect(p.type).toBeUndefined();
  });

  it("Provider accepts gemini type", () => {
    const p: Provider = {
      name: "Gemini",
      model: "gemini-2.0-flash",
      type: "gemini",
    };
    expect(p.type).toBe("gemini");
  });
});
