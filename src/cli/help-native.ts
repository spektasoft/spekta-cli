import type { HelpTopic } from "./help-topic";

export const NATIVE_HELP: Record<string, HelpTopic> = {
  read: {
    title: "read — Read eligible workspace files",
    purpose:
      "Print file content and line/token metadata, compacting full files when applicable.",
    usage: [
      "spekta read <path[range]>... [--save]",
      "spekta read [--save]",
      "spekta help read",
    ],
    complete: true,
    sections: [
      {
        heading: "Operands and ranges",
        lines: [
          "Direct reading requires one or more literal file paths; multiple paths are combined in one response.",
          "Paths are relative to the current workspace; absolute paths must remain inside it. No glob expansion is provided by Spekta.",
          "Optionally append [start,end] for inclusive, 1-based line ranges; $ means the last line.",
          "path[10,20] reads lines 10–20; path[10,$] or path[10] reads from line 10 to EOF.",
          "path[,20] starts at line 1; path[] reads the full file as an explicit range.",
          "Quote paths containing spaces, brackets or $ to protect them from shell expansion.",
          "With no paths, the interactive Git-backed file picker lets you select files/ranges and opens an editor on request. Final output is saved.",
        ],
      },
      {
        heading: "Options and saving",
        lines: [
          "--save  Save rendered output to a temporary spekta-read-<timestamp>.md file, reporting its path.",
          "Without --save, direct reads print to stdout. --save does not take an output-path value.",
          "SPEKTA_EDITOR opens saved output unless SPEKTA_NO_EDITOR=1. With no editor, saved content is also printed.",
          "--help or -h as the first or final argument shows this topic; help read is equivalent.",
          "For a file named --help or -h, use ./--help or ./-h. read has no -- separator; quoting alone cannot distinguish a help flag in argv.",
        ],
      },
      {
        heading: "Defaults and response budgets",
        lines: [
          "SPEKTA_READ_TOKEN_LIMIT defaults to 1000 tokens for the complete response, including metadata and formatting.",
          "SPEKTA_COMPACT_THRESHOLD defaults to 500 tokens. Full-file direct reads above this threshold attempt syntax-aware compaction; unsupported files may remain uncompressed with a warning.",
          "Explicit ranges return original lines without compaction. Choose a narrower range when content exceeds the response budget.",
          "Oversized results exit nonzero and report incomplete content or bounded guidance. --save uses the same bounded result.",
          "The interactive picker bypasses per-file compaction and range checks; the final combined response is still bounded.",
          "Configuration precedence is shell environment, workspace .env, then personal Spekta .env. Invalid read limits fall back to 1000; invalid compaction thresholds fall back to 500 (zero is allowed).",
          "Direct read and help require no AI provider credentials. Interactive selection requires Git.",
        ],
      },
      {
        heading: "Restrictions",
        lines: [
          "Only eligible files inside the workspace may be disclosed. Outside paths and symlink escapes are rejected.",
          "Git ignore and Spekta ignore rules apply; explicit Spekta negations can allow Git-ignored files.",
          "Restricted filenames .env, .gitignore and .spektaignore cannot be read, and files larger than 10 MB are rejected.",
          "Unavailable files, policy rejections and read failures exit nonzero. Help performs no read, save or initialization.",
        ],
      },
    ],
    examples: [
      "spekta read README.md",
      "spekta read 'src/index.ts[10,20]'",
      "spekta read 'src/index.ts[50,$]' README.md --save",
      "spekta read './notes with spaces.md[,20]'",
      "spekta read ./--help",
      "spekta read",
    ],
  },
};
