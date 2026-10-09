import type { HelpTopic } from "./help-topic";

/** Supported proxy forms documented from their request classifiers and policies. */
export const PROXY_HELP: Record<string, HelpTopic> = {
  ls: {
    title: "ls — List eligible workspace entries",
    purpose:
      "List eligible entries directly inside a workspace directory. Each name is checked against workspace, ignore, and restricted-file policy before it is shown.",
    usage: ["spekta ls [directory]"],
    sections: [
      {
        heading: "Operands and limits",
        lines: [
          "directory is one existing directory relative to the workspace; it defaults to .",
          "ls has no operational options and does not recurse into child directories.",
          "Only eligible entries are disclosed. A directory entry may be listed even when its contents are not eligible.",
          "The 1,000-token response budget includes the complete CLI response. Spekta truncates a long listing and marks it as truncated.",
          "RTK must be installed to run ls. Help does not need RTK.",
        ],
      },
    ],
    examples: ["spekta ls", "spekta ls src", "spekta ls 'folder with spaces'"],
    complete: true,
  },
  find: {
    title: "find — Discover eligible workspace paths",
    purpose:
      "Search below a workspace directory with a small set of find predicates, then disclose only eligible paths.",
    usage: [
      "spekta find [directory] [-type f|d] [-name pattern] [-print]",
      "spekta find [-type f|d] [-name pattern] [-print]",
    ],
    sections: [
      {
        heading: "Operands and predicates",
        lines: [
          "directory is one existing relative workspace directory and defaults to .; a leading predicate also uses this default root.",
          "-type accepts one value: f for files or d for directories.",
          "-name accepts one nonempty pattern. Quote shell globs so the pattern reaches Spekta unchanged; it is interpreted by find as a name pattern, not as a path operand.",
          "Use -type and -name together in either order. Each predicate may appear once.",
          "-print is optional and, when present, must be the final token. It prints matching paths.",
          "Find traverses beneath the selected root, but does not follow directory symlinks. Spekta filters matches using workspace and eligible-file policy, including ignored and restricted paths.",
          "The 1,000-token response budget includes the complete CLI response. Spekta truncates a long listing and marks it as truncated.",
          "RTK and the find backend must be available to run find. Help does not invoke either one.",
          "Native find options, expressions, actions, absolute roots, and a -- separator are unsupported.",
        ],
      },
    ],
    examples: [
      "spekta find",
      "spekta find -name '*.md'",
      "spekta find . -type f -name '*.ts'",
      "spekta find src -type f -name '*.ts' -print",
      "spekta find 'folder with spaces' -type d",
    ],
    complete: true,
  },
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
  "git status": {
    title: "git status — Inspect working tree status",
    purpose:
      "List status records for eligible workspace paths in the current repository.",
    usage: ["spekta git status [options] [-- paths...]"],
    sections: [
      {
        heading: "Options and operands",
        lines: [
          "Accepted options: -s or --short; -b or --branch; --porcelain, --porcelain=v1, or --porcelain=v2; and --untracked-files=no|normal|all.",
          "Put options before --. Path operands follow -- and are literal workspace paths; quote names containing spaces. Without paths, the repository is inspected.",
          "A path that begins with - must follow --. Git pathspec patterns and magic are unsupported.",
          "Spekta removes ineligible paths from the result. The 1,000-token response budget includes the complete CLI response; long status output is truncated and marked.",
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
  "git log": {
    title: "git log — Inspect commit history",
    purpose:
      "Show eligible file changes as a summary or patch for selected commits.",
    usage: ["spekta git log [options] [revisions...] [-- paths...]"],
    sections: [
      {
        heading: "Options and operands",
        lines: [
          "Choose a supported output form: -p or --patch; --stat; --name-only; or --name-status. A summary option cannot be combined with a patch option; --no-patch alone does not select a supported output form.",
          "-n <positive-count> and --max-count=<positive-count> limit commits; specify at most one count option. Patch output defaults to 10 commits when no count is given.",
          "Revision operands may be branch or tag names, object IDs, or simple parent forms such as HEAD~2^0. A log revision may also use one .. or ... range, including an omitted endpoint such as ..HEAD.",
          "Put options and revisions before --. Optional path operands follow --, are literal workspace paths, and may include spaces when quoted. Without paths, the operation uses the repository paths.",
          "Commit messages, graph or all-refs output, decorations, reflog selectors, Git pathspec magic, and unsupported native options are not disclosed through this interface.",
          "Eligible paths are filtered before output. Summary output that exceeds the 1,000-token response budget fails with guidance to narrow the request. Patch output is truncated to fit the complete 1,000-token response budget and marked.",
          "RTK and a Git repository are required to run this command. Help does not invoke either one.",
        ],
      },
    ],
    examples: [
      "spekta git log --stat -n 5 main..HEAD",
      "spekta git log --stat main..HEAD -- 'src/file name.ts'",
      "spekta git log --patch -n 2 -- 'src/file name.ts'",
      "spekta git log --name-status main...HEAD -- 'src/file.ts'",
    ],
    complete: true,
  },
  "git show": {
    title: "git show — Inspect a commit or file blob",
    purpose:
      "Show one commit's eligible changes, a supported summary, or one eligible historical file.",
    usage: ["spekta git show [options] [revision|revision:path] [-- paths...]"],
    sections: [
      {
        heading: "Options and operands",
        lines: [
          "Show accepts at most one revision or revision:path blob selector. Revision forms include names, object IDs, and simple parent forms such as HEAD^ or HEAD~2.",
          "For commit output, choose -p or --patch, --stat, --name-only, or --name-status. Summary options cannot be combined with a patch option; --no-patch alone does not select a supported summary. With no revision, the commit form uses HEAD.",
          "For a blob, use revision:path with a relative repository path. A blob selector cannot be combined with additional path operands.",
          "For commit output, put options and the revision before --; optional literal workspace paths follow it. Paths must be eligible. Git pathspec magic, reflog selectors, and unsupported native options are rejected.",
          "Eligible files are filtered before output. Summary output that exceeds the 1,000-token response budget fails with guidance to narrow the request. Patch and blob output are truncated to fit the complete 1,000-token response budget and marked.",
          "RTK and a Git repository are required to run this command. Help does not invoke either one.",
        ],
      },
    ],
    examples: [
      "spekta git show HEAD",
      "spekta git show --stat HEAD -- 'src/file name.ts'",
      "spekta git show HEAD:src/file.ts",
    ],
    complete: true,
  },
  "git diff": {
    title: "git diff — Inspect changes",
    purpose:
      "Show supported working-tree, staged, or revision-to-revision changes for eligible files.",
    usage: ["spekta git diff [options] [revisions...] [-- paths...]"],
    sections: [
      {
        heading: "Options and operands",
        lines: [
          "Choose -p or --patch, --no-patch, --stat, --name-only, or --name-status. A summary option cannot be combined with a patch option.",
          "--cached or --staged selects staged changes and may appear once. It accepts at most one revision; without it, diff accepts up to two revisions.",
          "A single revision compares the worktree with that revision. Two revisions compare them. A .. or ... range is allowed only as the sole revision operand and cannot be combined with --cached or --staged.",
          "Put options and revisions before --. Optional path operands follow -- and are literal workspace paths; quote names containing spaces. Without paths, the repository paths are inspected.",
          "Eligible files are filtered before output. Summary output that exceeds the 1,000-token response budget fails with guidance to narrow the request. Patch output is truncated to fit the complete 1,000-token response budget and marked.",
          "Binary patch data, combined patches, Git pathspec magic, and unsupported native options are rejected. RTK and a Git repository are required to run this command.",
        ],
      },
    ],
    examples: [
      "spekta git diff --stat",
      "spekta git diff --cached --name-status HEAD -- 'src/file name.ts'",
      "spekta git diff main...HEAD -- 'src/file name.ts'",
    ],
    complete: true,
  },
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
          "The 1,000-token response budget includes the complete CLI response. Spekta truncates a long listing and marks it as truncated.",
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
