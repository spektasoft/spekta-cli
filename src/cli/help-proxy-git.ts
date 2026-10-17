import type { HelpTopic } from "./help-topic";

export const PROXY_GIT_HELP: Record<string, HelpTopic> = {
  git: {
    title: "git — Inspect repository state and history",
    purpose:
      "Inspect supported parts of a repository through Spekta's path and disclosure policies.",
    usage: [
      "spekta git <status|log|show|diff|branch> [arguments]",
      "spekta help git <status|log|show|diff|branch>",
    ],
    sections: [
      {
        heading: "Supported subcommands",
        lines: [
          "status lists eligible working-tree changes.",
          "log lists eligible file changes across commits or shows eligible patches.",
          "show inspects one revision, a patch or summary, or an eligible revision:path blob.",
          "diff inspects working-tree, staged, or revision-to-revision changes.",
          "branch lists local or remote branch names.",
          "Each subcommand has its own option and response rules; see its help topic for accepted syntax.",
          "Every Git inspection accepts one --allowance <tokens> option. SPEKTA_GIT_TOKEN_LIMIT defaults to 1,000 tokens; SPEKTA_GIT_TOKEN_CEILING defaults to 8,000 tokens.",
          "All Git topics require a Git repository and RTK to run. Help does not invoke Git or RTK.",
          "Unsupported native Git options, pathspec magic, workspace overrides, and mutating commands such as commit, checkout, switch, create, or delete are outside this interface.",
        ],
      },
    ],
    examples: [
      "spekta git status --short",
      "spekta help git diff",
      "spekta git branch --list 'feature/*'",
    ],
    complete: true,
  },
};
