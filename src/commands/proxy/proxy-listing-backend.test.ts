import fs from "fs-extra";
import os from "node:os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveListingBackend,
  runNativeFindDiscovery,
  runNativeLsListing,
  workspaceDirectory,
} from "./proxy-listing-backend";

let root: string;
let workspace: string;

const sortedLines = (stdout: string): string[] =>
  stdout
    .split("\n")
    .filter((line) => line !== "")
    .sort();

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-listing-backend-"));
  workspace = path.join(root, "workspace");
  await fs.ensureDir(workspace);
});

afterEach(async () => {
  await fs.remove(root);
});

describe("resolveListingBackend", () => {
  it.skipIf(process.platform !== "win32")(
    "defaults Windows to the native backend and honors the rtk pin",
    () => {
      const savedOverride = process.env.SPEKTA_LISTING_BACKEND_OVERRIDE;
      try {
        delete process.env.SPEKTA_LISTING_BACKEND_OVERRIDE;
        expect(resolveListingBackend()).toBe("native");
        process.env.SPEKTA_LISTING_BACKEND_OVERRIDE = "rtk";
        expect(resolveListingBackend()).toBe("rtk");
        process.env.SPEKTA_LISTING_BACKEND_OVERRIDE = "native";
        expect(resolveListingBackend()).toBe("native");
      } finally {
        if (savedOverride === undefined)
          delete process.env.SPEKTA_LISTING_BACKEND_OVERRIDE;
        else
          process.env.SPEKTA_LISTING_BACKEND_OVERRIDE =
            savedOverride;
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps POSIX on the RTK/GNU backend",
    () => {
      process.env.SPEKTA_LISTING_BACKEND_OVERRIDE = "native";
      try {
        expect(resolveListingBackend()).toBe("rtk");
      } finally {
        delete process.env.SPEKTA_LISTING_BACKEND_OVERRIDE;
      }
    },
  );
});

describe("runNativeLsListing", () => {
  it("lists a spaced directory in name order with plain names", async () => {
    await fs.ensureDir(path.join(workspace, "space dir"));
    await fs.writeFile(path.join(workspace, ".hidden"), "x");
    await fs.writeFile(path.join(workspace, "zz last.txt"), "x");
    await fs.writeFile(path.join(workspace, "aa-first.ts"), "x");
    await fs.writeFile(path.join(workspace, "根 entry.md"), "x");

    const result = await runNativeLsListing(".", { root: workspace });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [".hidden", "aa-first.ts", "space dir", "zz last.txt", "根 entry.md"]
        .map((name) => `${name}\n`)
        .join(""),
    );
  });

  it("returns an empty listing for an empty directory", async () => {
    const result = await runNativeLsListing(".", { root: workspace });
    expect(result).toEqual({ stdout: "", exitCode: 0 });
  });

  it("fails closed for unreadable or missing operands", async () => {
    const missing = await runNativeLsListing("gone", { root: workspace });
    expect(missing).toEqual({ stdout: "", exitCode: 1 });
  });
});

describe("runNativeFindDiscovery", () => {
  it("walks contained spaced paths with GNU find lines and filters", async () => {
    await fs.ensureDir(path.join(workspace, "space dir", "deep"));
    await fs.writeFile(path.join(workspace, "a.ts"), "x");
    await fs.writeFile(path.join(workspace, ".dot.ts"), "x");
    await fs.writeFile(path.join(workspace, "note.md"), "x");
    await fs.writeFile(path.join(workspace, "space dir", "b.ts"), "x");
    await fs.writeFile(path.join(workspace, "space dir", "deep", "c.md"), "x");

    const everything = await runNativeFindDiscovery(".", [], { root: workspace });
    expect(everything.exitCode).toBe(0);
    // Traversal itself follows filesystem encounter order; the walk contract
    // is the GNU find line shape, not a cross-platform sort.
    expect(sortedLines(everything.stdout)).toEqual(
      [
        ".",
        "./.dot.ts",
        "./a.ts",
        "./note.md",
        "./space dir",
        "./space dir/b.ts",
        "./space dir/deep",
        "./space dir/deep/c.md",
      ].sort(),
    );
    // NTFS enumeration is already in name order, so Windows output is exact.
    if (process.platform === "win32") {
      expect(everything.stdout.split("\n")).toEqual([
        ".",
        "./.dot.ts",
        "./a.ts",
        "./note.md",
        "./space dir",
        "./space dir/b.ts",
        "./space dir/deep",
        "./space dir/deep/c.md",
        "",
      ]);
    }

    const files = await runNativeFindDiscovery(
      ".",
      ["-type", "f", "-name", "*.ts"],
      { root: workspace },
    );
    expect(files.stdout.split("\n")).toEqual([
      "./.dot.ts",
      "./a.ts",
      "./space dir/b.ts",
      "",
    ]);

    const directories = await runNativeFindDiscovery(
      "space dir",
      ["-type", "d"],
      { root: workspace },
    );
    expect(directories.stdout).toBe("space dir\nspace dir/deep\n");
  });

  it("matches GNU find -name semantics for the start point", async () => {
    await fs.ensureDir(path.join(workspace, "zsub"));
    await fs.writeFile(path.join(workspace, "zsub", "note.ts"), "x");

    const star = await runNativeFindDiscovery(".", ["-name", "*"], {
      root: workspace,
    });
    expect(sortedLines(star.stdout)).toEqual(
      [".", "./zsub", "./zsub/note.ts"].sort(),
    );

    const question = await runNativeFindDiscovery(".", ["-name", "?.dot"], {
      root: workspace,
    });
    expect(question.stdout).toBe("");

    const rootDot = await runNativeFindDiscovery(".", ["-name", "."], {
      root: workspace,
    });
    expect(rootDot.stdout).toBe(".\n");
  });

  it("supports negated and ranged character sets", async () => {
    await fs.ensureDir(path.join(workspace, "zsub"));
    await fs.writeFile(path.join(workspace, "a.ts"), "x");
    await fs.writeFile(path.join(workspace, ".dot"), "x");

    const negated = await runNativeFindDiscovery(".", ["-name", "[!a]*"], {
      root: workspace,
    });
    expect(sortedLines(negated.stdout)).toEqual(
      [".", "./.dot", "./zsub"].sort(),
    );

    const ranged = await runNativeFindDiscovery(".", ["-name", "[z-p]*"], {
      root: workspace,
    });
    expect(ranged.stdout).toBe("./zsub\n");
  });

  it("never traverses directory links, even if contained", async () => {
    const outside = path.join(root, "outside");
    await fs.ensureDir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "external");
    await fs.writeFile(path.join(workspace, "visible.ts"), "x");
    fs.symlinkSync(
      outside,
      path.join(workspace, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const discovered = await runNativeFindDiscovery(
      ".",
      ["-type", "f", "-name", "*.txt"],
      { root: workspace },
    );
    expect(discovered.stdout).toBe("");
    expect(discovered.stdout).not.toContain("secret");

    const untyped = await runNativeFindDiscovery(
      "escape",
      [],
      { root: workspace },
    );
    expect(untyped.stdout).toBe("escape\n");
  });

  it("rejects escaping or malformed operands before enumerating", async () => {
    const outsideRoot = path.join(root, "sibling");
    await fs.ensureDir(outsideRoot);
    await fs.writeFile(path.join(outsideRoot, "sibling.ts"), "x");

    const escaping = await runNativeFindDiscovery(
      "../outside",
      ["-type", "f"],
      { root: workspace },
    );
    expect(escaping).toEqual({ stdout: "", exitCode: 1 });

    const unknown = await runNativeFindDiscovery(".", ["-exec"], {
      root: workspace,
    });
    expect(unknown).toEqual({ stdout: "", exitCode: 1 });

    const danglingName = await runNativeFindDiscovery(
      ".",
      ["-name"],
      { root: workspace },
    );
    expect(danglingName).toEqual({ stdout: "", exitCode: 1 });
  });
});

describe("workspaceDirectory", () => {
  it("resolves the workspace root ahead of the caller cwd", () => {
    expect(path.isAbsolute(workspaceDirectory({ root: root }))).toBe(true);
    expect(workspaceDirectory()).toBe(path.resolve(process.cwd()));
  });
});
