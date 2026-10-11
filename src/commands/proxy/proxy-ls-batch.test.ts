import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../../utils/read-utils";
import type { WorkspaceContext } from "../../utils/workspace";
import { getListBatchOutcome, resolveListAllowance } from "./proxy-ls-batch";

describe("getListBatchOutcome", () => {
  let base: string;
  let root: string;
  let outside: string;
  let workspace: WorkspaceContext;

  beforeEach(() => {
    base = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "spekta-ls-batch-")),
    );
    root = path.join(base, "workspace");
    outside = path.join(base, "outside");
    fs.ensureDirSync(root);
    fs.ensureDirSync(outside);
    for (const dir of ["one", "two", "empty", ".env", "huge", "short"]) {
      fs.ensureDirSync(path.join(root, dir));
    }
    fs.writeFileSync(path.join(root, ".env", "nested"), "secret");
    workspace = { root };
  });

  afterEach(() => fs.removeSync(base));

  const options = (
    runLs: (operand: string) => Promise<{ stdout: string; exitCode: number }>,
    allowance = 1000,
  ) => ({
    allowance,
    increaseHint: "",
    runLs,
  });

  it("uses the default root operand and lists two valid directories independently", async () => {
    fs.writeFileSync(path.join(root, "root.txt"), "x");
    fs.writeFileSync(path.join(root, "one", "a.txt"), "x");
    fs.writeFileSync(path.join(root, "two", "b.txt"), "x");
    const runLs = vi.fn((operand: string) =>
      Promise.resolve({
        stdout:
          (operand === "."
            ? "root.txt"
            : operand === "one"
              ? "a.txt"
              : "b.txt") + "\n",
        exitCode: 0,
      }),
    );
    const defaultResult = await getListBatchOutcome(
      [],
      workspace,
      options(runLs),
    );
    expect(defaultResult.status).toBe("success");
    if (defaultResult.status !== "success") throw new Error("expected success");
    expect(defaultResult.content).toContain('Operand 1: returned; "."');

    const result = await getListBatchOutcome(
      ["one", "two"],
      workspace,
      options(runLs),
    );
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    expect(result.content).toContain('Operand 1: returned; "one"\n"a.txt"');
    expect(result.content).toContain('Operand 2: returned; "two"\n"b.txt"');
  });

  it("keeps valid operands while rendering missing, denied, and outside operands opaquely", async () => {
    fs.writeFileSync(path.join(root, "one", "visible.txt"), "x");
    fs.symlinkSync(outside, path.join(root, "escape"), "dir");
    const result = await getListBatchOutcome(
      ["missing-secret-name", "one", ".env", "escape"],
      workspace,
      options(() => Promise.resolve({ stdout: "visible.txt\n", exitCode: 0 })),
    );
    expect(result.status).toBe("partial_result");
    if (result.status !== "partial_result")
      throw new Error("expected partial result");
    expect(result.content).toContain(
      "Operand 1: unavailable; unavailable_access",
    );
    expect(result.content).not.toContain("missing-secret-name");
    expect(result.content).toContain('Operand 2: returned; "one"');
    expect(result.content).toContain(
      "Operand 3: unavailable; unavailable_access",
    );
    expect(result.content).toContain(
      "Operand 4: unavailable; unavailable_access",
    );
  });

  it("describes an empty eligible listing without exposing ignored names", async () => {
    fs.writeFileSync(path.join(root, "empty", "hidden.txt"), "secret");
    fs.writeFileSync(path.join(root, ".spektaignore"), "hidden.txt\n");
    const result = await getListBatchOutcome(
      ["empty"],
      workspace,
      options(() => Promise.resolve({ stdout: "hidden.txt\n", exitCode: 0 })),
    );
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    expect(result.content).toContain("No eligible entries in this listing.");
    expect(result.content).not.toContain("hidden.txt");
  });

  it("handles long names as whole entries and marks the listing incomplete", async () => {
    const names = Array.from(
      { length: 8 },
      (_, index) => `${"long".repeat(45)}${index}.txt`,
    );
    names.forEach((name) =>
      fs.writeFileSync(path.join(root, "huge", name), "x"),
    );
    const result = await getListBatchOutcome(
      ["huge"],
      workspace,
      options(
        () => Promise.resolve({ stdout: names.join("\n") + "\n", exitCode: 0 }),
        300,
      ),
    );
    expect(result.status).toBe("partial_result");
    if (result.status !== "partial_result")
      throw new Error("expected partial result");
    expect(result.truncated).toBe(true);
    expect(result.content).toContain(
      "Operand 1: incomplete; output_limit_exceeded",
    );
    expect(
      result.content.split("\n").filter((line) => line.startsWith('"long'))
        .length,
    ).toBeLessThan(names.length);
    expect(result.content).toContain(
      "Listing incomplete. List a narrower directory.",
    );
  });

  it("renders a valid, missing, and incomplete operand together", async () => {
    const names = Array.from(
      { length: 40 },
      (_, index) => `mixed-${index}-abcdef0123456789.txt`,
    );
    names.forEach((name) =>
      fs.writeFileSync(path.join(root, "huge", name), "x"),
    );
    const result = await getListBatchOutcome(
      ["missing-private-name", "huge"],
      workspace,
      options(
        () => Promise.resolve({ stdout: `${names.join("\n")}\n`, exitCode: 0 }),
        320,
      ),
    );
    expect(result.status).toBe("partial_result");
    if (result.status !== "partial_result")
      throw new Error("expected partial result");
    expect(result.content).toContain(
      "Operand 1: unavailable; unavailable_access",
    );
    expect(result.content).not.toContain("missing-private-name");
    expect(result.content).toContain(
      'Operand 2: incomplete; output_limit_exceeded; "huge"',
    );
    expect(result.content).toContain('"mixed-0-abcdef0123456789.txt"');
    expect(result.content).toContain(
      "Listing incomplete. List a narrower directory.",
    );
  });

  it("keeps duplicate operands as independent slots and retains duplicate names", async () => {
    fs.writeFileSync(path.join(root, "one", "same.txt"), "x");
    const result = await getListBatchOutcome(
      ["one", "one"],
      workspace,
      options(() =>
        Promise.resolve({ stdout: "same.txt\nsame.txt\n", exitCode: 0 }),
      ),
    );
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    expect(result.content.match(/"same.txt"/g)).toHaveLength(4);
    expect(result.operands).toHaveLength(2);
  });

  it("uses token boundaries, rejects metadata-only overflow before enumeration, and redistributes capacity", async () => {
    const boundaryNames = Array.from(
      { length: 24 },
      (_, index) => `boundary-${index}-abcdef.txt`,
    );
    boundaryNames.forEach((name) =>
      fs.writeFileSync(path.join(root, "short", name), "x"),
    );
    const runLs = vi.fn(() =>
      Promise.resolve({
        stdout: `${boundaryNames.join("\n")}\n`,
        exitCode: 0,
      }),
    );
    const complete = await getListBatchOutcome(
      ["short"],
      workspace,
      options(runLs, 10000),
    );
    if (complete.status === "failure") throw new Error("expected listing");
    expect(complete.truncated).toBe(false);
    const exact: number = Number(getTokenCount(complete.content));
    const atBoundary = await getListBatchOutcome(
      ["short"],
      workspace,
      options(runLs, exact),
    );
    expect(atBoundary.status).not.toBe("failure");
    if (atBoundary.status === "failure") throw new Error("expected listing");
    expect(atBoundary.truncated).toBe(false);
    const below = await getListBatchOutcome(
      ["short"],
      workspace,
      options(runLs, exact - 1),
    );
    expect(below.status).toBe("partial_result");
    if (below.status !== "partial_result")
      throw new Error("expected partial result");
    expect(below.truncated).toBe(true);

    const neverRun = vi.fn(() => Promise.resolve({ stdout: "", exitCode: 0 }));
    const overflow = await getListBatchOutcome(
      ["one", "two"],
      workspace,
      options(neverRun, 1),
    );
    expect(overflow.status).toBe("failure");
    expect(neverRun).not.toHaveBeenCalled();

    const many = Array.from(
      { length: 80 },
      (_, index) => `entry-${index}-abcdef0123456789.txt`,
    );
    many.forEach((name) =>
      fs.writeFileSync(path.join(root, "huge", name), "x"),
    );
    fs.writeFileSync(path.join(root, "two", "b"), "x");
    const fair = await getListBatchOutcome(
      ["huge", "two"],
      workspace,
      options(
        (operand) =>
          Promise.resolve({
            stdout: operand === "huge" ? `${many.join("\n")}\n` : "b\n",
            exitCode: 0,
          }),
        400,
      ),
    );
    expect(fair.status).not.toBe("failure");
    if (fair.status !== "failure")
      expect(fair.content).toContain('Operand 2: returned; "two"');

    fs.writeFileSync(path.join(root, "one", "single.txt"), "x");
    const redistributed = await getListBatchOutcome(
      ["one", "huge"],
      workspace,
      options(
        (operand) =>
          Promise.resolve({
            stdout: operand === "one" ? "single.txt\n" : `${many.join("\n")}\n`,
            exitCode: 0,
          }),
        320,
      ),
    );
    expect(redistributed.status).toBe("partial_result");
    if (redistributed.status !== "partial_result")
      throw new Error("expected partial result");
    expect(redistributed.content).toContain('Operand 1: returned; "one"');
    expect(redistributed.content).toContain(
      'Operand 2: incomplete; output_limit_exceeded; "huge"',
    );
  }, 15000);
});

describe("resolveListAllowance", () => {
  it("returns the default and safe invalid or over-ceiling failures", () => {
    expect(resolveListAllowance(undefined).allowance).toBe(1000);
    expect(resolveListAllowance("bad").failure?.message).toMatch(
      /^usage_error: Allowance/,
    );
    expect(resolveListAllowance(8001).failure?.message).toContain(
      "list fewer directories.",
    );
  });
});
