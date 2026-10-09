import fs from "fs-extra";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../../__tests__/workspace-fixture";
import { getRgOutcome } from "../grep-search";

let fixture: WorkspaceFixture;

beforeEach(async () => {
  await execa("rtk", ["proxy", "rg", "--version"]);
  fixture = await createWorkspaceFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("spekta rg case and glob behavior", () => {
  it("matches native ripgrep case mode and ordered glob filters", async () => {
    await fs.writeFile(
      path.join(fixture.root, "lower.txt"),
      "caseglobprobe lower\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "upper.txt"),
      "Caseglobprobe upper\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "excluded.txt"),
      "caseglobprobe hidden\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "other.md"),
      "caseglobprobe markdown\n",
    );

    const native = await execa(
      "rtk",
      [
        "proxy",
        "rg",
        "--no-config",
        "--ignore-case",
        "--case-sensitive",
        "--ignore-case",
        "--glob",
        "*.txt",
        "--glob",
        "!excluded.txt",
        "--json",
        "--regexp",
        "caseglobprobe",
        "--regexp",
        "unmatched",
        ".",
      ],
      { cwd: fixture.root },
    );
    const nativeFiles = new Set(
      native.stdout
        .split("\n")
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              type: string;
              data: { path?: { text: string } };
            },
        )
        .filter((event) => event.type === "match")
        .map((event) => event.data.path?.text),
    );

    const outcome = await getRgOutcome(
      {
        patterns: ["caseglobprobe", "unmatched"],
        paths: ["."],
        globs: ["*.txt", "!excluded.txt"],
        case_mode: "insensitive",
      },
      { root: fixture.root },
    );

    expect(outcome.status).toBe("success");
    expect(nativeFiles).toEqual(new Set(["./lower.txt", "./upper.txt"]));
    expect(outcome.status === "success" && outcome.value).toContain(
      "lower.txt",
    );
    expect(outcome.status === "success" && outcome.value).toContain(
      "upper.txt",
    );
    expect(outcome.status === "success" && outcome.value).not.toContain(
      "excluded.txt",
    );
    expect(outcome.status === "success" && outcome.value).not.toContain(
      "other.md",
    );
  });
});
