import type { HelpTopic } from "./help-topic";

export const PROXY_GIT_STATUS_HELP: Record<string, HelpTopic> = {
  "git status": {
    title: "git status — Inspect working tree status",
    purpose:
      "List status records for eligible workspace paths in the current repository.",
    usage: ["spekta git status [options] [--allowance <tokens>] [-- paths...]"],
    sections: [
      {
        heading: "Options and operands",
        lines: [
          "Accepted options: -s or --short; -b or --branch; --porcelain, --porcelain=v1, or --porcelain=v2; and --untracked-files=no|normal|all.",
          "Put options before --. Path operands follow -- and are literal workspace paths; quote names containing spaces. Without paths, the repository is inspected.",
          "A path that begins with - must follow --. Git pathspec patterns and magic are unsupported.",
          "Spekta removes ineligible paths from the result. The configured Git response budget includes the complete CLI response; long status output is truncated and marked.",
          "Status describes eligible native Git status: eligible untracked entries may appear; native ignored untracked entries do not. Excluded paths are omitted without identifying them.",
          "RTK and a Git repository are required to run this command. Help does not invoke either one.",
        ],
      },
    ],
    examples: [
      "spekta git status",
      "spekta git status --short -- 'src/file name.ts'",
      "spekta git status --branch --porcelain=v2",
    ],
    complete: true,
  },
};
