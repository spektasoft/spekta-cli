import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { getEnv, resetInternalState } from "./env";

describe("Environment Loading", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-env-test");
  const tempHome = path.join(os.tmpdir(), "spekta-env-home");
  const originalCwd = process.cwd.bind(process);

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
      "QUOTED_VALUE",
      "MULTILINE_VALUE",
      "EMPTY_VALUE",
      "QUIET_VALUE",
    ];
    keysToClean.forEach((key) => delete process.env[key]);

    process.cwd = originalCwd;
    await fs.remove(tempTestDir);
    await fs.remove(tempHome);
    resetInternalState();
    vi.restoreAllMocks();
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

  it("preserves quoted, multiline, and empty values from environment files", async () => {
    await fs.writeFile(
      path.join(tempTestDir, ".env"),
      'QUOTED_VALUE="value with spaces"\nMULTILINE_VALUE="first line\nsecond line"\nEMPTY_VALUE=',
    );

    await getEnv();

    expect(process.env.QUOTED_VALUE).toBe("value with spaces");
    expect(process.env.MULTILINE_VALUE).toBe("first line\nsecond line");
    expect(process.env.EMPTY_VALUE).toBe("");
  });

  it("loads successfully when environment files are missing", async () => {
    await expect(getEnv()).resolves.toBe(process.env);
  });

  it("does not emit dotenv injection messages while loading", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await fs.writeFile(path.join(tempTestDir, ".env"), "QUIET_VALUE=loaded");

    await getEnv();

    expect(process.env.QUIET_VALUE).toBe("loaded");
    expect(logSpy).not.toHaveBeenCalled();
  });
});
