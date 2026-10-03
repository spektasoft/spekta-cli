import { vi, it, expect, describe, afterEach } from "vitest";
import { Logger } from "./logger";

describe("Logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps info and log on stdout", () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    Logger.info("test info");
    Logger.log("test log");
    expect(stdout).toHaveBeenCalledWith("[INFO] test info\n");
    expect(stdout).toHaveBeenCalledWith("test log\n");
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each([
    ["warn", "[WARN]"],
    ["error", "[ERROR]"],
  ] as const)(
    "writes %s and its formatted arguments to stderr only",
    (level, prefix) => {
      const stdout = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      const stderr = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      const failure = new Error("stack detail");
      Logger[level](
        "diagnostic",
        "text",
        123,
        { nested: { value: true } },
        failure,
      );
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledOnce();
      const output = String(stderr.mock.calls[0][0]);
      expect(output).toContain(`${prefix} diagnostic`);
      expect(output).toContain("text");
      expect(output).toContain("123");
      expect(output).toContain("nested");
      expect(output).toContain("stack detail");
      expect(output).toContain("at ");
      expect(output).not.toContain(`${String.fromCharCode(27)}[`);
    },
  );
});
