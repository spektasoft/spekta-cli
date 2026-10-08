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
    const supportedRequests = realRequests.filter(
      (args) =>
        args[0] === "branch" &&
        !args.includes("--verbose") &&
        !args.includes("-v"),
    );
    it.each(supportedRequests.map((args) => ({ args })))(
      "preserves branch listing meaning for $args in both adapters",
      async ({ args }) => {
        const before = ["diff", "branch"].includes(args[0])
          ? snapshotRepository()
          : undefined;
        const reference = await git(["--no-pager", ...args]);
        expect(reference.exitCode).toBe(0);
        const raw = [reference.stdout, reference.stderr]
          .filter(Boolean)
          .join("\n");
        const expected = redactSecrets(
          truncateOutput(
            raw
              .split("\n")
              .map((line) => line.replace(/^\s+/, ""))
              .join("\n"),
          ).content,
        );
        const original = [...args];
        const { cli, mcp } = await both(args);
        if (before !== undefined) expect(snapshotRepository()).toEqual(before);
        expect(mcp.isError, `${args.join(" ")}: ${mcp.content[0].text}`).toBe(
          false,
        );
        expect(mcp.content[0].text).toBe(expected);
        expect(cli).toContain(expected);
        expect(cli).toContain("### spekta git");
        expect(cli).not.toContain(secret);
        expect(mcp.content[0].text).not.toContain(secret);
        expect(args).toEqual(original);
        expect(console.error).not.toHaveBeenCalled();
      },
      30000,
    );
  },
);
