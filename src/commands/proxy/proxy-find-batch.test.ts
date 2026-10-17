import fs from "fs-extra";
import { execa } from "execa";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput } from "./proxy-output";
import * as security from "../../utils/security";
import {
  discoverFindBatch as executeFindBatch,
  getFindValidationFailure,
  getFindValidationText,
  type FindBatchMeasure,
  type FindBatchMetadataMeasure,
  type FindBatchOptions,
} from "./proxy-find-batch";

const cleanup: string[] = [];
const EMPTY_FOR_TEST = "No eligible paths in this discovery.\n";
async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-find-batch-"));
  cleanup.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => fs.remove(dir)));
});
const textMeasure: FindBatchMeasure = (text) => getTokenCount(text);
const textBytes: FindBatchMetadataMeasure = (text) =>
  Buffer.byteLength(text, "utf8");
const cliMeasure: FindBatchMeasure = (text, isError) =>
  getTokenCount(
    `${formatProxyOutput("find", text, isError ? { exitCode: 1 } : {})}\n`,
  );
const cliResponse = (text: string, isError = false) =>
  `${formatProxyOutput("find", text, isError ? { exitCode: 1 } : {})}\n`;
const cliBytes: FindBatchMetadataMeasure = (text, isError) =>
  Buffer.byteLength(cliResponse(text, isError), "utf8");
const mcpResponse = (id: string | number, text: string, isError: boolean) =>
  `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      isError,
      content: [{ type: "text", text }],
    },
  })}\n`;
const mcpMeasure =
  (id: string | number): FindBatchMeasure =>
  (text, isError) =>
    getTokenCount(mcpResponse(id, text, isError));
const mcpBytes =
  (id: string | number): FindBatchMetadataMeasure =>
  (text, isError) =>
    Buffer.byteLength(mcpResponse(id, text, isError), "utf8");

type TestOptions = Omit<FindBatchOptions, "metadataBytes"> & {
  metadataBytes?: FindBatchMetadataMeasure;
};
function discoverFindBatch(
  args: readonly string[],
  context: Parameters<typeof executeFindBatch>[1],
  options: TestOptions,
) {
  return executeFindBatch(args, context, {
    ...options,
    metadataBytes: options.metadataBytes ?? textBytes,
  });
}

async function createEligibleSibling(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "ok"));
  await fs.writeFile(path.join(root, "ok", "keep.ts"), "eligible");
}

describe("discoverFindBatch", () => {
  it("keeps a concise problem-specific grammar error under a tight default budget", async () => {
    const fallback = "usage_error: Unsupported find syntax.";
    const problem =
      "usage_error: unsupported find token, expression, or action.";
    const defaultBudget = cliMeasure(fallback, true);
    const failure = getFindValidationFailure(
      cliMeasure,
      8000,
      defaultBudget,
      undefined,
      "usage_error: unsupported find token: only one terminal -print action is supported.",
    );
    const normalCliFailure = getFindValidationFailure(
      cliMeasure,
      8000,
      1000,
      undefined,
      problem,
    );
    const requestId = "request-17";
    const normalMcpFailure = getFindValidationFailure(
      mcpMeasure(requestId),
      8000,
      1000,
      "shorten a long MCP request ID if needed",
      problem,
    );
    const backend = vi.fn(() => Promise.resolve({ stdout: "", exitCode: 0 }));
    const result = await discoverFindBatch([".", "-delete"], undefined, {
      allowance: 1000,
      validationAllowance: defaultBudget,
      maximumAllowance: 8000,
      measure: cliMeasure,
      backend,
      hasRtk: false,
    });

    expect(failure.fitsDefault).toBe(true);
    expect(getFindValidationText(failure)).toBe(fallback);
    expect(cliMeasure(result.content, true)).toBeLessThanOrEqual(defaultBudget);
    expect(result.status).toBe("usage_error");
    expect(result.content).toBe(fallback);
    expect(backend).not.toHaveBeenCalled();
    expect(getFindValidationText(normalCliFailure)).toBe(problem);
    expect(cliMeasure(problem, true)).toBeLessThanOrEqual(1000);
    expect(getFindValidationText(normalMcpFailure)).toBe(problem);
    expect(mcpMeasure(requestId)(problem, true)).toBeLessThanOrEqual(1000);
    console.log("Problem-specific validation budget samples", {
      cliDefault: 1000,
      cli: cliResponse(problem, true),
      cliTokens: cliMeasure(problem, true),
      mcpDefault: 1000,
      mcpRequestId: requestId,
      mcp: mcpResponse(requestId, problem, true),
      mcpTokens: mcpMeasure(requestId)(problem, true),
      tightCliDefault: defaultBudget,
      tightCliFallback: cliResponse(fallback, true),
      tightCliTokens: cliMeasure(fallback, true),
    });
  });

  it("renders success, mixed unavailable, empty, incomplete, and overflow samples", async () => {
    const root = await workspace();
    await createEligibleSibling(root);
    const longParts = [
      "l".repeat(200),
      "m".repeat(200),
      "n".repeat(200),
      "o".repeat(200),
      "p".repeat(200),
      "q".repeat(100),
    ];
    await fs.ensureDir(path.join(root, "ok", ...longParts.slice(0, -1)));
    await fs.writeFile(path.join(root, "ok", ...longParts), "eligible");
    const success = await discoverFindBatch(
      ["ok"],
      { root },
      {
        allowance: 1000,
        measure: cliMeasure,
        metadataBytes: cliBytes,
        backend: () => Promise.resolve({ stdout: "ok/keep.ts\n", exitCode: 0 }),
        hasRtk: true,
      },
    );
    const mixed = await discoverFindBatch(
      ["secret-missing", "ok"],
      { root },
      {
        allowance: 1000,
        measure: cliMeasure,
        metadataBytes: cliBytes,
        backend: () => Promise.resolve({ stdout: "ok/keep.ts\n", exitCode: 0 }),
        hasRtk: true,
      },
    );
    const empty = await discoverFindBatch(
      ["ok"],
      { root },
      {
        allowance: 1000,
        measure: cliMeasure,
        metadataBytes: cliBytes,
        backend: () => Promise.resolve({ stdout: "", exitCode: 0 }),
        hasRtk: true,
      },
    );

    let incomplete: Awaited<ReturnType<typeof discoverFindBatch>> | undefined;
    let incompleteAllowance = 0;
    for (let allowance = 40; allowance <= 800; allowance++) {
      const candidate = await discoverFindBatch(
        ["ok"],
        { root },
        {
          allowance,
          measure: cliMeasure,
          metadataBytes: cliBytes,
          backend: () =>
            Promise.resolve({
              stdout: `ok/${longParts.join("/")}\n`,
              exitCode: 0,
            }),
          hasRtk: true,
        },
      );
      if (candidate.operands[0]?.status === "incomplete") {
        incomplete = candidate;
        incompleteAllowance = allowance;
        break;
      }
    }
    expect(incomplete).toBeDefined();

    let overflow: Awaited<ReturnType<typeof discoverFindBatch>> | undefined;
    let overflowAllowance = 0;
    for (let allowance = 34; allowance <= 180; allowance++) {
      const candidate = await discoverFindBatch(
        [".", "."],
        { root },
        {
          allowance,
          measure: cliMeasure,
          metadataBytes: cliBytes,
          backend: () => Promise.resolve({ stdout: "", exitCode: 0 }),
          hasRtk: true,
        },
      );
      if (candidate.status === "output_limit_exceeded" && candidate.content) {
        overflow = candidate;
        overflowAllowance = allowance;
        break;
      }
    }
    expect(overflow).toBeDefined();

    expect(success.content).toBe(
      'Batch: success\nOperand 1: returned; "ok"\n"ok/keep.ts"\n',
    );
    expect(mixed.content).toBe(
      'Batch: partial_result\nOperand 1: unavailable; unavailable_access\nOperand 2: returned; "ok"\n"ok/keep.ts"\n',
    );
    expect(empty.content).toBe(
      'Batch: success\nOperand 1: returned; "ok"\nNo eligible paths in this discovery.\n',
    );
    expect(incomplete!.content).toBe(
      'Batch: partial_result\nOperand 1: incomplete; output_limit_exceeded; "ok"\n  Narrow this root.\n',
    );
    expect(overflow!.content).toBe(
      "output_limit_exceeded: split discovery roots.\n",
    );
    expect(incompleteAllowance).toBe(136);
    expect(overflowAllowance).toBeGreaterThanOrEqual(34);
    expect(cliMeasure(success.content, success.isError)).toBe(28);
    expect(cliMeasure(mixed.content, mixed.isError)).toBe(44);
    expect(cliMeasure(empty.content, empty.isError)).toBe(29);
    expect(cliMeasure(incomplete!.content, incomplete!.isError)).toBe(39);
    expect(cliMeasure(overflow!.content, overflow!.isError)).toBe(24);
    console.log("CLI rendered samples / complete-response token measures", {
      allowance: 1000,
      success: {
        text: cliResponse(success.content),
        cost: cliMeasure(success.content, success.isError),
      },
      mixed: {
        text: cliResponse(mixed.content, mixed.isError),
        cost: cliMeasure(mixed.content, mixed.isError),
      },
      empty: {
        text: cliResponse(empty.content),
        cost: cliMeasure(empty.content, empty.isError),
      },
      incomplete: {
        allowance: incompleteAllowance,
        text: cliResponse(incomplete!.content, incomplete!.isError),
        cost: cliMeasure(incomplete!.content, incomplete!.isError),
      },
      overflow: {
        allowance: overflowAllowance,
        text: cliResponse(overflow!.content, true),
        cost: cliMeasure(overflow!.content, true),
      },
    });
  });

  it("rejects malformed grammar before any root backend call", async () => {
    const root = await workspace();
    const backend = vi.fn(() => Promise.resolve({ stdout: "", exitCode: 0 }));
    const result = await discoverFindBatch(
      ["missing-secret", "-name", "x", "root-after-predicate"],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        backend,
        hasRtk: true,
      },
    );
    expect(result.status).toBe("usage_error");
    expect(backend).not.toHaveBeenCalled();
    expect(result.content).not.toContain("missing-secret");
  });

  it("gives missing, restricted, ignored, outside, non-directory, and escaping symlink roots identical safe outcomes beside one sibling", async () => {
    const root = await workspace();
    await createEligibleSibling(root);
    await fs.mkdir(path.join(root, ".env"));
    await fs.mkdir(path.join(root, "ignored"));
    await fs.writeFile(path.join(root, ".spektaignore"), "ignored/\n");
    await fs.writeFile(path.join(root, "plain-file"), "not a directory");
    const outside = path.join(
      path.dirname(root),
      `${path.basename(root)}-outside-secret-target`,
    );
    cleanup.push(outside);
    await fs.mkdir(outside);
    await fs.writeFile(
      path.join(outside, "hidden.txt"),
      "secret-content-marker",
    );
    await fs.symlink(outside, path.join(root, "escape"));
    const candidates = [
      "missing-secret-root",
      ".env",
      "ignored",
      `../${path.basename(outside)}`,
      outside,
      "plain-file",
      "escape",
    ];
    let expected: string | undefined;
    for (const candidate of candidates) {
      const calls: string[] = [];
      const result = await discoverFindBatch(
        [candidate, "ok"],
        { root },
        {
          allowance: 2000,
          measure: textMeasure,
          backend: (operand) => {
            calls.push(operand);
            return Promise.resolve({ stdout: "ok/keep.ts\n", exitCode: 0 });
          },
          hasRtk: true,
        },
      );
      expected ??= result.content;
      expect(result.content).toBe(expected);
      expect(result.content).toContain(
        "Operand 1: unavailable; unavailable_access",
      );
      expect(result.content).not.toContain(candidate);
      expect(result.content).not.toContain(outside);
      expect(result.content).not.toContain("outside-secret");
      expect(result.content).not.toContain("secret-content-marker");
      expect(calls).toEqual(["ok"]);
      expect(result.operands).toEqual([
        { position: 1, status: "unavailable" },
        { position: 2, status: "returned" },
      ]);
    }
  });

  it("fails closed on denied access and canonical lookup errors while retaining a sibling", async () => {
    const root = await workspace();
    await createEligibleSibling(root);
    const original = security.validateReadPathAccess;
    const accessCheck = vi
      .spyOn(security, "validateReadPathAccess")
      .mockImplementation((operand, workspace) => {
        if (operand === "denied-access")
          return Promise.reject(
            Object.assign(new Error("permission denied secret"), {
              code: "EACCES",
            }),
          );
        if (operand === "canonical-failure")
          return Promise.reject(new Error("canonical target secret"));
        return original(operand, workspace);
      });
    try {
      for (const operand of ["denied-access", "canonical-failure"]) {
        const calls: string[] = [];
        const result = await discoverFindBatch(
          [operand, "ok"],
          { root },
          {
            allowance: 1000,
            measure: textMeasure,
            backend: (candidate) => {
              calls.push(candidate);
              return Promise.resolve({
                stdout: "ok/keep.ts\n",
                exitCode: 0,
              });
            },
            hasRtk: true,
          },
        );
        expect(result.content).toContain(
          "Operand 1: unavailable; unavailable_access",
        );
        expect(result.content).not.toContain(operand);
        expect(result.content).not.toContain("permission denied");
        expect(result.content).not.toContain("canonical target");
        expect(result.content).toContain('"ok/keep.ts"');
        expect(calls).toEqual(["ok"]);
      }
    } finally {
      accessCheck.mockRestore();
    }
  });

  it("makes empty and excluded-only discovery wording identical", async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, "ok", "ignored"), { recursive: true });
    await fs.writeFile(path.join(root, ".spektaignore"), "ok/ignored/\n");
    await fs.writeFile(
      path.join(root, "ok", "ignored", "hidden.txt"),
      "secret",
    );
    const empty = await discoverFindBatch(
      ["ok"],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        backend: () => Promise.resolve({ stdout: "", exitCode: 0 }),
        hasRtk: true,
      },
    );
    const excluded = await discoverFindBatch(
      ["ok"],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        backend: () =>
          Promise.resolve({ stdout: "ok/ignored/hidden.txt\n", exitCode: 0 }),
        hasRtk: true,
      },
    );
    expect(empty.content).toBe(excluded.content);
    expect(empty.content).toContain("No eligible paths in this discovery.");
    expect(excluded.content).not.toContain("hidden");
  });

  it("keeps a contained directory symlink root physical and filters its descendants", async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, "real"));
    await fs.writeFile(path.join(root, "real", "child.txt"), "eligible");
    await fs.symlink(path.join(root, "real"), path.join(root, "alias"), "dir");
    const linkRoot = await discoverFindBatch(
      ["alias"],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        backend: async (operand) => {
          expect(operand).toBe("alias");
          // Observe the installed find's physical-root behavior rather than inferring it from -P.
          const result = await execa("find", ["-P", operand], { cwd: root });
          expect(result.stdout).toBe("alias");
          return { stdout: `${result.stdout}\n`, exitCode: result.exitCode };
        },
        hasRtk: true,
      },
    );
    expect(linkRoot.content).toContain('"alias"');
    expect(linkRoot.content).not.toContain("alias/child.txt");
    const descendant = await discoverFindBatch(
      ["."],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        // Simulate backend output that claims to have crossed a directory symlink.
        backend: () =>
          Promise.resolve({ stdout: "alias/child.txt\n", exitCode: 0 }),
        hasRtk: true,
      },
    );
    expect(descendant.content).toContain(
      "No eligible paths in this discovery.",
    );
    expect(descendant.content).not.toContain("child.txt");
  });

  it("preserves duplicate roots and backend order", async () => {
    const root = await workspace();
    for (const name of ["a", "b"]) {
      await fs.mkdir(path.join(root, name));
      await fs.writeFile(path.join(root, name, `${name}.ts`), "eligible");
    }
    const calls: string[] = [];
    const result = await discoverFindBatch(
      ["a", "b", "a"],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        backend: (operand) => {
          calls.push(operand);
          return Promise.resolve({
            stdout: `${operand}/${path.basename(operand)}.ts\n`,
            exitCode: 0,
          });
        },
        hasRtk: true,
      },
    );
    expect(calls).toEqual(["a", "b", "a"]);
    expect(result.operands.map((operand) => operand.position)).toEqual([
      1, 2, 3,
    ]);
    expect(result.content.indexOf('"a"')).toBeLessThan(
      result.content.indexOf('"b"'),
    );
    expect(result.content.match(/"a\/a\.ts"/g)).toHaveLength(2);
  });

  it("attributes physical absolute paths from an eligible POSIX root", async () => {
    const root = await workspace();
    await createEligibleSibling(root);
    const absoluteRoot = path.join(root, "ok");
    const result = await discoverFindBatch(
      [absoluteRoot],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        backend: () =>
          Promise.resolve({
            stdout: `${path.join(absoluteRoot, "keep.ts")}\n`,
            exitCode: 0,
          }),
        hasRtk: true,
      },
    );
    expect(result.status).toBe("success");
    expect(result.content).toContain('"ok/keep.ts"');
    expect(result.content).toContain(JSON.stringify(absoluteRoot));
  });

  it("redacts secrets and escapes quotes and Markdown delimiters in labels and paths", async () => {
    const root = await workspace();
    const secret = `sk-${"A".repeat(24)}`;
    const label = `${secret}-${String.fromCharCode(96)}root`;
    await fs.mkdir(path.join(root, label));
    const entry = `file-${String.fromCharCode(96)}name.md`;
    await fs.writeFile(path.join(root, label, entry), "eligible");
    const result = await discoverFindBatch(
      [label],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        backend: () =>
          Promise.resolve({ stdout: `${label}/${entry}\n`, exitCode: 0 }),
        hasRtk: true,
      },
    );
    expect(result.content).not.toContain(secret);
    expect(result.content).toContain("[REDACTED]");
    expect(result.content).toContain("\\u0060");
  });

  it("allocates whole paths fairly and redistributes after a short root finishes", async () => {
    const root = await workspace();
    await fs.mkdir(path.join(root, "short"));
    await fs.mkdir(path.join(root, "long"));
    await fs.writeFile(path.join(root, "short", "s.ts"), "x");
    const longPaths = [
      "a.ts",
      "b.ts",
      [...Array.from({ length: 5 }, () => "v".repeat(200)), "last.ts"].join(
        "/",
      ),
    ];
    for (const name of longPaths) {
      await fs.ensureDir(path.dirname(path.join(root, "long", name)));
      await fs.writeFile(path.join(root, "long", name), "x");
    }
    const backend = (operand: string) =>
      Promise.resolve({
        stdout:
          operand === "short"
            ? "short/s.ts\n"
            : longPaths.map((name) => `long/${name}\n`).join(""),
        exitCode: 0,
      });
    const target =
      'Batch: partial_result\nOperand 1: returned; "short"\n"short/s.ts"\n' +
      'Operand 2: incomplete; output_limit_exceeded; "long"\n"long/a.ts"\n"long/b.ts"\n  Narrow this root.\n';
    const reserveRows = ["short", "long"]
      .map((name, index) => {
        const position = index + 1;
        const candidates = [
          `Operand ${position}: unavailable; unavailable_access\n`,
          `Operand ${position}: internal_failure; discovery failed; ${JSON.stringify(name)}\n`,
          `Operand ${position}: incomplete; output_limit_exceeded; ${JSON.stringify(name)}\n  Narrow this root.\n`,
          `Operand ${position}: returned; ${JSON.stringify(name)}\nNo eligible paths in this discovery.\n`,
        ];
        return candidates.sort(
          (a, b) => Buffer.byteLength(b) - Buffer.byteLength(a),
        )[0];
      })
      .join("");
    const allowance = Math.max(
      getTokenCount(target),
      Buffer.byteLength(`Batch: partial_result\n${reserveRows}`, "utf8"),
    );
    const selected = await discoverFindBatch(
      ["short", "long"],
      { root },
      {
        allowance,
        measure: textMeasure,
        backend,
        hasRtk: true,
      },
    );
    expect(selected.content).toContain('"short/s.ts"');
    expect(selected.content).toContain('"long/a.ts"');
    expect(selected.content).toContain('"long/b.ts"');
    expect(selected.content).not.toContain(
      JSON.stringify(`long/${longPaths[2]}`),
    );
    expect(selected.content).toContain("Narrow this root.");
  });

  it("measures exact CLI formatting and newline at fit and one token under", async () => {
    const root = await workspace();
    const entryParts = Array.from(
      { length: 5 },
      (_, i) => `${String.fromCharCode(97 + i).repeat(200)}.ts`,
    );
    const entry = entryParts.join("/");
    await fs.ensureDir(path.dirname(path.join(root, entry)));
    await fs.writeFile(path.join(root, entry), "eligible");
    const backend = () =>
      Promise.resolve({ stdout: `${entry}\n`, exitCode: 0 });
    const roomy = await discoverFindBatch(
      ["."],
      { root },
      {
        allowance: 1000,
        measure: cliMeasure,
        metadataBytes: cliBytes,
        backend,
        hasRtk: true,
      },
    );
    const exact = cliMeasure(roomy.content, roomy.isError);
    const atFit = await discoverFindBatch(
      ["."],
      { root },
      {
        allowance: exact,
        measure: cliMeasure,
        metadataBytes: cliBytes,
        backend,
        hasRtk: true,
      },
    );
    const under = await discoverFindBatch(
      ["."],
      { root },
      {
        allowance: exact - 1,
        measure: cliMeasure,
        metadataBytes: cliBytes,
        backend,
        hasRtk: true,
      },
    );
    expect(cliMeasure(atFit.content, atFit.isError)).toBe(exact);
    expect(cliResponse(atFit.content, atFit.isError)).toContain(
      JSON.stringify(entry),
    );
    expect(cliResponse(under.content, under.isError)).not.toContain(
      JSON.stringify(entry),
    );
    expect(cliMeasure(under.content, under.isError)).toBeLessThanOrEqual(
      exact - 1,
    );
  });

  it("measures injected MCP JSON-RPC envelopes with IDs, escaping, newlines, and error variants", async () => {
    const root = await workspace();
    const label = 'quoted"-根';
    await fs.mkdir(path.join(root, label));
    await fs.writeFile(path.join(root, label, 'entry"\\name.ts'), "eligible");
    const backend = () =>
      Promise.resolve({ stdout: `${label}/entry"\\name.ts\n`, exitCode: 0 });
    for (const id of [7, 'req/"8'] as const) {
      const successMeasure = mcpMeasure(id);
      const success = await discoverFindBatch(
        [label],
        { root },
        {
          allowance: 1000,
          measure: successMeasure,
          metadataBytes: mcpBytes(id),
          backend,
          hasRtk: true,
        },
      );
      const partialMeasure = mcpMeasure(id);
      const partial = await discoverFindBatch(
        ["missing", label],
        { root },
        {
          allowance: 1000,
          measure: partialMeasure,
          metadataBytes: mcpBytes(id),
          backend,
          hasRtk: true,
        },
      );
      const successEnvelope =
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            isError: false,
            content: [{ type: "text", text: success.content }],
          },
        }) + "\n";
      const partialEnvelope =
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: partial.content }],
          },
        }) + "\n";
      expect(successMeasure(success.content, false)).toBe(
        getTokenCount(successEnvelope),
      );
      expect(partialMeasure(partial.content, true)).toBe(
        getTokenCount(partialEnvelope),
      );
      expect(partialMeasure(partial.content, true)).toBeLessThanOrEqual(1000);
      expect(success.content).toContain('quoted\\"-根');
    }
  });

  it("rejects metadata-only overflow before backend enumeration", async () => {
    const root = await workspace();
    const backend = vi.fn(() => Promise.resolve({ stdout: "", exitCode: 0 }));
    const result = await discoverFindBatch(
      [".", "."],
      { root },
      {
        allowance: 40,
        validationAllowance: 1000,
        maximumAllowance: 8000,
        measure: textMeasure,
        backend,
        hasRtk: true,
      },
    );
    expect(result.status).toBe("output_limit_exceeded");
    expect(backend).not.toHaveBeenCalled();

    const requestId = "metadata-overflow/request-17";
    const mcpBackend = vi.fn(() =>
      Promise.resolve({ stdout: "", exitCode: 0 }),
    );
    const mcpResult = await discoverFindBatch(
      Array.from({ length: 50 }, () => "."),
      { root },
      {
        allowance: 80,
        validationAllowance: 1000,
        maximumAllowance: 8000,
        measure: mcpMeasure(requestId),
        metadataBytes: mcpBytes(requestId),
        backend: mcpBackend,
        hasRtk: true,
      },
    );
    expect(mcpResult.status).toBe("output_limit_exceeded");
    expect(mcpResult.content).toBe(
      "output_limit_exceeded: split discovery roots.\n",
    );
    expect(mcpMeasure(requestId)(mcpResult.content, true)).toBeLessThanOrEqual(
      80,
    );
    expect(mcpBackend).not.toHaveBeenCalled();
  });

  it("reserves every reachable single-root outcome at the conservative MCP boundary", async () => {
    const root = await workspace();
    const label = 'quoted"-根`';
    await fs.mkdir(path.join(root, label));
    const mcpId: string | number = 'find/"metadata"-17';
    const candidates = [
      `Operand 1: unavailable; unavailable_access\n`,
      `Operand 1: internal_failure; discovery failed; ${JSON.stringify(label).replace(/`/g, "\\u0060")}\n`,
      `Operand 1: incomplete; output_limit_exceeded; ${JSON.stringify(label).replace(/`/g, "\\u0060")}\n  Narrow this root.\n`,
      `Operand 1: returned; ${JSON.stringify(label).replace(/`/g, "\\u0060")}\n${EMPTY_FOR_TEST}`,
    ];
    const byteDelta = (text: string, isError: boolean) =>
      mcpBytes(mcpId)(text, isError) - mcpBytes(mcpId)("", isError);
    const conservativeBoundary =
      Math.max(mcpBytes(mcpId)("", true), mcpBytes(mcpId)("", false)) +
      Math.max(
        byteDelta("Batch: partial_result\n", true),
        byteDelta("Batch: partial_result\n", false),
      ) +
      Math.max(
        ...candidates.map((candidate) =>
          Math.max(byteDelta(candidate, true), byteDelta(candidate, false)),
        ),
      );
    const backend = vi.fn(() => Promise.resolve({ stdout: "", exitCode: 0 }));
    const admitted = await discoverFindBatch(
      [label],
      { root },
      {
        allowance: conservativeBoundary,
        measure: mcpMeasure(mcpId),
        metadataBytes: mcpBytes(mcpId),
        backend,
        hasRtk: true,
      },
    );
    expect(admitted.status).toBe("success");
    expect(backend).toHaveBeenCalledTimes(1);
    expect(
      mcpBytes(mcpId)(admitted.content, admitted.isError),
    ).toBeLessThanOrEqual(conservativeBoundary);

    const belowBackend = vi.fn(() =>
      Promise.resolve({ stdout: "", exitCode: 0 }),
    );
    const below = await discoverFindBatch(
      [label],
      { root },
      {
        allowance: conservativeBoundary - 1,
        measure: mcpMeasure(mcpId),
        metadataBytes: mcpBytes(mcpId),
        backend: belowBackend,
        hasRtk: true,
      },
    );
    expect(below.status).toBe("output_limit_exceeded");
    expect(belowBackend).not.toHaveBeenCalled();
    console.log("MCP conservative metadata boundary", {
      id: mcpId,
      allowance: conservativeBoundary,
      admittedResponseBytes: mcpBytes(mcpId)(
        admitted.content,
        admitted.isError,
      ),
      belowAllowance: conservativeBoundary - 1,
      belowStatus: below.status,
    });
  });

  it("checks a multi-root outcome matrix with independent complete transport measurements", async () => {
    const root = await workspace();
    const empty = 'empty"-根`';
    const many = "many";
    const special = "special";
    const failing = "failing";
    await fs.mkdir(path.join(root, empty));
    await fs.mkdir(path.join(root, many));
    await fs.mkdir(path.join(root, special));
    await fs.mkdir(path.join(root, failing));
    const specialName = 'quote"\\根`-path.ts';
    await fs.writeFile(path.join(root, special, specialName), "eligible");
    const longPathParts = Array.from(
      { length: 18 },
      (_, index) => `${index.toString(36)}-${randomBytes(90).toString("hex")}`,
    );
    await fs.ensureDir(path.join(root, many, ...longPathParts.slice(0, -1)));
    const longPath = path.join(many, ...longPathParts.slice(0, -1), "end.ts");
    await fs.writeFile(path.join(root, many, "short.ts"), "eligible");
    await fs.writeFile(path.join(root, longPath), "eligible");
    const transports = [
      { measure: cliMeasure, bytes: cliBytes },
      {
        measure: mcpMeasure(9017),
        bytes: mcpBytes(9017),
      },
      {
        measure: mcpMeasure('matrix/"escaped-17'),
        bytes: mcpBytes('matrix/"escaped-17'),
      },
    ];
    const backend = (operand: string) => {
      if (operand === failing) throw new Error("hidden exception marker");
      if (operand === empty) return { stdout: "", exitCode: 0 };
      if (operand === special)
        return { stdout: `${special}/${specialName}\n`, exitCode: 0 };
      if (operand === many)
        return {
          stdout: `${many}/short.ts\n${longPath}\n`,
          exitCode: 0,
        };
      return { stdout: "", exitCode: 0 };
    };
    for (const transport of transports) {
      const common = {
        validationAllowance: 1800,
        maximumAllowance: 8000,
        measure: transport.measure,
        metadataBytes: transport.bytes,
        backend: (operand: string) => Promise.resolve(backend(operand)),
        hasRtk: true,
      };
      const success = await discoverFindBatch(
        [empty, special],
        { root },
        { ...common, allowance: 1000 },
      );
      expect(success.status).toBe("success");
      expect(success.isError).toBe(false);
      expect(success.operands).toHaveLength(2);
      expect(success.content).toContain("Batch: success");
      expect(transport.measure(success.content, false)).toBeLessThanOrEqual(
        1000,
      );
      expect(transport.bytes(success.content, false)).toBeGreaterThan(0);

      const result = await discoverFindBatch(
        [empty, many, "missing-protected-root", failing, special],
        { root },
        { ...common, allowance: 1000 },
      );
      expect(result.operands.map(({ status }) => status)).toEqual([
        "returned",
        "incomplete",
        "unavailable",
        "internal_failure",
        "returned",
      ]);
      expect(result.content).toContain("Batch: partial_result");
      expect(result.isError).toBe(true);
      expect(result.content).toContain(EMPTY_FOR_TEST);
      expect(result.content).toContain("Narrow this root.");
      expect(result.content).toContain(
        "Operand 3: unavailable; unavailable_access",
      );
      expect(result.content).toContain("internal_failure; discovery failed");
      expect(result.content).toContain(
        JSON.stringify(`special/${specialName}`).replace(/`/g, "\\u0060"),
      );
      expect(result.content).not.toContain("missing-protected-root");
      expect(result.content).not.toContain("hidden exception marker");
      expect(transport.measure(result.content, true)).toBeLessThanOrEqual(1000);
      expect(transport.bytes(result.content, true)).toBeGreaterThan(0);
      console.log("Independent multi-root outcome matrix", {
        transport: transport.measure === cliMeasure ? "CLI" : "MCP",
        outcomeSequence: result.operands.map(({ status }) => status),
        successCompleteTokens: transport.measure(success.content, false),
        successSerializedBytes: transport.bytes(success.content, false),
        partialCompleteTokens: transport.measure(result.content, true),
        partialSerializedBytes: transport.bytes(result.content, true),
        allowance: 1000,
        concealedMissingRoot: !result.content.includes(
          "missing-protected-root",
        ),
      });
    }
  }, 20000);

  it("rejects a multi-root metadata response one complete-response token below its independent cost", async () => {
    const root = await workspace();
    const missing = Array.from(
      { length: 12 },
      (_, index) => `missing-${index}`,
    );
    const cases = [
      {
        measure: cliMeasure,
        metadataBytes: cliBytes,
        response: (body: string) => cliResponse(body, true),
      },
      {
        measure: mcpMeasure('metadata/"escaped-12'),
        metadataBytes: mcpBytes('metadata/"escaped-12'),
        response: (body: string) =>
          mcpResponse('metadata/"escaped-12', body, true),
      },
    ];
    const body =
      "Batch: partial_result\n" +
      missing
        .map(
          (_, index) =>
            `Operand ${index + 1}: unavailable; unavailable_access\n`,
        )
        .join("");
    for (const testCase of cases) {
      const completeCost = getTokenCount(testCase.response(body));
      const allowance = completeCost - 1;
      const backend = vi.fn(() => Promise.resolve({ stdout: "", exitCode: 0 }));
      const result = await discoverFindBatch(
        missing,
        { root },
        {
          allowance,
          validationAllowance: 1000,
          maximumAllowance: 8000,
          measure: testCase.measure,
          metadataBytes: testCase.metadataBytes,
          backend,
          hasRtk: true,
        },
      );
      expect(result.status).toBe("output_limit_exceeded");
      expect(backend).not.toHaveBeenCalled();
      expect(result.content).not.toContain("missing-");
      expect(testCase.measure(result.content, true)).toBeLessThanOrEqual(
        allowance,
      );
      console.log("Independent multi-root metadata under-bound", {
        completeResponseTokens: completeCost,
        allowance,
        resultStatus: result.status,
        enumerationCalls: backend.mock.calls.length,
      });
    }
  });

  it("rejects subminimum requests with default-budget guidance before enumeration", async () => {
    const root = await workspace();
    const manyRoots = Array.from({ length: 50 }, () => ".");
    const backend = vi.fn(() => Promise.resolve({ stdout: "", exitCode: 0 }));
    const tiny = await discoverFindBatch(
      manyRoots,
      { root },
      {
        allowance: 1,
        validationAllowance: 1000,
        maximumAllowance: 8000,
        measure: textMeasure,
        backend,
        hasRtk: true,
      },
    );
    const ceiling = await discoverFindBatch(
      manyRoots,
      { root },
      {
        allowance: 100,
        validationAllowance: 1000,
        maximumAllowance: 8000,
        increaseHint: "",
        measure: textMeasure,
        backend,
        hasRtk: true,
      },
    );
    const hinted = await discoverFindBatch(
      manyRoots,
      { root },
      {
        allowance: 100,
        validationAllowance: 1000,
        maximumAllowance: 8000,
        increaseHint: " A larger allowance up to 8000 tokens is supported",
        measure: textMeasure,
        backend,
        hasRtk: true,
      },
    );
    expect(tiny.status).toBe("usage_error");
    expect(tiny.content).toContain("Find needs at least");
    expect(textMeasure(tiny.content, true)).toBeLessThanOrEqual(1000);
    expect(backend).not.toHaveBeenCalled();
    expect(ceiling.content).not.toContain("increase the allowance");
    expect(hinted.content).toContain("increase the allowance");
  });

  it("reserves no operand text for unavailable roots, regardless of length", async () => {
    const root = await workspace();
    await createEligibleSibling(root);
    const shortRoot = "missing-secret-short";
    const longRoot = `missing-secret-${"x".repeat(6000)}`;
    const make = (operand: string) => {
      const measuredTexts: string[] = [];
      const backend = vi.fn(() =>
        Promise.resolve({ stdout: "ok/keep.ts\\n", exitCode: 0 }),
      );
      const result = discoverFindBatch(
        [operand, "ok"],
        { root },
        {
          allowance: 1000,
          measure: textMeasure,
          metadataBytes: (text, isError) => {
            measuredTexts.push(text);
            return textBytes(text, isError);
          },
          backend,
          hasRtk: true,
        },
      );
      return { result, backend, measuredTexts };
    };
    const short = make(shortRoot);
    const long = make(longRoot);
    const [shortResult, longResult] = await Promise.all([
      short.result,
      long.result,
    ]);
    expect(shortResult.status).toBe(longResult.status);
    expect(shortResult.content).toBe(longResult.content);
    expect(shortResult.content).not.toContain(shortRoot);
    expect(shortResult.content).not.toContain("missing-secret");
    expect(short.measuredTexts.join("\\n")).not.toContain(shortRoot);
    expect(long.measuredTexts.join("\\n")).not.toContain(longRoot);
    expect(short.backend).toHaveBeenCalledTimes(1);
    expect(long.backend).toHaveBeenCalledTimes(1);
  });

  it("retains successful siblings after backend failure and missing RTK is request-wide", async () => {
    const root = await workspace();
    await createEligibleSibling(root);
    let calls = 0;
    const mixed = await discoverFindBatch(
      ["ok", "ok"],
      { root },
      {
        allowance: 1000,
        measure: textMeasure,
        backend: () =>
          ++calls === 1
            ? Promise.reject(new Error("secret-exception"))
            : Promise.resolve({ stdout: "ok/keep.ts\n", exitCode: 0 }),
        hasRtk: true,
      },
    );
    expect(mixed.content).toContain("internal_failure; discovery failed");
    expect(mixed.content).not.toContain("secret-exception");
    expect(mixed.content).toContain('"ok/keep.ts"');
    const backend = vi.fn(() => Promise.resolve({ stdout: "", exitCode: 0 }));
    const noRtk = await discoverFindBatch(
      ["ok", "ok"],
      { root },
      { allowance: 1000, measure: textMeasure, backend, hasRtk: false },
    );
    expect(noRtk.status).toBe("engine_failure");
    expect(noRtk.content).not.toContain("Operand 1:");
    expect(backend).not.toHaveBeenCalled();
  });
});
