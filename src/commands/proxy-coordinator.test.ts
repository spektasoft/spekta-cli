import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./proxy-authorization", () => ({
  authorizeProxyCommand: vi.fn(),
}));

vi.mock("./proxy-execution", () => ({
  executeRtkCommand: vi.fn(),
}));

import { authorizeProxyCommand } from "./proxy-authorization";
import { executeRtkCommand } from "./proxy-execution";
import { runRtkProxy } from "./proxy";

describe("runRtkProxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not execute when authorization is denied", async () => {
    vi.mocked(authorizeProxyCommand).mockResolvedValueOnce(null);

    await runRtkProxy("git", ["reset"]);

    expect(executeRtkCommand).not.toHaveBeenCalled();
  });

  it("executes RTK without a preflight availability call", async () => {
    vi.mocked(authorizeProxyCommand).mockResolvedValueOnce(["status"]);
    vi.mocked(executeRtkCommand).mockResolvedValueOnce({
      available: true,
      stdout: "clean",
      stderr: "",
      exitCode: 0,
    });

    await runRtkProxy("git", ["status"]);

    expect(executeRtkCommand).toHaveBeenCalledWith("git", ["status"]);
    expect(executeRtkCommand).toHaveBeenCalledTimes(1);
  });

  it("prints the unavailable advisory when execution cannot spawn RTK", async () => {
    vi.mocked(authorizeProxyCommand).mockResolvedValueOnce(["status"]);
    vi.mocked(executeRtkCommand).mockResolvedValueOnce({
      available: false,
    });

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runRtkProxy("git", ["status"]);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("### spekta rtk unavailable"),
    );

    log.mockRestore();
  });
});
