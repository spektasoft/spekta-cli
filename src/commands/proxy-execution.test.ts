import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { acceptedBranchRequests } from "./proxy-branch.test-fixtures";
import {
  executeRtkCommand,
  isRtkAvailable,
  prepareRtkInvocation,
} from "./proxy-execution";

describe("executeRtkCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes RTK once with the requested command", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "clean",
      stderr: "",
      exitCode: 0,
    } as never);

    await expect(executeRtkCommand("git", ["status"])).resolves.toEqual({
      available: true,
      stdout: "clean",
      stderr: "",
      exitCode: 0,
    });

    expect(execa).toHaveBeenCalledTimes(1);
    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["proxy", "git", "--no-pager", "--literal-pathspecs", "status"],
      expect.objectContaining({
        reject: false,
        env: expect.objectContaining({
          NO_COLOR: "1",
          TERM: "dumb",
        }) as Record<string, unknown>,
      }),
    );
  });

  it.each([
    ...acceptedBranchRequests.map((args) => ({ args, expected: [...args] })),
    {
      args: ["status", "--porcelain=v2", "--", "-file"],
      expected: ["status", "--porcelain=v2", "--", "-file"],
    },
    {
      args: ["log", "-p", "HEAD~1..HEAD"],
      expected: [
        "log",
        "--no-ext-diff",
        "--no-textconv",
        "-p",
        "HEAD~1..HEAD",
        "--",
      ],
    },
    {
      args: ["show"],
      expected: ["show", "--no-ext-diff", "--no-textconv", "--"],
    },
    {
      args: ["show", "HEAD:file.txt"],
      expected: [
        "show",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD:file.txt",
        "--",
      ],
    },
    {
      args: ["show", "--stat", "HEAD", "--", "file.txt"],
      expected: [
        "show",
        "--no-ext-diff",
        "--no-textconv",
        "--stat",
        "HEAD",
        "--",
        "file.txt",
      ],
    },
    ...[
      ["diff"],
      ["diff", "--cached"],
      ["diff", "--staged", "HEAD"],
      ["diff", "--stat", "HEAD~1", "HEAD"],
      ["diff", "HEAD~1..HEAD"],
      ["diff", "HEAD~1...HEAD"],
      ["diff", "--", "space name", "-file"],
      ["diff", "--cached", "HEAD", "--", "file.txt"],
      ["diff", "--"],
    ].map((args) => ({
      args,
      expected: [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--submodule=short",
        ...args.slice(1),
        ...(args.includes("--") ? [] : ["--"]),
      ],
    })),
  ])("preserves tokens and controls $args", async ({ args, expected }) => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "safe",
      stderr: "",
      exitCode: 0,
    } as never);
    const original = [...args];
    const oldGitPager = process.env.GIT_PAGER;
    const oldPager = process.env.PAGER;
    process.env.GIT_PAGER = "sentinel";
    process.env.PAGER = "sentinel";
    try {
      await executeRtkCommand("git", args);
      expect(args).toEqual(original);
      expect(execa).toHaveBeenCalledWith(
        "rtk",
        [
          "proxy",
          "git",
          "--no-pager",
          "--literal-pathspecs",
          ...(args[0] === "diff" ? ["-c", "diff.autoRefreshIndex=false"] : []),
          ...expected,
        ],
        expect.objectContaining({
          reject: false,
          cwd: process.cwd(),
          env: expect.objectContaining({
            GIT_PAGER: "cat",
            PAGER: "cat",
            NO_COLOR: "1",
            TERM: "dumb",
          }) as Record<string, unknown>,
        }),
      );
      expect(process.env.GIT_PAGER).toBe("sentinel");
      expect(process.env.PAGER).toBe("sentinel");
    } finally {
      if (oldGitPager === undefined) delete process.env.GIT_PAGER;
      else process.env.GIT_PAGER = oldGitPager;
      if (oldPager === undefined) delete process.env.PAGER;
      else process.env.PAGER = oldPager;
    }
  });

  it("disables optional locks only in the diff child environment", () => {
    const saved = process.env.GIT_OPTIONAL_LOCKS;
    process.env.GIT_OPTIONAL_LOCKS = "1";
    try {
      expect(prepareRtkInvocation("git", ["diff"]).env.GIT_OPTIONAL_LOCKS).toBe(
        "0",
      );
      expect(
        prepareRtkInvocation("git", ["diff", "--cached"]).env
          .GIT_OPTIONAL_LOCKS,
      ).toBe("0");
      expect(
        prepareRtkInvocation("git", ["status"]).env.GIT_OPTIONAL_LOCKS,
      ).toBe("1");
      expect(process.env.GIT_OPTIONAL_LOCKS).toBe("1");
    } finally {
      if (saved === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
      else process.env.GIT_OPTIONAL_LOCKS = saved;
    }
  });

  it("preserves the existing non-Git RTK route", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "listing",
      stderr: "",
      exitCode: 0,
    } as never);
    await executeRtkCommand("ls", ["src"]);
    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["ls", "src"],
      expect.objectContaining({ reject: false }),
    );
    expect(execa).toHaveBeenCalledWith("rtk", ["ls", "src"], {
      reject: false,
      env: expect.objectContaining({ NO_COLOR: "1", TERM: "dumb" }) as Record<
        string,
        unknown
      >,
    });
  });

  it("propagates unexpected subprocess launch failures", async () => {
    const failure = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    vi.mocked(execa).mockRejectedValueOnce(failure);
    await expect(executeRtkCommand("git", ["show"])).rejects.toBe(failure);
  });

  it("reports a missing RTK executable separately from command failure", async () => {
    vi.mocked(execa).mockRejectedValueOnce(
      Object.assign(new Error("not found"), { code: "ENOENT" }),
    );

    await expect(executeRtkCommand("git", ["status"])).resolves.toEqual({
      available: false,
    });
  });

  it("preserves non-zero RTK exits as available command results", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "",
      stderr: "failed",
      exitCode: 2,
    } as never);

    await expect(executeRtkCommand("git", ["test"])).resolves.toEqual({
      available: true,
      stdout: "",
      stderr: "failed",
      exitCode: 2,
    });
  });

  it("retains the compatibility availability check", async () => {
    vi.mocked(execa).mockResolvedValueOnce({} as never);

    await expect(isRtkAvailable()).resolves.toBe(true);
  });
});
