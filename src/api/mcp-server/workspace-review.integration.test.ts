import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceFixture } from "../../__tests__/workspace-fixture";
import type { WorkspaceFixture } from "../../__tests__/workspace-fixture";
import { getTokenCount } from "../../utils/read-utils";

const { executeRtkCommand } = vi.hoisted(() => ({
  executeRtkCommand: vi.fn(),
}));

vi.mock("../../commands/proxy/proxy-execution", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../commands/proxy/proxy-execution")
    >();
  return { ...actual, executeRtkCommand };
});

import { createToolRegistry } from "./registry";

let fixture: WorkspaceFixture;
let stagedNames: string[];
let unstagedNames: string[];
let untrackedNames: string[];
let patchRevision: string;
let binaryRevision: string;
let unbornHead: boolean;
let binaryFallback: boolean;
let stagedRename: [string, string] | undefined;
let unmergedName: string | undefined;
const credential = "ghp_abcdefghijklmnopqrstuvwxyz";

function patchFor(name: string): string {
  if (name === "binary.bin")
    if (binaryFallback)
      return [
        `diff --git a/${name} b/${name}`,
        `Binary files a/${name} and b/${name} differ`,
        "",
      ].join("\n");
  if (name === "allowance.txt")
    return [
      `diff --git a/${name} b/${name}`,
      `--- a/${name}`,
      `+++ b/${name}`,
      "@@ -1 +1 @@",
      `+${Array.from({ length: 2000 }, (_, index) => `allowance${index}`).join(" ")}`,
      "",
    ].join("\n");
  if (name === "binary.bin")
    return [
      `diff --git a/${name} b/${name}`,
      "GIT binary patch",
      `literal ${binaryRevision}`,
      "",
    ].join("\n");
  if (name === "credential.txt")
    return [
      `diff --git a/${name} b/${name}`,
      `--- a/${name}`,
      `+++ b/${name}`,
      "@@ -1 +1 @@",
      `+credential=${credential}`,
      "",
    ].join("\n");
  if (name === "giant.txt")
    return [
      `diff --git a/${name} b/${name}`,
      `--- a/${name}`,
      `+++ b/${name}`,
      "@@ -1 +1 @@",
      `+${Array.from({ length: 12000 }, (_, index) => `oversized${index}`).join(" ")}`,
      "",
    ].join("\n");
  if (name === "private-key.txt") {
    const before = Array.from(
      { length: 80 },
      (_, index) => `+ordinary row before key ${index}`,
    );
    const payload = Array.from(
      { length: 120 },
      (_, index) => `+PRIVATE_KEY_PAYLOAD_SENTINEL_${index}`,
    );
    const after = Array.from(
      { length: 80 },
      (_, index) => `+ordinary row after key ${index}`,
    );
    const rows = [
      ...before,
      "+-----BEGIN RSA PRIVATE KEY-----",
      ...payload,
      "+-----END RSA PRIVATE KEY-----",
      ...after,
    ];
    return [
      `diff --git a/${name} b/${name}`,
      `--- a/${name}`,
      `+++ b/${name}`,
      `@@ -1 +1,${rows.length} @@`,
      ...rows,
      "",
    ].join("\n");
  }
  const revision = name === "shared.txt" ? patchRevision : "original";
  const long = name === "large.txt";
  const rows = long
    ? Array.from(
        { length: 120 },
        (_, index) => `+review row ${index} ${revision}`,
      ).join("\n")
    : `+${revision}`;
  return [
    `diff --git a/${name} b/${name}`,
    `--- a/${name}`,
    `+++ b/${name}`,
    `@@ -1 +1,${long ? 120 : 1} @@`,
    rows,
    "",
  ].join("\n");
}

function setupGitResponse(): void {
  executeRtkCommand.mockImplementation((_command: string, args: string[]) => {
    if (args[0] === "rev-parse" && args.includes("--verify"))
      return {
        available: true,
        stdout: unbornHead ? "" : "deadbeef",
        stderr: "",
        exitCode: unbornHead ? 128 : 0,
      };
    if (args[0] === "symbolic-ref")
      return {
        available: true,
        stdout: unbornHead ? "refs/heads/main" : "",
        stderr: "",
        exitCode: unbornHead ? 0 : 1,
      };
    if (args[0] === "show-ref")
      return {
        available: true,
        stdout: "",
        stderr: "",
        exitCode: unbornHead ? 1 : 0,
      };
    if (args[0] === "status")
      return {
        available: true,
        stdout: args.includes("--untracked-files=no")
          ? ""
          : untrackedNames.map((name) => `?? ${name}\0`).join(""),
        stderr: "",
        exitCode: 0,
      };
    const staged = args.includes("--cached");
    const names = staged ? stagedNames : unstagedNames;
    if (args.includes("--name-only") || args.includes("--name-status"))
      return {
        available: true,
        stdout:
          staged && stagedRename
            ? `R100\0work/${stagedRename[0]}\0work/${stagedRename[1]}\0`
            : names.length
              ? `${names.map((name) => `M\0work/${name}`).join("\0")}\0`
              : "",
        stderr: "",
        exitCode: 0,
      };
    if (args.includes("--raw"))
      return {
        available: true,
        stdout: `:${binaryRevision}\0`,
        stderr: "",
        exitCode: 0,
      };
    if (unmergedName && args.includes(unmergedName))
      return {
        available: true,
        stdout: `* Unmerged path work/${unmergedName}\n`,
        stderr: "",
        exitCode: 0,
      };
    if (staged && stagedRename)
      return {
        available: true,
        stdout: [
          `diff --git a/work/${stagedRename[0]} b/work/${stagedRename[1]}`,
          `similarity index 100%`,
          `rename from work/${stagedRename[0]}`,
          `rename to work/${stagedRename[1]}`,
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      };
    const name = args.at(-1)!;
    return {
      available: true,
      stdout: patchFor(name),
      stderr: "",
      exitCode: 0,
    };
  });
}

beforeEach(async () => {
  fixture = await createWorkspaceFixture();
  stagedNames = ["shared.txt", "staged.txt", ".env"];
  unstagedNames = ["shared.txt", "unstaged.txt"];
  untrackedNames = ["untracked.txt"];
  patchRevision = "original";
  binaryRevision = "binary-v1";
  binaryFallback = false;
  unbornHead = false;
  stagedRename = undefined;
  unmergedName = undefined;
  for (const name of [
    "shared.txt",
    "staged.txt",
    "unstaged.txt",
    "large.txt",
    "binary.bin",
    "credential.txt",
    "giant.txt",
    "private-key.txt",
    "untracked.txt",
    "untracked-large.txt",
    "untracked-sensitive.txt",
    "id_rsa",
    ".env",
  ])
    await fs.writeFile(path.join(fixture.root, name), "workspace content\n");
  await fs.writeFile(
    path.join(fixture.root, "untracked.txt"),
    "untracked unique content\n",
  );
  setupGitResponse();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
});

describe("MCP workspace review", () => {
  it("registers the tool and reports staged and unstaged sections for one file separately", async () => {
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    expect(tool).toBeDefined();
    expect(
      tool
        .schema({
          source: { description: "scope" },
          continuation: { description: "page" },
          allowance: { description: "tokens" },
        })
        .safeParse({ source: "all", allowance: 1000 }).success,
    ).toBe(true);
    expect(
      tool
        .schema({
          source: { description: "scope" },
          continuation: { description: "page" },
          allowance: { description: "tokens" },
        })
        .safeParse({ source: "untracked", allowance: 1000 }).success,
    ).toBe(true);

    const response = await tool.handler({ allowance: 8000 });
    const text = response.content[0].text;
    expect(response.isError, text).not.toBe(true);
    expect(text).toContain("Selected scope: staged, unstaged, and untracked.");
    expect(text.match(/## staged section/g)).toHaveLength(2);
    expect(text.match(/## unstaged section/g)).toHaveLength(2);
    expect(text).toContain("## untracked section");
    expect(text).toContain("untracked unique content");
    expect(text).not.toContain("untracked files are outside this review");
    expect(text).not.toContain(".env");
  });

  it("renders a zero-byte untracked file as an explicit empty section", async () => {
    const name = "empty-untracked.txt";
    await fs.writeFile(path.join(fixture.root, name), Buffer.alloc(0));
    untrackedNames = [name];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;

    const response = await tool.handler({
      source: "untracked",
      allowance: 1000,
    });
    const text = response.content[0].text;
    expect(response.isError, text).not.toBe(true);
    expect(text).toContain(`## untracked section 1: "${name}"`);
    expect(text).toContain("(empty untracked file)");
    expect(text).toContain("Complete: yes.");
    expect(text).toContain(
      "Coverage: complete for eligible untracked text changes.",
    );
  });

  it("uses the unborn HEAD baseline while reviewing staged and untracked changes", async () => {
    unbornHead = true;
    stagedNames = ["staged.txt"];
    unstagedNames = [];
    untrackedNames = ["untracked.txt"];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const requestId = "workspace-review-unborn-head";
    const allowance = 1000;
    const response = await tool.handler(
      { source: "all", allowance },
      undefined,
      requestId,
    );
    const text = response.content[0].text;
    expect(response.isError, text).not.toBe(true);
    expect(text).toContain("Baseline: unborn HEAD.");
    expect(text).toContain('## staged section 1: "work/staged.txt"');
    expect(text).toContain('## untracked section 2: "untracked.txt"');
    expect(text).toContain("untracked unique content");
    expect(
      getTokenCount(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: response })}\n`,
      ),
    ).toBeLessThanOrEqual(allowance);
  });

  it("shows both eligible rename endpoints and conceals a restricted endpoint", async () => {
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const oldName = "rename-old.txt";
    const newName = "rename-new.txt";
    await fs.writeFile(path.join(fixture.root, oldName), "rename content\n");
    await fs.writeFile(path.join(fixture.root, newName), "rename content\n");
    stagedRename = [oldName, newName];

    const eligible = await tool.handler({ source: "staged", allowance: 1000 });
    expect(eligible.content[0].text).toContain(
      `"work/${oldName}" -> "work/${newName}"`,
    );
    expect(eligible.content[0].text).toContain(`rename from work/${oldName}`);
    expect(eligible.content[0].text).toContain(`rename to work/${newName}`);

    stagedRename = [".env", "public-after-restricted-rename.txt"];
    const concealed = await tool.handler({ source: "staged", allowance: 1000 });
    expect(concealed.content[0].text).not.toContain(".env");
    expect(concealed.content[0].text).not.toContain(
      "public-after-restricted-rename.txt",
    );
  });

  it("reports unsupported tracked sections as unavailable without failing siblings", async () => {
    stagedNames = ["staged.txt", "shared.txt"];
    unmergedName = "staged.txt";
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const response = await tool.handler({ source: "staged", allowance: 1000 });
    expect(response.isError).not.toBe(true);
    expect(response.content[0].text).toContain("Coverage: incomplete");
    expect(response.content[0].text).toContain(
      "eligible section(s) could not be displayed",
    );
    expect(response.content[0].text).toContain('"work/staged.txt"');
    expect(response.content[0].text).toContain('"work/shared.txt"');
  });

  it("retries an allowance-blocked MCP line within the response envelope", async () => {
    stagedNames = ["allowance.txt"];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const requestId = "workspace-review-allowance-retry";
    const allowance = 500;
    const blocked = await tool.handler(
      { source: "staged", allowance },
      undefined,
      requestId,
    );
    expect(blocked.isError).not.toBe(true);
    expect(blocked.content[0].text).toContain("retry with a higher allowance");
    expect(
      getTokenCount(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: blocked })}\n`,
      ),
    ).toBeLessThanOrEqual(allowance);
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      blocked.content[0].text,
    )?.[1];
    expect(continuation).toBeDefined();

    const retried = await tool.handler(
      { source: "staged", continuation, allowance: 7900 },
      undefined,
      requestId,
    );
    expect(retried.isError).not.toBe(true);
    expect(retried.content[0].text).toContain("allowance1999");
    expect(
      getTokenCount(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: retried })}\n`,
      ),
    ).toBeLessThanOrEqual(7900);
  });

  it("treats envelope shrinkage at the body ceiling as completion unavailable", async () => {
    const priorCeiling = process.env.SPEKTA_GIT_TOKEN_CEILING;
    process.env.SPEKTA_GIT_TOKEN_CEILING = "1600";
    try {
      stagedNames = ["shared.txt"];
      patchRevision = '\\"'.repeat(1000);
      const tool = createToolRegistry({
        root: fixture.root,
      }).spekta_workspace_review;
      const requestId = "workspace-review-escaped-ceiling";
      const allowance = 1600;
      const response = await tool.handler(
        { source: "staged", allowance },
        undefined,
        requestId,
      );
      const text = response.content[0].text;
      expect(response.isError, text).toBe(true);
      expect(text).toContain(
        "completion is unavailable through this operation",
      );
      expect(text).not.toContain("retry with a higher allowance");
      expect(
        getTokenCount(
          `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: response })}\n`,
        ),
      ).toBeLessThanOrEqual(allowance);
    } finally {
      if (priorCeiling === undefined)
        delete process.env.SPEKTA_GIT_TOKEN_CEILING;
      else process.env.SPEKTA_GIT_TOKEN_CEILING = priorCeiling;
    }
  });

  it("reviews only untracked files across bounded pages and invalidates changed content", async () => {
    untrackedNames = ["untracked-large.txt"];
    await fs.writeFile(
      path.join(fixture.root, "untracked-large.txt"),
      Array.from({ length: 120 }, (_, index) => `untracked row ${index}`).join(
        "\n",
      ) + "\nghp_abcdefghijklmnopqrstuvwxyz",
    );
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const requestId = "workspace-review-untracked";
    const allowance = 500;
    const envelopeTokens = (response: unknown) =>
      getTokenCount(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: response })}\n`,
      );

    let response = await tool.handler(
      { source: "untracked", allowance },
      undefined,
      requestId,
    );
    expect(response.isError, response.content[0].text).not.toBe(true);
    expect(response.content[0].text).toContain("Selected scope: untracked.");
    expect(response.content[0].text).toContain("Complete: no");
    expect(response.content[0].text).toContain("## untracked section");
    expect(response.content[0].text).not.toContain("diff --git");
    expect(envelopeTokens(response)).toBeLessThanOrEqual(allowance);

    const firstPage = response.content[0].text;
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      firstPage,
    )?.[1];
    expect(continuation).toBeDefined();

    const pages = [firstPage];
    for (
      let page = 0;
      page < 10 && pages.at(-1)?.includes("Complete: no");
      page++
    ) {
      const nextContinuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
        pages.at(-1)!,
      )?.[1];
      expect(nextContinuation).toBeDefined();
      response = await tool.handler(
        { source: "untracked", continuation: nextContinuation, allowance },
        undefined,
        requestId,
      );
      expect(response.isError).not.toBe(true);
      expect(envelopeTokens(response)).toBeLessThanOrEqual(allowance);
      pages.push(response.content[0].text);
    }
    expect(pages.at(-1)).toContain("Complete: yes");
    expect(pages.join("\n")).toContain("untracked row 119");
    expect(pages.join("\n")).toContain("[REDACTED]");
    expect(pages.join("\n")).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");

    const staleFirstPage = await tool.handler(
      { source: "untracked", allowance },
      undefined,
      requestId,
    );
    const staleContinuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      staleFirstPage.content[0].text,
    )?.[1];
    expect(staleContinuation).toBeDefined();
    await fs.appendFile(
      path.join(fixture.root, "untracked-large.txt"),
      "changed\n",
    );
    const stale = await tool.handler(
      { source: "untracked", continuation: staleContinuation, allowance },
      undefined,
      requestId,
    );
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toContain("restart the review");

    const createFirstPage = await tool.handler(
      { source: "untracked", allowance },
      undefined,
      requestId,
    );
    const createContinuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      createFirstPage.content[0].text,
    )?.[1];
    expect(createContinuation).toBeDefined();
    untrackedNames = [...untrackedNames, "created-after-page.txt"];
    await fs.writeFile(
      path.join(fixture.root, "created-after-page.txt"),
      "created\n",
    );
    const created = await tool.handler(
      { source: "untracked", continuation: createContinuation, allowance },
      undefined,
      requestId,
    );
    expect(created.isError).toBe(true);

    const deleteFirstPage = await tool.handler(
      { source: "untracked", allowance },
      undefined,
      requestId,
    );
    const deleteContinuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      deleteFirstPage.content[0].text,
    )?.[1];
    expect(deleteContinuation).toBeDefined();
    untrackedNames = untrackedNames.filter(
      (name) => name !== "created-after-page.txt",
    );
    await fs.remove(path.join(fixture.root, "created-after-page.txt"));
    const deleted = await tool.handler(
      { source: "untracked", continuation: deleteContinuation, allowance },
      undefined,
      requestId,
    );
    expect(deleted.isError).toBe(true);
  });

  it("identifies binary untracked content and invalidates continuation when it changes", async () => {
    const binaryPath = path.join(fixture.root, "a-untracked-binary.bin");
    const textPath = path.join(fixture.root, "z-untracked-long.txt");
    await fs.writeFile(
      binaryPath,
      Buffer.concat([Buffer.from([0]), Buffer.from("binary-secret-payload")]),
    );
    await fs.writeFile(
      textPath,
      Array.from({ length: 120 }, (_, index) => `binary row ${index}`).join(
        "\n",
      ),
    );
    untrackedNames = ["a-untracked-binary.bin", "z-untracked-long.txt"];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const requestId = "workspace-review-binary";
    const response = await tool.handler(
      { source: "untracked", allowance: 500 },
      undefined,
      requestId,
    );
    const text = response.content[0].text;
    expect(response.isError, text).not.toBe(true);
    expect(text).toContain("eligible binary change(s)");
    expect(text).toContain("Binary untracked file content is not displayed.");
    expect(text).not.toContain("binary-secret-payload");
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      text,
    )?.[1];
    expect(continuation).toBeDefined();
    await fs.writeFile(
      binaryPath,
      Buffer.concat([Buffer.from([0]), Buffer.from("changed-secret-payload")]),
    );
    const stale = await tool.handler(
      { source: "untracked", continuation, allowance: 500 },
      undefined,
      requestId,
    );
    expect(stale.isError).toBe(true);
  });
  it("does not disclose restricted untracked paths", async () => {
    untrackedNames = [
      "untracked.txt",
      ".env",
      "id_rsa",
      "external-file.txt",
      "ignored-alias.txt",
      ...(process.platform === "win32" ? [] : ["alias.env.txt"]),
    ];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;

    const response = await tool.handler({
      source: "untracked",
      allowance: 8000,
    });
    const text = response.content[0].text;
    expect(response.isError, text).not.toBe(true);
    expect(text).toContain("untracked unique content");
    expect(text).not.toContain(".env");
    expect(text).not.toContain("id_rsa");
    expect(text).not.toContain("external-file.txt");
    expect(text).not.toContain("ignored-alias.txt");
    expect(text).not.toContain("alias.env.txt");
    expect(text).not.toContain("workspace content");
  });

  it("narrows the selected source and paginates complete sections within the MCP budget", async () => {
    stagedNames = ["shared.txt", "staged.txt", "large.txt", ".env"];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const requestId = "workspace-review-page-1";
    const allowance = 500;
    const envelopeTokens = (response: unknown) =>
      getTokenCount(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: response })}\n`,
      );

    const first = await tool.handler(
      { source: "staged", allowance },
      undefined,
      requestId,
    );
    expect(first.isError, first.content[0].text).not.toBe(true);
    expect(first.content[0].text).toContain("Selected scope: staged.");
    expect(first.content[0].text).toContain("Complete: no.");
    expect(first.content[0].text).toContain("Coverage: incomplete");
    expect(envelopeTokens(first)).toBeLessThanOrEqual(allowance);
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      first.content[0].text,
    )?.[1];
    expect(continuation).toBeDefined();

    let nextToken = continuation;
    const pages = [first.content[0].text];
    for (
      let page = 0;
      page < 10 && pages.at(-1)?.includes("Complete: no.");
      page++
    ) {
      const response = await tool.handler(
        { source: "staged", continuation: nextToken, allowance },
        undefined,
        requestId,
      );
      expect(response.isError).not.toBe(true);
      expect(envelopeTokens(response)).toBeLessThanOrEqual(allowance);
      pages.push(response.content[0].text);
      nextToken = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
        pages.at(-1)!,
      )?.[1];
    }
    expect(pages.at(-1)).toContain("Complete: yes.");
    expect(pages.slice(1).join("\n")).not.toContain(
      '## staged section 1: "shared.txt"',
    );

    const unstaged = await tool.handler({
      source: "unstaged",
      allowance: 8000,
    });
    expect(unstaged.content[0].text).toContain("Selected scope: unstaged.");
    expect(unstaged.content[0].text).toContain("unstaged.txt");
    expect(unstaged.content[0].text).not.toContain("diff --git a/staged.txt");
  });

  it("rejects continuations after selected content changes and reports allowance failures", async () => {
    stagedNames = ["shared.txt", "staged.txt", "large.txt", ".env"];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const first = await tool.handler({ source: "staged", allowance: 500 });
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      first.content[0].text,
    )?.[1];
    expect(continuation).toBeDefined();

    patchRevision = "changed-after-page-one";
    const changed = await tool.handler({
      source: "staged",
      continuation,
      allowance: 500,
    });
    expect(changed.isError).toBe(true);
    expect(changed.content[0].text).toContain("restart the review");

    const tooSmall = await tool.handler({ source: "all", allowance: 1 });
    expect(tooSmall.isError).toBe(true);
    expect(tooSmall.content[0].text).toContain("usage_error");
  });

  it("redacts credential patterns in the shared MCP response", async () => {
    stagedNames.push("credential.txt");
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;

    const response = await tool.handler({ source: "staged", allowance: 8000 });
    const text = response.content[0].text;

    expect(response.isError).not.toBe(true);
    expect(text).not.toContain(credential);
    expect(text).toContain("[REDACTED]");
  });

  it("identifies binary coverage and invalidates continuation when binary content changes", async () => {
    binaryFallback = true;
    stagedNames = ["large.txt", "binary.bin"];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;

    const complete = await tool.handler({ source: "staged", allowance: 8000 });
    expect(complete.isError).not.toBe(true);
    expect(complete.content[0].text).toContain("binary.bin");
    expect(complete.content[0].text).toContain("Coverage: incomplete");
    expect(complete.content[0].text).toContain("Complete: yes");
    expect(complete.content[0].text).not.toContain("binary-v1");
    expect(complete.content[0].text).not.toContain("GIT binary patch");
    const gitCalls = executeRtkCommand.mock.calls as unknown as Array<
      [string, string[]]
    >;
    expect(
      gitCalls.some(
        ([, args]) => args.includes("--raw") && args.includes("--full-index"),
      ),
    ).toBe(true);

    const firstPage = await tool.handler({ source: "staged", allowance: 500 });
    const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
      firstPage.content[0].text,
    )?.[1];
    expect(continuation).toBeDefined();

    binaryRevision = "binary-v2";
    const stale = await tool.handler({
      source: "staged",
      continuation,
      allowance: 500,
    });
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toContain("restart the review");
  });

  it("continues within one large text patch and reports a line that cannot fit the ceiling", async () => {
    stagedNames = ["large.txt"];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const requestId = "workspace-review-large-patch";
    const allowance = 500;
    const envelopeTokens = (response: unknown) =>
      getTokenCount(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: response })}\n`,
      );

    let response = await tool.handler(
      { source: "staged", allowance },
      undefined,
      requestId,
    );
    const pages = [response.content[0].text];
    expect(response.isError).not.toBe(true);
    expect(pages[0]).toContain("Complete: no");
    expect(envelopeTokens(response)).toBeLessThanOrEqual(allowance);
    for (
      let page = 0;
      page < 10 && pages.at(-1)?.includes("Complete: no");
      page++
    ) {
      const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
        pages.at(-1)!,
      )?.[1];
      expect(continuation).toBeDefined();
      response = await tool.handler(
        { source: "staged", continuation, allowance },
        undefined,
        requestId,
      );
      expect(response.isError).not.toBe(true);
      expect(envelopeTokens(response)).toBeLessThanOrEqual(allowance);
      pages.push(response.content[0].text);
    }
    const delivered = pages.join("\n");
    expect(delivered).toContain("review row 0");
    expect(delivered).toContain("review row 119");
    expect(pages.at(-1)).toContain("Complete: yes");

    stagedNames = ["giant.txt"];
    const oversizedLine = await tool.handler({
      source: "staged",
      allowance: 8000,
    });
    expect(oversizedLine.isError, JSON.stringify(oversizedLine)).toBe(true);
    expect(oversizedLine.content[0].text).toContain("unreviewed");
    expect(oversizedLine.content[0].text).toContain("ceiling");
  });

  it("never exposes private-key payload when its raw marker block spans page budgets", async () => {
    stagedNames = ["private-key.txt"];
    const tool = createToolRegistry({
      root: fixture.root,
    }).spekta_workspace_review;
    const requestId = "workspace-review-private-key";
    const allowance = 500;
    let response = await tool.handler(
      { source: "staged", allowance },
      undefined,
      requestId,
    );
    const pages = [response.content[0].text];

    for (
      let page = 0;
      page < 10 && pages.at(-1)?.includes("Complete: no");
      page++
    ) {
      const continuation = /Continuation: ([a-f0-9]{24}:\d+:\d+)\./.exec(
        pages.at(-1)!,
      )?.[1];
      expect(continuation).toBeDefined();
      response = await tool.handler(
        { source: "staged", continuation, allowance },
        undefined,
        requestId,
      );
      pages.push(response.content[0].text);
    }

    const delivered = pages.join("\n");
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.at(-1)).toContain("Complete: yes");
    expect(delivered).toContain("[REDACTED]");
    expect(delivered).not.toContain("PRIVATE_KEY_PAYLOAD_SENTINEL");
    expect(delivered).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(delivered).not.toContain("END RSA PRIVATE KEY");
  });
});
