import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveWorkspace,
  type ResolvedWorkspace,
} from "../../utils/workspace";
import { execa } from "execa";
import { getIgnorePatterns } from "../../core/config";
import { filterEligibleLsEntries } from "./proxy-ls";

vi.mock("execa", () => ({
  execa: vi.fn().mockRejectedValue(new Error("not ignored")),
}));
vi.mock("../../core/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../core/config")>()),
  getIgnorePatterns: vi
    .fn()
    .mockResolvedValue(["ignored-dir/", "*.log", "!keep.log"]),
}));

describe("filterEligibleLsEntries", () => {
  let base: string;
  let root: string;
  let workspace: ResolvedWorkspace;

  beforeEach(async () => {
    base = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "spekta-ls-")),
    );
    root = path.join(base, "workspace");
    const outside = path.join(base, "outside");
    for (const dir of [
      "src",
      "ignored-dir",
      "sub/ignored-dir",
      "names",
      "empty",
    ]) {
      fs.ensureDirSync(path.join(root, dir));
    }
    fs.ensureDirSync(outside);
    for (const file of [
      "visible.txt",
      "keep.log",
      "secret.log",
      ".env",
      "sub/inner.txt",
      "sub/nested.log",
      "src/index.ts",
    ]) {
      fs.writeFileSync(path.join(root, file), "x");
    }
    for (const name of [
      "with space.txt",
      "tab\tname.txt",
      "back\\slash.txt",
      "new\nline.txt",
      "日.txt",
    ]) {
      fs.writeFileSync(path.join(root, "names", name), "x");
    }
    fs.symlinkSync(outside, path.join(root, "escape"), "dir");
    fs.symlinkSync(
      path.join(root, ".env"),
      path.join(root, "restricted-alias"),
    );
    fs.symlinkSync(path.join(root, "visible.txt"), path.join(root, "alias-ok"));
    fs.symlinkSync(path.join(root, "missing"), path.join(root, "dangling"));
    fs.ensureDirSync(path.join(root, ".gitignore"));
    fs.writeFileSync(path.join(root, ".gitignore", "inner.txt"), "x");
    fs.symlinkSync(
      path.join(root, ".gitignore", "inner.txt"),
      path.join(root, "via-dir"),
    );
    workspace = await resolveWorkspace({ root });
  });

  afterEach(() => {
    fs.removeSync(base);
  });

  it("keeps only eligible entries and drops denied ones silently", async () => {
    const stdout =
      [
        ".env",
        "alias-ok",
        "dangling",
        "empty",
        "escape",
        "ignored-dir",
        "keep.log",
        "names",
        "restricted-alias",
        "secret.log",
        "src",
        "sub",
        "visible.txt",
      ].join("\n") + "\n";

    const result = await filterEligibleLsEntries(stdout, ".", workspace);

    expect(result).toEqual({
      status: "success",
      names: [
        "alias-ok",
        "empty",
        "keep.log",
        "names",
        "src",
        "sub",
        "visible.txt",
      ],
    });
  });

  it("does not disclose denied names in any returned field", async () => {
    const stdout =
      ".env\nescape\nignored-dir\nrestricted-alias\nsecret.log\nvisible.txt\n";

    const result = await filterEligibleLsEntries(stdout, ".", workspace);

    expect(JSON.stringify(result)).not.toMatch(
      /\.env|escape|ignored-dir|restricted-alias|secret/,
    );
  });

  it("filters relative to a nested directory operand", async () => {
    const stdout = "ignored-dir\ninner.txt\nnested.log\n";

    const result = await filterEligibleLsEntries(stdout, "sub", workspace);

    expect(result).toEqual({ status: "success", names: ["inner.txt"] });
  });

  it("drops aliases whose canonical path passes through a restricted segment", async () => {
    const result = await filterEligibleLsEntries(
      "via-dir\nvisible.txt\n",
      ".",
      workspace,
    );

    expect(result).toEqual({ status: "success", names: ["visible.txt"] });
  });

  it("decodes ls -b escapes for spaces, tabs, backslashes, newlines, and octal bytes", async () => {
    const stdout =
      [
        "with\\ space.txt",
        "tab\\tname.txt",
        "back\\\\slash.txt",
        "new\\nline.txt",
        "\\346\\227\\245.txt",
      ].join("\n") + "\n";

    const result = await filterEligibleLsEntries(stdout, "names", workspace);

    expect(result).toEqual({
      status: "success",
      names: [
        "with space.txt",
        "tab\tname.txt",
        "back\\slash.txt",
        "new\nline.txt",
        "日.txt",
      ],
    });
  });

  it("drops files that Git ignores but keeps their eligible siblings", async () => {
    fs.writeFileSync(path.join(root, "git-ignored.txt"), "x");
    vi.mocked(execa).mockImplementation(((
      _file: string,
      args: string[],
    ) => {
      if (args[args.length - 1] === "git-ignored.txt") {
        return { exitCode: 0 };
      }
      throw Object.assign(new Error("not ignored"), { exitCode: 1 });
    }) as never);

    try {
      const result = await filterEligibleLsEntries(
        "git-ignored.txt\nvisible.txt\n",
        ".",
        workspace,
      );

      expect(result).toEqual({ status: "success", names: ["visible.txt"] });
    } finally {
      vi.mocked(execa).mockRejectedValue(new Error("not ignored"));
    }
  });

  it("fails closed without disclosure when ignore patterns cannot be loaded", async () => {
    vi.mocked(getIgnorePatterns).mockRejectedValueOnce(
      new Error("EISDIR: .spektaignore"),
    );

    const result = await filterEligibleLsEntries(
      "visible.txt\n",
      ".",
      workspace,
    );

    expect(result).toEqual({
      status: "ambiguous",
      message: "Listing rejected: directory entries could not be attributed reliably.",
    });
    expect(JSON.stringify(result)).not.toContain("visible");
    expect(JSON.stringify(result)).not.toContain("EISDIR");
  });

  it("returns an empty listing for an empty directory", async () => {
    const result = await filterEligibleLsEntries("", "empty", workspace);

    expect(result).toEqual({ status: "success", names: [] });
  });

  it("rejects unsupported escape sequences without echoing the name", async () => {
    const result = await filterEligibleLsEntries(
      "visible.txt\nbad\\qname\n",
      ".",
      workspace,
    );

    expect(result).toEqual({
      status: "ambiguous",
      message: "Listing rejected: directory entries could not be attributed reliably.",
    });
    expect(JSON.stringify(result)).not.toContain("bad");
  });

  it("rejects names that the directory does not contain", async () => {
    const result = await filterEligibleLsEntries(
      "visible.txt\nnot-there.txt\n",
      ".",
      workspace,
    );

    expect(result).toEqual({
      status: "ambiguous",
      message: "Listing rejected: directory entries could not be attributed reliably.",
    });
    expect(JSON.stringify(result)).not.toContain("not-there");
  });

  it("rejects decorated representations instead of guessing", async () => {
    const result = await filterEligibleLsEntries(
      "src/\nvisible.txt  4B\n",
      ".",
      workspace,
    );

    expect(result).toEqual({
      status: "ambiguous",
      message: "Listing rejected: directory entries could not be attributed reliably.",
    });
  });
});
