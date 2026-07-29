import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { getEnv, resetInternalState } from "./env";

describe("Environment Loading", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-env-test");
  const tempHome = path.join(os.tmpdir(), "spekta-env-home");
  const originalCwd = process.cwd;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetInternalState();
    await fs.ensureDir(tempTestDir);
    await fs.ensureDir(tempHome);
    process.env.SPEKTA_HOME_OVERRIDE = tempHome;
    process.cwd = () => tempTestDir;
  });

  afterEach(async () => {
    const keysToClean = [
      "TEST_VAR",
      "SPEKTA_HOME_OVERRIDE",
      "GLOBAL_ONLY",
      "LOCAL_ONLY",
      "SHARED",
      "TEST_GLOBAL_VAR",
      "TEST_LOCAL_VAR",
    ];
    keysToClean.forEach((key) => delete process.env[key]);

    process.cwd = originalCwd;
    await fs.remove(tempTestDir);
    await fs.remove(tempHome);
    resetInternalState();
  });

  it("should load global environment variables", async () => {
    await fs.writeFile(
      path.join(tempHome, ".env"),
      "TEST_GLOBAL_VAR=global_value",
    );

    await getEnv();

    expect(process.env.TEST_GLOBAL_VAR).toBe("global_value");
  });

  it("should prioritize Shell > Local > Global", async () => {
    await fs.writeFile(path.join(tempHome, ".env"), "TEST_VAR=global");
    await fs.writeFile(path.join(tempTestDir, ".env"), "TEST_VAR=local");
    process.env.TEST_VAR = "shell";

    await getEnv();

    expect(process.env.TEST_VAR).toBe("shell");

    resetInternalState();
    delete process.env.TEST_VAR;

    await getEnv();
    expect(process.env.TEST_VAR).toBe("local");

    resetInternalState();
    delete process.env.TEST_VAR;
    await fs.remove(path.join(tempTestDir, ".env"));

    await getEnv();
    expect(process.env.TEST_VAR).toBe("global");
  });

  it("should load both global and workspace variables when both exist", async () => {
    await fs.writeFile(
      path.join(tempHome, ".env"),
      "GLOBAL_ONLY=global_value\nSHARED=global",
    );

    await fs.writeFile(
      path.join(tempTestDir, ".env"),
      "LOCAL_ONLY=local_value\nSHARED=local",
    );

    await getEnv();

    expect(process.env.GLOBAL_ONLY).toBe("global_value");
    expect(process.env.LOCAL_ONLY).toBe("local_value");
    expect(process.env.SHARED).toBe("local");
  });
});
