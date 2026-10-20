import type { HelpTopic } from "./help-topic";

export const PROXY_GIT_CHECK_IGNORE_HELP: Record<string, HelpTopic> = {
  "git check-ignore": {
    title: "git check-ignore — Check Git ignore status",
    purpose:
      "Report whether one accessible workspace path matches Git ignore rules.",
    usage: ["spekta git check-ignore [--allowance <tokens>] [--] <path>"],
    sections: [
      {
        heading: "Path and response",
        lines: [
          "Supply exactly one literal workspace path. Use -- before a path that begins with a dash.",
          "Returns only git_ignored or not_git_ignored for an accessible path. The check follows Git status --no-index semantics, including tracked paths.",
          "Unavailable paths and Git failures return generic errors without revealing paths or ignore rules. A directory is checked as a path; descendants are not listed.",
          "This command requires Git and a Git repository but does not require RTK.",
        ],
      },
    ],
    examples: [
      "spekta git check-ignore src/generated.ts",
      "spekta git check-ignore -- '-generated.ts'",
    ],
    complete: true,
  },
};
