import type { HelpTopic } from "./help-topic";

function createGitHistoryHelp(): Record<string, HelpTopic> {
  return {
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
            "Eligible paths are filtered before output. Summary output that exceeds the configured Git response budget fails with guidance to narrow the request. Patch output is truncated to fit the complete configured Git response budget and marked.",
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
      usage: [
        "spekta git show [options] [revision|revision:path] [-- paths...]",
      ],
      sections: [
        {
          heading: "Options and operands",
          lines: [
            "Show accepts at most one revision or revision:path blob selector. Revision forms include names, object IDs, and simple parent forms such as HEAD^ or HEAD~2.",
            "For commit output, choose -p or --patch, --stat, --name-only, or --name-status. Summary options cannot be combined with a patch option; --no-patch alone does not select a supported summary. With no revision, the commit form uses HEAD.",
            "For a blob, use revision:path with a relative repository path. A blob selector cannot be combined with additional path operands.",
            "For commit output, put options and the revision before --; optional literal workspace paths follow it. Paths must be eligible. Git pathspec magic, reflog selectors, and unsupported native options are rejected.",
            "Eligible files are filtered before output. Summary output that exceeds the configured Git response budget fails with guidance to narrow the request. Patch and blob output are truncated to fit the complete configured Git response budget and marked.",
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
  };
}

export const PROXY_GIT_HISTORY_HELP = createGitHistoryHelp();
