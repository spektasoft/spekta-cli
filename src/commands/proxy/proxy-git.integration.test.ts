import { describe, expect, it } from "vitest";
import { redactSecrets } from "./proxy-secret-redaction";
import { truncateOutput } from "./proxy-output";
import {
  useRealGitFixture,
  missing,
  secret,
} from "./proxy-git.integration-harness";
import { realRequests } from "./proxy-git.integration-cases";

describe.skipIf(missing.length > 0)(
  `real Git/RTK inspection${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  () => {
    const context = useRealGitFixture();
    const { git, snapshotRepository, both } = context;
    it.each(
      realRequests
        .filter((args) => args[0] !== "status")
        .map((args) => ({ args })),
    )(
      "preserves native Git meaning for $args in both adapters",
      async ({ args }) => {
        const history = ["log", "show", "diff"].includes(args[0]);
        const before = ["diff", "branch"].includes(args[0])
          ? snapshotRepository()
          : undefined;
        // Independent reference from the user grammar, not from prepareRtkInvocation.
        const reference = await git([
          "--no-pager",
          "--literal-pathspecs",
          ...(args[0] === "diff" ? ["-c", "diff.autoRefreshIndex=false"] : []),
          args[0],
          ...(history ? ["--no-ext-diff", "--no-textconv"] : []),
          ...(args[0] === "diff" ? ["--submodule=short"] : []),
          ...args.slice(1),
          ...(history && !args.includes("--") ? ["--"] : []),
        ]);
        expect(reference.exitCode).toBe(0);
        const raw = [reference.stdout, reference.stderr]
          .filter(Boolean)
          .join("\n");
        const expected = redactSecrets(truncateOutput(raw).content);
        const original = [...args];
        const { cli, mcp } = await both(args);
        if (before !== undefined) expect(snapshotRepository()).toEqual(before);
        expect(mcp.isError).toBe(false);
        expect(mcp.content[0].text).toBe(expected);
        expect(cli).toContain(expected);
        expect(cli).toContain("### spekta git");
        expect(cli).not.toContain(secret);
        expect(mcp.content[0].text).not.toContain(secret);
        expect(args).toEqual(original);
        expect(console.error).not.toHaveBeenCalled();
      },
    );
  },
);
