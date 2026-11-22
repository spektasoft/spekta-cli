import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../utils/read-utils";
import {
  getWorkspaceReviewOutcome,
  runWorkspaceReview,
} from "./workspace-review";
import {
  missing,
  useRealGitFixture,
} from "./proxy/proxy-git.integration-harness";

describe.skipIf(missing.length > 0)("workspace review CLI", () => {
  const context = useRealGitFixture();

  it("separates staged and unstaged changes for one file and narrows source", async () => {
    const staged = await getWorkspaceReviewOutcome({
      source: "staged",
      allowance: 1000,
    });
    expect(staged.status).toBe("success");
    if (staged.status !== "success") return;
    expect(staged.content).toContain("Selected scope: staged.");
    expect(staged.content).toContain("+staged-copy");
    expect(staged.content).not.toContain("+unstaged-copy");

    const unstaged = await getWorkspaceReviewOutcome({
      source: "unstaged",
      allowance: 1000,
    });
    expect(unstaged.status).toBe("success");
    if (unstaged.status !== "success") return;
    expect(unstaged.content).toContain("Selected scope: unstaged.");
    expect(unstaged.content).toContain("+unstaged-copy");
    expect(unstaged.content).not.toContain("+staged-copy");
  });

  it("pages whole sections, detects changes to returned content, and keeps the CLI response bounded", async () => {
    for (let index = 0; index < 10; index++) {
      const name = `page-${index}.txt`;
      fs.writeFileSync(path.join(context.workspace, name), `before-${index}\n`);
      await context.fixtureGit(["add", "--", name]);
      await context.fixtureGit(["commit", "-m", `PAGE_${index}`, "--", name]);
      fs.writeFileSync(
        path.join(context.workspace, name),
        `after-${index}\n${"change line\n".repeat(12)}`,
      );
    }
    const first = await getWorkspaceReviewOutcome({
      source: "unstaged",
      allowance: 350,
    });
    expect(first.status, JSON.stringify(first)).toBe("success");
    if (first.status !== "success") return;
    expect(getTokenCount(first.content)).toBeLessThanOrEqual(350);
    expect(first.content).toContain("Complete: no");
    expect(first.content).toContain("Coverage: incomplete");
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      first.content,
    )?.[1];
    expect(continuation).toBeDefined();
    if (!continuation) return;
    const next = await getWorkspaceReviewOutcome({
      source: "unstaged",
      continuation,
      allowance: 350,
    });
    expect(next.status).toBe("success");
    if (next.status !== "success") return;
    expect(next.content).not.toContain(
      first.content.slice(first.content.indexOf("diff --git")),
    );

    fs.appendFileSync(
      path.join(context.workspace, "page-0.txt"),
      "changed after page one\n",
    );
    const restarted = await getWorkspaceReviewOutcome({
      source: "unstaged",
      continuation,
      allowance: 350,
    });
    expect(restarted.status).toBe("failure");
    if (restarted.status === "failure")
      expect(restarted.message).toContain("restart the review");

    vi.mocked(console.log).mockClear();
    await runWorkspaceReview(["--source", "staged", "--allowance", "1000"]);
    const cli = vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join("\n");
    expect(getTokenCount(`${cli}\n`)).toBeLessThanOrEqual(1000);
    expect(cli).toContain("Selected scope: staged.");
  });

  it("skips nested untracked repositories without failing the workspace review", async () => {
    const nestedRepo = path.join(context.workspace, "embedded-review-repo");
    fs.ensureDirSync(nestedRepo);
    await execa("git", ["init", "--quiet", "--template="], { cwd: nestedRepo });
    fs.writeFileSync(path.join(nestedRepo, "inner.txt"), "nested content\n");

    const result = await getWorkspaceReviewOutcome({
      source: "all",
      allowance: 1000,
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.content).not.toContain("embedded-review-repo");
      expect(result.content).not.toContain("nested content");
    }
  });

  it("includes a zero-byte untracked file in the review", async () => {
    const name = "empty-untracked-review.txt";
    fs.writeFileSync(path.join(context.workspace, name), "");
    const result = await getWorkspaceReviewOutcome({
      source: "untracked",
      allowance: 1000,
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.content).toContain(name);
      expect(result.content).toContain("(empty untracked file)");
    }
  });

  it("includes eligible untracked files in the default scope and supports an untracked-only CLI scope", async () => {
    const name = "new-untracked-review.txt";
    fs.writeFileSync(
      path.join(context.workspace, name),
      "untracked review content\n",
    );

    const all = await getWorkspaceReviewOutcome({
      source: "all",
      allowance: 1000,
    });
    expect(all.status).toBe("success");
    if (all.status !== "success") return;
    expect(all.content).toContain(
      "Selected scope: staged, unstaged, and untracked.",
    );
    expect(all.content).toContain("+staged-copy");
    expect(all.content).toContain("+unstaged-copy");
    expect(all.content).toContain(`## untracked section`);
    expect(all.content).toContain("untracked review content");

    vi.mocked(console.log).mockClear();
    await runWorkspaceReview(["--source", "untracked", "--allowance", "1000"]);
    const cli = vi
      .mocked(console.log)
      .mock.calls.map(([value]) => String(value))
      .join("\n");
    expect(cli).toContain("Selected scope: untracked.");
    expect(cli).toContain("untracked review content");
    expect(cli).not.toContain("+staged-copy");
    expect(cli).not.toContain("+unstaged-copy");
    expect(getTokenCount(`${cli}\n`)).toBeLessThanOrEqual(1000);
  });

  it("pages untracked text and invalidates continuation when an untracked file changes", async () => {
    const firstName = "a-untracked-page.txt";
    const secondName = "b-untracked-page.txt";
    const firstPath = path.join(context.workspace, firstName);
    fs.writeFileSync(
      firstPath,
      Array.from({ length: 40 }, (_, index) => `untracked-row-${index}`).join(
        "\n",
      ) + "\nghp_abcdefghijklmnopqrstuvwxyz",
    );
    fs.writeFileSync(
      path.join(context.workspace, secondName),
      "second untracked file\n",
    );

    const firstPage = await getWorkspaceReviewOutcome({
      source: "untracked",
      allowance: 250,
      ceiling: 8000,
    });
    expect(firstPage.status, JSON.stringify(firstPage)).toBe("success");
    if (firstPage.status !== "success") return;
    expect(firstPage.content).toContain("Complete: no");
    expect(firstPage.content).toContain("## untracked section");
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      firstPage.content,
    )?.[1];
    expect(continuation).toBeDefined();
    if (!continuation) return;

    const pages = [firstPage.content];
    let nextContinuation: string | undefined = continuation;
    for (let page = 0; page < 20 && nextContinuation; page++) {
      const next = await getWorkspaceReviewOutcome({
        source: "untracked",
        continuation: nextContinuation,
        allowance: 250,
        ceiling: 8000,
      });
      expect(next.status, JSON.stringify(next)).toBe("success");
      if (next.status !== "success") return;
      pages.push(next.content);
      nextContinuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
        next.content,
      )?.[1];
      if (next.content.includes("Complete: yes")) break;
    }
    const combined = pages.join("\n");
    expect(combined).toContain("Complete: yes");
    expect(combined).toContain("[REDACTED]");
    expect(combined).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    for (let index = 0; index < 40; index++) {
      expect(combined.split("\n")).toContain(`untracked-row-${index}`);
    }

    fs.appendFileSync(firstPath, "changed after page one\n");
    const changed = await getWorkspaceReviewOutcome({
      source: "untracked",
      continuation,
      allowance: 250,
      ceiling: 8000,
    });
    expect(changed.status).toBe("failure");
    if (changed.status === "failure")
      expect(changed.message).toContain("restart the review");

    const createPage = await getWorkspaceReviewOutcome({
      source: "untracked",
      allowance: 250,
      ceiling: 8000,
    });
    if (createPage.status !== "success") return;
    const createContinuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      createPage.content,
    )?.[1];
    expect(createContinuation).toBeDefined();
    fs.writeFileSync(
      path.join(context.workspace, "created-after-page.txt"),
      "new\n",
    );
    const created = await getWorkspaceReviewOutcome({
      source: "untracked",
      continuation: createContinuation,
      allowance: 250,
      ceiling: 8000,
    });
    expect(created.status).toBe("failure");

    const deletePage = await getWorkspaceReviewOutcome({
      source: "untracked",
      allowance: 250,
      ceiling: 8000,
    });
    if (deletePage.status !== "success") return;
    const deleteContinuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      deletePage.content,
    )?.[1];
    expect(deleteContinuation).toBeDefined();
    fs.unlinkSync(path.join(context.workspace, secondName));
    const deleted = await getWorkspaceReviewOutcome({
      source: "untracked",
      continuation: deleteContinuation,
      allowance: 250,
      ceiling: 8000,
    });
    expect(deleted.status).toBe("failure");
  });

  it("identifies untracked binary files without content and invalidates their continuation", async () => {
    const binaryPath = path.join(context.workspace, "a-review-binary.bin");
    fs.writeFileSync(
      binaryPath,
      Buffer.concat([Buffer.from([0]), Buffer.from("binary-secret-payload")]),
    );
    fs.writeFileSync(
      path.join(context.workspace, "z-review-long.txt"),
      Array.from({ length: 40 }, (_, index) => `binary-page-row-${index}`).join(
        "\n",
      ),
    );
    const first = await getWorkspaceReviewOutcome({
      source: "untracked",
      allowance: 300,
      ceiling: 8000,
    });
    expect(first.status).toBe("success");
    if (first.status !== "success") return;
    expect(first.content).toContain("eligible binary change(s)");
    expect(first.content).toContain(
      "Binary untracked file content is not displayed.",
    );
    expect(first.content).not.toContain("binary-secret-payload");
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      first.content,
    )?.[1];
    expect(continuation).toBeDefined();
    if (!continuation) return;
    fs.writeFileSync(
      binaryPath,
      Buffer.concat([Buffer.from([0]), Buffer.from("changed-secret-payload")]),
    );
    const stale = await getWorkspaceReviewOutcome({
      source: "untracked",
      continuation,
      allowance: 300,
      ceiling: 8000,
    });
    expect(stale.status).toBe("failure");
  });

  it("reports oversized eligible untracked files as unreviewed", async () => {
    const name = "oversized-untracked.txt";
    fs.writeFileSync(
      path.join(context.workspace, name),
      Buffer.alloc(10 * 1024 * 1024 + 1, 0x61),
    );
    const result = await getWorkspaceReviewOutcome({
      source: "untracked",
      allowance: 1000,
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.content).toContain("Coverage: incomplete");
    expect(result.content).toContain("oversized-untracked.txt");
    expect(result.content).toContain("content was not reviewed");
    expect(result.content).not.toContain("a".repeat(100));
  });

  it("requires a restart when oversized untracked content changes while being hashed", async () => {
    const name = "mutating-oversized-untracked.txt";
    const target = path.join(context.workspace, name);
    fs.writeFileSync(target, Buffer.alloc(10 * 1024 * 1024 + 1, 0x61));
    const originalCreateReadStream = fs.createReadStream.bind(fs);
    const createReadStreamSpy = vi
      .spyOn(fs, "createReadStream")
      .mockImplementation((filePath) => {
        const stream = originalCreateReadStream(filePath);
        if (path.resolve(String(filePath)) === target) {
          stream.once("open", () => fs.appendFileSync(target, "changed"));
        }
        return stream;
      });
    try {
      const result = await getWorkspaceReviewOutcome({
        source: "untracked",
        allowance: 1000,
      });
      expect(result.status).toBe("failure");
      if (result.status === "failure")
        expect(result.message).toContain("restart the review");
    } finally {
      createReadStreamSpy.mockRestore();
    }
  });
  it("does not name restricted or ignored untracked paths", async () => {
    const restricted = path.join(context.workspace, "private-dir", ".env");
    const ignoredName = "ignored-review-secret.txt";
    const spektaIgnoredName = "spekta-ignored-review-secret.txt";
    fs.ensureDirSync(path.dirname(restricted));
    fs.writeFileSync(restricted, "restricted-untracked-secret\n");
    fs.writeFileSync(
      path.join(context.workspace, ignoredName),
      "ignored-review-secret-payload\n",
    );
    fs.writeFileSync(
      path.join(context.workspace, spektaIgnoredName),
      "spekta-ignored-review-secret-payload\n",
    );
    fs.writeFileSync(
      path.join(context.workspace, "id_rsa"),
      "private-key-secret-payload\n",
    );
    fs.writeFileSync(
      path.join(context.workspace, ".gitignore"),
      `\n/${ignoredName}\n`,
    );
    fs.writeFileSync(
      path.join(context.workspace, ".spektaignore"),
      `\n/${spektaIgnoredName}\n`,
    );

    fs.writeFileSync(
      path.join(context.workspace, ".env"),
      "restricted-change\n",
    );
    if (process.platform !== "win32") {
      fs.symlinkSync(
        path.join(context.workspace, ".env"),
        path.join(context.workspace, "env-review-link"),
      );
      fs.symlinkSync(
        path.join(context.workspace, ignoredName),
        path.join(context.workspace, "ignored-review-link"),
      );
      const outsideTarget = path.join(
        path.dirname(context.workspace),
        "outside-review-target.txt",
      );
      fs.writeFileSync(outsideTarget, "outside-review-secret-payload\n");
      fs.symlinkSync(
        outsideTarget,
        path.join(context.workspace, "outside-review-link"),
      );
    }
    await context.fixtureGit(["add", "--", ".env"]);
    const result = await getWorkspaceReviewOutcome({
      source: "all",
      allowance: 1000,
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.content).not.toContain(".env");
    expect(result.content).not.toContain("private-dir");
    expect(result.content).not.toContain("restricted-untracked-secret");
    expect(result.content).not.toContain(ignoredName);
    expect(result.content).not.toContain("ignored-review-secret-payload");
    expect(result.content).not.toContain(spektaIgnoredName);
    expect(result.content).not.toContain(
      "spekta-ignored-review-secret-payload",
    );
    expect(result.content).not.toContain("id_rsa");
    expect(result.content).not.toContain("private-key-secret-payload");
    expect(result.content).not.toContain("env-review-link");
    expect(result.content).not.toContain("ignored-review-link");
    expect(result.content).not.toContain("outside-review-link");
    expect(result.content).not.toContain("outside-review-secret-payload");
  });

  it("conceals a tracked rename when either endpoint is restricted", async () => {
    const source = "rename-source.txt";
    fs.writeFileSync(path.join(context.workspace, source), "public content\n");
    await context.fixtureGit(["add", "--", source]);
    await context.fixtureGit(["commit", "-m", "RENAME_SOURCE", "--", source]);
    await context.fixtureGit(["mv", "--", source, ".gitignore"]);

    const result = await getWorkspaceReviewOutcome({
      source: "staged",
      allowance: 1000,
      ceiling: 8000,
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.content).not.toContain(source);
      expect(result.content).not.toContain(".gitignore");
    }
  });

  it("returns complete text sections across pages, including a large single-file patch", async () => {
    const name = "single-large-patch.txt";
    const target = path.join(context.workspace, name);
    fs.writeFileSync(target, "before\n");
    await context.fixtureGit(["add", "--", name]);
    await context.fixtureGit(["commit", "-m", "LARGE_PATCH_BASE", "--", name]);
    const rows = Array.from(
      { length: 80 },
      (_, index) => `review-row-${index}`,
    );
    fs.writeFileSync(target, `${rows.join("\n")}\n`);

    const pageTexts: string[] = [];
    let continuation: string | undefined;
    let previousCursor = { section: 0, line: 0 };
    for (let page = 0; page < 20; page++) {
      const outcome = await getWorkspaceReviewOutcome({
        source: "unstaged",
        continuation,
        allowance: 250,
        ceiling: 8000,
      });
      expect(outcome.status, JSON.stringify(outcome)).toBe("success");
      if (outcome.status !== "success") return;
      pageTexts.push(outcome.content);
      continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
        outcome.content,
      )?.[1];
      if (outcome.content.includes("Complete: yes")) break;
      expect(continuation).toBeDefined();
      if (!continuation) return;
      const [, section, line] = /[a-f0-9]{24}:(\d+):(\d+)/.exec(continuation)!;
      const nextCursor = { section: Number(section), line: Number(line) };
      expect(
        nextCursor.section > previousCursor.section ||
          (nextCursor.section === previousCursor.section &&
            nextCursor.line > previousCursor.line),
      ).toBe(true);
      previousCursor = nextCursor;
    }
    const combined = pageTexts.join("\n");
    expect(combined).toContain("Complete: yes");
    for (const row of rows) {
      expect(
        combined.split("\n").filter((line) => line === `+${row}`),
      ).toHaveLength(1);
    }
    expect(new Set(rows.map((row) => row)).size).toBe(80);
  });

  it("requires a higher allowance when the next line cannot advance the cursor", async () => {
    const name = "allowance-blocked-first-line.txt";
    const target = path.join(context.workspace, name);
    fs.writeFileSync(target, "before\n");
    await context.fixtureGit(["add", "--", name]);
    await context.fixtureGit([
      "commit",
      "-m",
      "ALLOWANCE_BLOCKED_BASE",
      "--",
      name,
    ]);
    fs.writeFileSync(
      target,
      `before\n${"oversized-but-eligible-line ".repeat(500)}\n`,
    );

    const firstPage = await getWorkspaceReviewOutcome({
      source: "unstaged",
      allowance: 500,
      ceiling: 8000,
    });
    expect(firstPage.status).toBe("success");
    if (firstPage.status !== "success") return;
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      firstPage.content,
    )?.[1];
    expect(continuation).toBeDefined();
    if (!continuation) return;

    const blocked = await getWorkspaceReviewOutcome({
      source: "unstaged",
      continuation,
      allowance: 250,
      ceiling: 8000,
    });

    expect(blocked.status).toBe("incomplete");
    if (blocked.status !== "incomplete") return;
    expect(blocked.content).toContain("Complete: no");
    expect(blocked.content).toContain("higher allowance");
    expect(blocked.content).toContain("Continuation: unavailable");
    expect(blocked.content).not.toMatch(/Continuation: [a-f0-9]{24}:\d+:\d+\./);

    const retried = await getWorkspaceReviewOutcome({
      source: "unstaged",
      continuation,
      allowance: 8000,
      ceiling: 8000,
    });
    expect(retried.status).toBe("success");
    if (retried.status === "success") {
      expect(retried.content).toContain("Complete: yes");
      expect(retried.content).toContain("+oversized-but-eligible-line");
    }
  });

  it("identifies binary changes without showing bytes and invalidates continuation when binary state changes", async () => {
    const textName = "aa-large-for-binary-state.txt";
    const textPath = path.join(context.workspace, textName);
    fs.writeFileSync(textPath, "before\n");
    await context.fixtureGit(["add", "--", textName]);
    await context.fixtureGit([
      "commit",
      "-m",
      "TEXT_STATE_BASE",
      "--",
      textName,
    ]);
    fs.writeFileSync(textPath, `${"text row\n".repeat(80)}`);

    const binaryName = "zz-review-image.bin";
    const binaryPath = path.join(context.workspace, binaryName);
    fs.writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3, 4]));
    await context.fixtureGit(["add", "--", binaryName]);
    await context.fixtureGit([
      "commit",
      "-m",
      "BINARY_STATE_BASE",
      "--",
      binaryName,
    ]);
    fs.writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3, 5]));

    const first = await getWorkspaceReviewOutcome({
      source: "unstaged",
      allowance: 300,
      ceiling: 8000,
    });
    expect(first.status, JSON.stringify(first)).toBe("success");
    if (first.status !== "success") return;
    expect(first.content).toContain("Coverage: incomplete");
    expect(first.content).toContain("binary");
    expect(first.content).not.toContain("GIT binary patch");
    expect(first.content).toContain("Complete: no");
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      first.content,
    )?.[1];
    expect(continuation).toBeDefined();
    if (!continuation) return;

    fs.writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3, 6]));
    const changed = await getWorkspaceReviewOutcome({
      source: "unstaged",
      continuation,
      allowance: 300,
      ceiling: 8000,
    });
    expect(changed.status).toBe("failure");
    if (changed.status === "failure")
      expect(changed.message).toContain("restart the review");
  });

  it("redacts secrets in the shared review output", async () => {
    const name = "credential-review.txt";
    const target = path.join(context.workspace, name);
    fs.writeFileSync(target, "before\n");
    await context.fixtureGit(["add", "--", name]);
    await context.fixtureGit(["commit", "-m", "CREDENTIAL_BASE", "--", name]);
    const secret = `ghp_${"A".repeat(32)}`;
    fs.writeFileSync(target, `before\ncredential=${secret}\n`);

    const result = await getWorkspaceReviewOutcome({
      source: "unstaged",
      allowance: 1000,
      ceiling: 8000,
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.content).not.toContain(secret);
    expect(result.content).toContain("[REDACTED]");
  });

  it("reports a changed line that cannot fit the configured ceiling as unreviewed", async () => {
    const name = "oversized-line.txt";
    const target = path.join(context.workspace, name);
    fs.writeFileSync(target, "before\n");
    await context.fixtureGit(["add", "--", name]);
    await context.fixtureGit([
      "commit",
      "-m",
      "OVERSIZED_LINE_BASE",
      "--",
      name,
    ]);
    fs.writeFileSync(target, `before\n${"oversized-line ".repeat(40000)}\n`);

    const result = await getWorkspaceReviewOutcome({
      source: "unstaged",
      allowance: 8000,
      ceiling: 8000,
    });
    expect(result.status).toBe("incomplete");
    if (result.status === "incomplete") {
      expect(result.content).toContain("Complete: no");
      expect(result.content).toContain("line remains unreviewed");
      expect(result.content).not.toContain("oversized-line ");
    }
  });

  it("identifies the unborn HEAD baseline and leaves repository state unchanged", async () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), "spekta-review-unborn-"),
    );
    try {
      await execa("git", ["init", "--template=", "-b", "main"], {
        cwd: workspace,
      });
      const empty = await getWorkspaceReviewOutcome(
        { source: "all", allowance: 1000, ceiling: 8000 },
        { root: workspace },
      );
      expect(empty.status).toBe("success");
      if (empty.status === "success") {
        expect(empty.content).toContain("Baseline: unborn HEAD.");
        expect(empty.content).toContain("Complete: yes");
      }
      fs.writeFileSync(
        path.join(workspace, "untracked-before-first-commit.txt"),
        "unborn untracked content\n",
      );
      const allWithUntracked = await getWorkspaceReviewOutcome(
        { source: "all", allowance: 1000, ceiling: 8000 },
        { root: workspace },
      );
      expect(allWithUntracked.status).toBe("success");
      if (allWithUntracked.status === "success") {
        expect(allWithUntracked.content).toContain("Baseline: unborn HEAD.");
        expect(allWithUntracked.content).toContain("unborn untracked content");
      }
      const untrackedOnly = await getWorkspaceReviewOutcome(
        { source: "untracked", allowance: 1000, ceiling: 8000 },
        { root: workspace },
      );
      expect(untrackedOnly.status).toBe("success");
      if (untrackedOnly.status === "success") {
        expect(untrackedOnly.content).toContain("Baseline: unborn HEAD.");
        expect(untrackedOnly.content).toContain("Selected scope: untracked.");
        expect(untrackedOnly.content).toContain("unborn untracked content");
      }
      fs.writeFileSync(
        path.join(workspace, "staged.txt"),
        "new tracked content\n",
      );
      await execa("git", ["add", "--", "staged.txt"], { cwd: workspace });
      const before = await execa("git", ["status", "--porcelain=v1", "-z"], {
        cwd: workspace,
      });

      const result = await getWorkspaceReviewOutcome(
        { source: "staged", allowance: 1000, ceiling: 8000 },
        { root: workspace },
      );

      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.content).toContain("Baseline: unborn HEAD.");
        expect(result.content).toContain("Complete: yes");
      }
      const after = await execa("git", ["status", "--porcelain=v1", "-z"], {
        cwd: workspace,
      });
      expect(after.stdout).toBe(before.stdout);
    } finally {
      fs.removeSync(workspace);
    }
  });
});
