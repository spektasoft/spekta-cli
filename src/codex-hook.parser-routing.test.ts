import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteEvent } from "./codex-hook.js";
import {
  event,
  rewritten,
  shellQuoteForTest,
} from "./codex-hook.test-helpers.js";

describe("Codex inspection hook routing boundaries", () => {
  it("leaves explicit RTK commands unchanged", () => {
    for (const command of [
      "rtk cat ~/.codex/skills/example/SKILL.md",
      "rtk rg needle ~/.codex/skills",
      "rtk rg --no-config needle",
    ]) {
      expect(rewriteEvent(event(command))).toBeUndefined();
    }
  });

  it("leaves external home and temporary read/search operands on the host route", () => {
    const homeSkill = join(
      homedir(),
      ".codex",
      "skills",
      "special skill",
      "SKILL.md",
    );
    const temporary = join(tmpdir(), "special [skill] fixture.md");

    expect(rewritten(`cat ${shellQuoteForTest(homeSkill)}`)).toBeUndefined();
    expect(
      rewritten(`sed -n '1,4p' ${shellQuoteForTest(homeSkill)}`),
    ).toBeUndefined();
    expect(
      rewritten(`rg -e needle ${shellQuoteForTest(temporary)}`),
    ).toBeUndefined();
    expect(
      rewritten(`rg needle src ${shellQuoteForTest(temporary)}`),
    ).toBeUndefined();
    expect(rewritten("cat ../outside/SKILL.md")).toBeUndefined();
  });

  it("keeps workspace-spelled symlink reads on the Spekta route", () => {
    const workspace = mkdtempSync(join(tmpdir(), "spekta-hook-workspace-"));
    const external = mkdtempSync(join(tmpdir(), "spekta-hook-external-"));
    try {
      symlinkSync(external, join(workspace, "skills"));
      const raw = rewriteEvent({
        ...event("cat 'skills/special skill/SKILL.md'"),
        cwd: workspace,
      });
      expect(raw).toBe(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: {
              command: "'spekta' 'read' 'skills/special skill/SKILL.md'",
            },
          },
        }),
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });
});
