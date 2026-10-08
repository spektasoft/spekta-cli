import { execa } from "execa";
import fs from "fs-extra";
import path from "node:path";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { getIgnorePatterns } from "../core/config";
import {
  findExistingAncestor,
  validateParentDirForCreate,
  validatePathAccessForWrite,
} from "./security";
import { resolveWorkspaceMutationTarget } from "./workspace";

vi.mock("fs-extra", () => ({
  default: {
    stat: vi.fn(),
    pathExists: vi.fn(),
    realpath: vi.fn(),
    ensureDir: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockStat = fs.stat as unknown as Mock;
const mockPathExists = fs.pathExists as unknown as Mock;
const mockRealpath = fs.realpath as unknown as Mock;
const mockEnsureDir = fs.ensureDir as unknown as Mock;
const mockRemove = fs.remove as unknown as Mock;

type MockStatOptions = {
  size?: number;
  isFile?: () => boolean;
  isDirectory?: () => boolean;
};

const createMockStat = (opts: MockStatOptions = {}): fs.Stats =>
  ({
    size: opts.size ?? 0,
    isFile: opts.isFile ?? (() => false),
    isDirectory: opts.isDirectory ?? (() => false),
  }) as unknown as fs.Stats;

const createMockExecaResult = (
  stdout = "",
): Awaited<ReturnType<typeof execa>> =>
  ({ stdout }) as unknown as Awaited<ReturnType<typeof execa>>;

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../core/config", () => ({
  getIgnorePatterns: vi.fn(),
}));

vi.mock("./workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace")>();
  return {
    ...actual,
    resolveWorkspace: vi.fn(() => ({
      root: process.cwd(),
      canonicalRoot: process.cwd(),
    })),
    resolveWorkspaceMutationTarget: vi.fn(
      (target: string, workspace: { root: string; canonicalRoot: string }) => {
        const absolutePath = path.resolve(workspace.root, target);
        if (
          !actual.isPathWithin(workspace.root, absolutePath) &&
          !actual.isPathWithin(workspace.canonicalRoot, absolutePath)
        ) {
          throw new Error(
            `Access Denied: ${target} is outside the project directory.`,
          );
        }
        return { absolutePath, canonicalPath: absolutePath };
      },
    ),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getIgnorePatterns).mockResolvedValue([]);
});

describe("validatePathAccessForWrite", () => {
  it("should deny write to path outside project root", async () => {
    await expect(
      validatePathAccessForWrite("../outside-file.txt"),
    ).rejects.toThrow(
      "Access Denied: ../outside-file.txt is outside the project directory.",
    );

    await expect(validatePathAccessForWrite("/etc/passwd")).rejects.toThrow(
      "Access Denied: /etc/passwd is outside the project directory.",
    );
  });

  it("should deny write to gitignored path via git check-ignore", async () => {
    vi.mocked(execa).mockResolvedValue(
      createMockExecaResult("ignored-new-file.txt"),
    );

    await expect(
      validatePathAccessForWrite("ignored-new-file.txt"),
    ).rejects.toThrow(
      "Access Denied: ignored-new-file.txt would be ignored by git.",
    );
  });

  it("checks ignore policy on the canonical destination as well as its requested alias", async () => {
    vi.mocked(resolveWorkspaceMutationTarget).mockResolvedValueOnce({
      absolutePath: path.join(process.cwd(), "alias", "new.txt"),
      canonicalPath: path.join(process.cwd(), "ignored-new-file.txt"),
    });
    vi.mocked(execa)
      .mockRejectedValueOnce({ exitCode: 1 })
      .mockResolvedValueOnce(createMockExecaResult("ignored-new-file.txt"));

    await expect(validatePathAccessForWrite("alias/new.txt")).rejects.toThrow(
      "would be ignored by git",
    );
    expect(execa).toHaveBeenNthCalledWith(
      2,
      "git",
      ["check-ignore", "-q", "--", "ignored-new-file.txt"],
      { cwd: process.cwd() },
    );
  });

  it("checks restricted path segments on the canonical destination", async () => {
    vi.mocked(resolveWorkspaceMutationTarget).mockResolvedValueOnce({
      absolutePath: path.join(process.cwd(), "alias", "new.txt"),
      canonicalPath: path.join(process.cwd(), ".env", "new.txt"),
    });

    await expect(validatePathAccessForWrite("alias/new.txt")).rejects.toThrow(
      /restricted path segment/,
    );
  });
});

describe("validateParentDirForCreate", () => {
  const testDir = path.join(process.cwd(), "test-temp-validate");

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureDir.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
  });

  it("should permit write to new file in git repository", async () => {
    mockPathExists.mockResolvedValue(true);
    mockStat.mockResolvedValue(
      createMockStat({
        isFile: () => false,
        isDirectory: () => true,
      }),
    );
    mockRealpath.mockResolvedValue(path.resolve(process.cwd(), "src"));
    vi.mocked(execa).mockResolvedValue(createMockExecaResult("true"));

    await expect(
      validateParentDirForCreate("src/new-feature.ts"),
    ).resolves.not.toThrow();
  });

  it("should deny write to new file outside git repository", async () => {
    mockPathExists.mockResolvedValue(true);
    mockStat.mockResolvedValue(
      createMockStat({
        isFile: () => false,
        isDirectory: () => true,
      }),
    );
    mockRealpath.mockResolvedValue(path.resolve(process.cwd(), "src"));
    vi.mocked(execa).mockRejectedValue(new Error());

    await expect(
      validateParentDirForCreate("src/new-feature.ts"),
    ).rejects.toThrow("Not in a git repository. Real ancestor directory:");
  });

  it("should allow creation in nested non-existent directories", async () => {
    const targetFile = path.join(testDir, "new", "nested", "file.ts");

    mockPathExists.mockImplementation((p: string) =>
      Promise.resolve(p === testDir),
    );
    mockStat.mockResolvedValue(
      createMockStat({
        isFile: () => false,
        isDirectory: () => true,
      }),
    );
    mockRealpath.mockResolvedValue(testDir);
    vi.mocked(execa).mockResolvedValue(createMockExecaResult("true"));

    await expect(validateParentDirForCreate(targetFile)).resolves.not.toThrow();
  });

  it("should reject paths outside project root", async () => {
    const outsidePath = path.join(process.cwd(), "..", "outside", "file.ts");

    await expect(validateParentDirForCreate(outsidePath)).rejects.toThrow(
      "outside project root",
    );
  });

  it("rejects symlink ancestor pointing outside project root", async () => {
    const targetFile = path.join(testDir, "symlink-dir", "file.txt");

    mockPathExists.mockImplementation((p: string) =>
      Promise.resolve(p === testDir),
    );
    mockStat.mockResolvedValue(
      createMockStat({
        isFile: () => false,
        isDirectory: () => true,
      }),
    );
    mockRealpath.mockResolvedValue("/outside/dangerous");
    vi.mocked(execa).mockResolvedValue(createMockExecaResult("true"));

    await expect(validateParentDirForCreate(targetFile)).rejects.toThrow(
      /Real path of ancestor.*outside project root/,
    );
  });

  it("rejects creation under restricted directory name", async () => {
    const targetFile = path.join(testDir, ".env", "secrets", "newfile.txt");

    mockPathExists.mockResolvedValue(true);
    mockStat.mockResolvedValue(
      createMockStat({
        isFile: () => false,
        isDirectory: () => true,
      }),
    );
    mockRealpath.mockResolvedValue(testDir);
    vi.mocked(execa).mockResolvedValue(createMockExecaResult("true"));

    await expect(validateParentDirForCreate(targetFile)).rejects.toThrow(
      /Cannot create.*restricted path segment/,
    );
  });
});

describe("findExistingAncestor", () => {
  const testDir = path.join(process.cwd(), "test-temp-ancestor");
  const existingPath = path.join(testDir, "existing");

  beforeEach(() => {
    mockEnsureDir.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
  });

  it("should find existing parent when nested path does not exist", async () => {
    mockPathExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    mockStat
      .mockResolvedValueOnce(
        createMockStat({
          isFile: () => false,
          isDirectory: () => true,
        }),
      )
      .mockResolvedValueOnce(
        createMockStat({
          isFile: () => false,
          isDirectory: () => true,
        }),
      );

    const targetPath = path.join(testDir, "existing", "nested", "file.ts");
    const ancestor = await findExistingAncestor(path.dirname(targetPath));

    expect(ancestor).toBe(path.join(testDir, "existing"));
  });

  it("should return the directory itself if it exists", async () => {
    mockPathExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    mockStat.mockResolvedValueOnce(
      createMockStat({
        isFile: () => false,
        isDirectory: () => true,
      }),
    );

    const ancestor = await findExistingAncestor(existingPath);

    expect(ancestor).toBe(existingPath);
  });
});
