import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeRtkCommand, prepareRtkInvocation } from "./proxy-execution";

vi.mock("execa", () => ({ execa: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(process, "cwd").mockReturnValue("/workspace");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("restricted find invocation", () => {
  it.each([
    { input: [], childArgs: ["."] },
    {
      input: ["-type", "f", "-name", "*.ts"],
      childArgs: [".", "-type", "f", "-name", "*.ts"],
    },
    {
      input: [".", "-type", "f", "-name", "*.ts"],
      childArgs: [".", "-type", "f", "-name", "*.ts"],
    },
    {
      input: ["space name", "-name", "file[0-9]?.ts", "-print"],
      childArgs: ["space name", "-name", "file[0-9]?.ts", "-print"],
    },
    {
      input: ["./-directory", "-name", "-exec"],
      childArgs: ["./-directory", "-name", "-exec"],
    },
  ])(
    "launches native find physically with input $input",
    async ({ input, childArgs }) => {
      const original = [...input];

      vi.mocked(execa).mockResolvedValueOnce({
        stdout: "./example.ts",
        stderr: "",
        exitCode: 0,
      } as never);

      const result = await executeRtkCommand("find", input);

      const expectedEnvironment = expect.objectContaining({
        NO_COLOR: "1",
        TERM: "dumb",
      }) as unknown as Record<string, unknown>;
      expect(execa).toHaveBeenCalledWith(
        "rtk",
        ["proxy", "find", "-P", ...childArgs],
        expect.objectContaining({
          reject: false,
          cwd: "/workspace",
          env: expectedEnvironment,
        }),
      );
      expect(result).toEqual({
        available: true,
        stdout: "./example.ts",
        stderr: "",
        exitCode: 0,
      });
      expect(input).toEqual(original);
    },
  );

  it("prepares find with an explicit cwd and preserves predicate values", () => {
    const input = ["-name", "../outside/*.ts"];
    const original = [...input];

    const invocation = prepareRtkInvocation("find", input);

    expect(invocation.args).toEqual([
      "proxy",
      "find",
      "-P",
      ".",
      "-name",
      "../outside/*.ts",
    ]);
    expect(invocation.cwd).toBe("/workspace");
    expect(input).toEqual(original);
  });
});
