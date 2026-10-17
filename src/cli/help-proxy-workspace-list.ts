import type { HelpTopic } from "./help-topic";
import { resolveAllowanceSettings } from "../core/config/allowance";

export function listAllowanceHelp(): string {
  const settings = resolveAllowanceSettings("list");
  return `--allowance <tokens> requests a positive whole-number allowance for the complete response. The default is SPEKTA_LIST_TOKEN_LIMIT (${settings.defaultTokens}); it cannot exceed SPEKTA_LIST_TOKEN_CEILING (${settings.ceilingTokens}).`;
}

export const PROXY_WORKSPACE_LIST_HELP: Record<string, HelpTopic> = {
  ls: {
    title: "ls — List eligible workspace entries",
    purpose:
      "List eligible entries directly inside one or more workspace directories. Each name is checked against workspace, ignore, and restricted-file policy before it is shown.",
    usage: ["spekta ls [--allowance <tokens>] [directory...]"],
    sections: [
      {
        heading: "Operands and limits",
        lines: [
          "Supply one or more literal directory paths. Each is resolved independently relative to the workspace; with no directory, ls lists .",
          "Results are labeled by operand and retain complete eligible entries. An unavailable directory is reported by operand position without disclosing its name.",
          "An empty result means no eligible entries in this listing; excluded entries may exist.",
          "A listing that cannot fit is marked incomplete and includes narrowing guidance. Entries are never split, and there is no pagination.",
          listAllowanceHelp(),
          "RTK must be installed to run ls. Help does not need RTK.",
        ],
      },
    ],
    examples: [
      "spekta ls",
      "spekta ls src .github",
      "spekta ls 'folder with spaces'",
      "spekta ls --allowance 2000 src test",
    ],
    complete: true,
  },
};
