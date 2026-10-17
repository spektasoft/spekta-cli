import type { BuildMetadata } from "../build-identity";
import type { AllowanceFamily } from "../core/config/allowance";
import { resolveAllowanceSettings } from "../core/config/allowance";

export type CodexComponentState =
  "absent" | "configured" | "conflicting" | "broken" | "verified";

export interface CodexComponentStatus {
  state: CodexComponentState;
  details: string[];
}

export interface CodexStatus {
  running: { executable: string; artifactSha256: string };
  build: BuildMetadata;
  sourceCorrespondence: "unknown";
  routing:
    | { event: "PreToolUse"; matcher: string; target: "spekta-codex-hook" }
    | "unknown";
  components: {
    hooks: CodexComponentStatus;
    instructions: CodexComponentStatus;
    mcp: CodexComponentStatus;
  };
  trust: "unknown";
  activation: "unknown";
  allowances: Record<
    AllowanceFamily,
    ReturnType<typeof resolveAllowanceSettings>
  >;
  verificationSteps: string[];
}
