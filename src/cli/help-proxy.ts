import type { HelpTopic } from "./help-topic";

/** Proxy documentation lives separately from native command content. */
export const PROXY_HELP: Record<string, HelpTopic> = {
  ls: {
    title: "ls — List eligible workspace entries",
    purpose:
      "Inspect a workspace directory through Spekta's disclosure policy.",
    usage: ["spekta ls [directory]"],
    complete: false,
  },
  find: {
    title: "find — Discover eligible workspace paths",
    purpose: "Discover paths using supported directory and predicate forms.",
    usage: ["spekta find [directory] [-type f|d] [-name pattern] [-print]"],
    complete: false,
  },
  git: {
    title: "git — Inspect repository state and history",
    purpose: "Use supported Git inspections under Spekta's disclosure policy.",
    usage: [
      "spekta git <status|log|show|diff|branch> [arguments]",
      "spekta help git diff",
    ],
    complete: false,
    sections: [
      { heading: "Topics", lines: ["status, log, show, diff, branch"] },
    ],
  },
  "git status": {
    title: "git status — Inspect working tree status",
    purpose: "Show repository status for eligible workspace paths.",
    usage: ["spekta git status [options] [-- paths...]"],
    complete: false,
  },
  "git log": {
    title: "git log — Inspect commit history",
    purpose: "Show supported history patches or file summaries.",
    usage: ["spekta git log [options] [revisions...] [-- paths...]"],
    complete: false,
  },
  "git show": {
    title: "git show — Inspect a commit or file blob",
    purpose:
      "Show supported commit patches, summaries or eligible file content.",
    usage: ["spekta git show [options] [revision|revision:path] [-- paths...]"],
    complete: false,
  },
  "git diff": {
    title: "git diff — Inspect changes",
    purpose: "Show supported working tree, staged or revision differences.",
    usage: ["spekta git diff [options] [revisions...] [-- paths...]"],
    complete: false,
  },
  "git branch": {
    title: "git branch — List branches",
    purpose: "Inspect branches using supported listing forms.",
    usage: ["spekta git branch [listing options] [patterns...]"],
    complete: false,
  },
};
