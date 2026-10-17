import type { HelpTopic } from "./help-topic";

export const PROXY_GIT_BRANCH_HELP: Record<string, HelpTopic> = {
  "git branch": {
    title: "git branch — List branches",
    purpose:
      "List branch names from the current repository, optionally filtered by branch-name patterns.",
    usage: ["spekta git branch [listing options] [-- patterns...]"],
    sections: [
      {
        heading: "Options and operands",
        lines: [
          "This command is listing-only. Accepted options are --list or -l, --all or -a, --remotes or -r, and --verbose or -v. Verbose mode still discloses branch names only; upstream and commit text are omitted.",
          "A pattern requires explicit --list or -l. Quote shell globs so Git receives them as branch-name patterns. Patterns filter names and are not workspace paths.",
          "With --list, an optional -- separates options from patterns. It does not introduce file paths.",
          "The configured Git response budget includes the complete CLI response. Spekta truncates a long listing and marks it as truncated.",
          "Creating, deleting, renaming, switching, and other branch mutations are unsupported. RTK and a Git repository are required to run this command.",
        ],
      },
    ],
    examples: [
      "spekta git branch",
      "spekta git branch --list 'feature/*'",
      "spekta git branch --all --list -- 'release/*'",
    ],
    complete: true,
  },
};
