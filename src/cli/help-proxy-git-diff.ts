import type { HelpTopic } from "./help-topic";

export const PROXY_GIT_DIFF_HELP: Record<string, HelpTopic> = {
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
          "Eligible files are filtered before output. Summary output that exceeds the configured Git response budget fails with guidance to narrow the request. Patch output is truncated to fit the complete configured Git response budget and marked.",
          "Diff is a native tracked comparison and does not include new untracked content. Empty diff output does not establish that the whole workspace is unchanged.",
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
};
