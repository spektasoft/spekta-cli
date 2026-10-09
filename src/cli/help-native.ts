import type { HelpTopic } from "./help-topic";

const topic = (
  title: string,
  purpose: string,
  usage: string[],
  sections: { heading: string; lines: string[] }[],
  examples: string[],
): HelpTopic => ({ title, purpose, usage, sections, examples, complete: true });

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
  commit: topic(
    "commit — Prepare a commit message",
    "Build a prompt from staged changes, generate a message, or create a Git commit.",
    [
      "spekta commit [--prompt-only | --message | --commit] [options]",
      "spekta commit --interactive [options]",
    ],
    [
      {
        heading: "Modes",
        lines: [
          "With no options, create and open a prompt from the staged diff without calling an AI provider.",
          "--prompt-only explicitly selects prompt-only mode. Without --stdout, prompt output is saved to a temporary file without opening an editor; --stdout prints it directly without saving a file.",
          "--message generates a commit message; noninteractive use requires --model <provider-name|model-id>.",
          "--commit generates a message and commits directly; noninteractive use requires --model. It does not ask for confirmation.",
          "--interactive opens provider selection. Choosing Only Prompt saves the prompt; generated messages are reviewed and require confirmation before commit.",
        ],
      },
      {
        heading: "Options and restrictions",
        lines: [
          "--model <name|id> selects exactly one configured provider by provider name or model ID; it is valid with --message or --commit.",
          "For --message, output is saved to a temporary file and may be opened unless --stdout prints the generated message directly. --stdout cannot be combined with --commit.",
          "--no-editor suppresses the editor for prompt or generated output; it does not change the selected operation.",
          "--interactive cannot be combined with an explicit mode. Only one of --prompt-only, --message and --commit is allowed.",
          "A staged diff is required. Direct commit mode is an operational Git commit; help never inspects or changes the repository.",
        ],
      },
    ],
    [
      "spekta commit --prompt-only --stdout",
      "spekta commit --message --model openai",
      "spekta commit --commit --model gpt-4.1",
      "spekta commit --interactive",
    ],
  ),
  repl: topic(
    "repl — Start an AI refactoring session",
    "Open a persistent conversational coding session with a configured provider.",
    ["spekta repl"],
    [
      {
        heading: "Behavior",
        lines: [
          "The REPL prompts for a provider, saves the session history, and starts an interactive tool session.",
          "It requires provider configuration and remains open until you exit or interrupt it with Ctrl+C.",
          "There are no command options or positional arguments. Help exits before provider setup or session startup.",
        ],
      },
    ],
    ["spekta repl"],
  ),
  prompt: topic(
    "prompt — Render a configured prompt",
    "Select and render a custom or composable prompt, optionally including selected partials.",
    ["spekta prompt [selector] [options]"],
    [
      {
        heading: "Arguments and options",
        lines: [
          "selector is one configured prompt name or filename. Omit it to choose from an interactive list.",
          "--output <path> writes to this path. Otherwise the prompt's default_output template is used when present, then the uncategorized Spekta prompt directory.",
          "--stdout prints the rendered prompt and takes precedence over all file destinations; no file is written and no editor opens.",
          "--include-partial <name[,name...]> and --exclude-partial <name[,name...]> select prompt partials. Repeat either option to add more names.",
          "When a selector is supplied without partial options, the prompt's defaults apply. Without a selector or partial options, the interactive flow asks which partials to include.",
          "--no-editor suppresses SPEKTA_EDITOR when writing a file. Only one selector is accepted; unknown options are rejected.",
        ],
      },
    ],
    [
      "spekta prompt ReleaseNotes --stdout",
      "spekta prompt ReleaseNotes --output ./release.md --no-editor",
      "spekta prompt ReleaseNotes --include-partial changelog,tests --exclude-partial private",
      "spekta prompt",
    ],
  ),
  review: topic(
    "review — Generate a Git review prompt",
    "Prepare an initial or follow-up review prompt from a selected commit range and prior review context.",
    ["spekta review"],
    [
      {
        heading: "Behavior",
        lines: [
          "Interactive prompts choose an initial review or continue a previous review, then select or enter a commit range.",
          "The initial review can collect supplemental context. Follow-up reviews include the previous review when available.",
          "The generated prompt is saved in Spekta's review directory and opened with SPEKTA_EDITOR when configured; otherwise its path is printed.",
          "There are no command options or positional arguments. Git and configured review prompt files are required; help does not prompt or create a review.",
        ],
      },
    ],
    ["spekta review"],
  ),
  grep: topic(
    "grep — Search eligible workspace files",
    "Search a workspace path with Spekta's bounded, policy-aware ripgrep integration.",
    ["spekta grep <pattern> [path] [--ignore-case] [--glob <glob>]..."],
    [
      {
        heading: "Arguments and options",
        lines: [
          "pattern is the first positional argument and must be nonempty; it is a ripgrep regular expression. path is the next positional argument when it does not begin with a dash; otherwise path defaults to the workspace root (.).",
          "--glob <glob> adds a file glob; repeat it to include multiple glob filters. Matching uses ripgrep smart-case: lowercase patterns match without case sensitivity, while uppercase patterns trigger case-sensitive matching. --ignore-case forces case-insensitive matching.",
          "Spekta accepts only this pattern/path/options grammar. It does not pass arbitrary ripgrep options through.",
          "Search is limited to eligible workspace files and applies Git and Spekta ignore rules. Restricted paths and symlink escapes are rejected.",
        ],
      },
      {
        heading: "Defaults and response budget",
        lines: [
          "SPEKTA_GREP_TOKEN_LIMIT defaults to 2000 tokens. Results are also bounded by 500 matches and 100 files.",
          "If the complete result exceeds the configured response budget, all matches are withheld and a bounded output-limit message asks you to narrow the pattern, path or globs.",
          "A missing ripgrep executable or rejected/unavailable path exits nonzero. Help does not invoke ripgrep.",
        ],
      },
    ],
    [
      "spekta grep 'TODO'",
      "spekta grep 'timeout' src --ignore-case",
      "spekta grep 'export function' src --glob '*.ts' --glob '!*.test.ts'",
    ],
  ),
  rg: topic(
    "rg — Search eligible workspace files",
    "Search eligible workspace files through RTK with a documented subset of native ripgrep operands.",
    ["spekta rg [-e PATTERN]... [PATTERN] [PATH]... [-- PATH]..."],
    [
      {
        heading: "Arguments and behavior",
        lines: [
          "Without -e or --regexp, the first positional operand is the regex and later operands are paths. With explicit patterns, every positional operand is a path. Omitted paths search the workspace root recursively.",
          "Repeat -e/--regexp for alternative patterns and -g/--glob for ordered inclusion or exclusion filters; glob values retain commas. Use -i/--ignore-case, -s/--case-sensitive, or -S/--smart-case (case-sensitive by default). Use -- before literal dash-prefixed operands. Spekta keeps eligible-file restrictions and its own output formatting; unsupported options are rejected. MCP accepts patterns, paths, globs, and case_mode as separate values.",
          "Only the documented options are supported; other ripgrep flags, stdin, and empty or whitespace-only patterns are rejected. Spekta applies workspace eligibility and response limits, so this is not full native ripgrep compatibility.",
          "Search is limited to eligible workspace files and applies Git and Spekta ignore rules. Restricted paths and symlink escapes are rejected.",
        ],
      },
      {
        heading: "Execution and response budget",
        lines: [
          "Search runs through rtk proxy rg. Missing RTK or ripgrep is reported as an engine failure.",
          "Search results use the existing bounded response and cancellation behavior.",
        ],
      },
    ],
    [
      "spekta rg 'TODO'",
      "spekta rg 'timeout' src docs",
      "spekta rg -e TODO -e FIXME src",
      "spekta rg -i -g '*.ts,*.tsx' -g '!*.test.ts' TODO src",
    ],
  ),
  diagnostic: topic(
    "diagnostic — Scan files for policy and optimization findings",
    "Generate a report about eligible files in one file or directory.",
    ["spekta diagnostic [file|directory]", "spekta diagnostic --interactive"],
    [
      {
        heading: "Arguments and behavior",
        lines: [
          "The optional target is one workspace-relative file or directory; it defaults to the current workspace (.). More than one target is rejected.",
          "The scan prints progress, saves a diagnostic report, and prints a terminal summary. Findings or scan errors produce a nonzero exit status.",
          "--interactive asks for one target; an empty answer means the workspace root. When selected, the interactive route takes precedence over any supplied target.",
          "There are no output-path or other CLI options. Help does not scan or save a report.",
        ],
      },
    ],
    [
      "spekta diagnostic src",
      "spekta diagnostic",
      "spekta diagnostic --interactive",
    ],
  ),
  pr: topic(
    "pr — Generate a pull request message",
    "Build a pull request prompt from commit messages in a selected Git range and generate a message with a configured provider.",
    ["spekta pr"],
    [
      {
        heading: "Behavior",
        lines: [
          "The command interactively chooses a commit range and provider. Provider selection can choose Only Prompt to save the request without an AI call.",
          "A generated message is saved or opened according to SPEKTA_EDITOR and the shared output behavior.",
          "There are no CLI arguments or options. Git history and provider configuration are required; help does not start prompts or AI work.",
        ],
      },
    ],
    ["spekta pr"],
  ),
  "commit-range": topic(
    "commit-range — Generate a message from a commit range",
    "Combine commit messages between two commits into a prompt for one consolidated commit message.",
    ["spekta commit-range [older-ref newer-ref]"],
    [
      {
        heading: "Arguments and behavior",
        lines: [
          "Provide the older and newer Git references as the first two arguments, or omit them to enter both interactively. Symbolic refs such as HEAD~1 and branch names are accepted by Git resolution.",
          "When two references are provided, later arguments are ignored by the current handler. There are no supported command options.",
          "The older reference must be an ancestor of the newer one, and the range must contain commits.",
          "The command asks for a provider. Large prompts above 5000 tokens require confirmation; declining saves the prompt. Choosing Only Prompt also saves it without an AI call.",
          "Generated output follows SPEKTA_EDITOR behavior. Help performs no Git inspection or prompt.",
        ],
      },
    ],
    [
      "spekta commit-range HEAD~5 HEAD",
      "spekta commit-range main feature-branch",
    ],
  ),
  summarize: topic(
    "summarize — Summarize a commit range",
    "Create a structured summary from commit messages between two Git references.",
    ["spekta summarize [older-ref newer-ref]"],
    [
      {
        heading: "Arguments and behavior",
        lines: [
          "Provide older and newer Git references as the first two arguments, or omit them to enter both interactively. Symbolic refs and branch names are accepted.",
          "When two references are supplied, later arguments are ignored. There are no supported command options.",
          "The older reference must be an ancestor of the newer one, and the range must contain commits.",
          "The command asks for a provider. Prompts above 5000 tokens require confirmation; declining saves the prompt. Choosing Only Prompt saves it without an AI call.",
          "Generated output follows SPEKTA_EDITOR behavior. Help performs no Git inspection or prompt.",
        ],
      },
    ],
    ["spekta summarize HEAD~10 HEAD", "spekta summarize v1.0.0 main"],
  ),
  sync: topic(
    "sync — Refresh the free model list",
    "Fetch the current free model list from OpenRouter and update Spekta's model data.",
    ["spekta sync"],
    [
      {
        heading: "Requirements",
        lines: [
          "Requires OPENROUTER_API_KEY from the configured environment. If it is missing, the command fails.",
          "There are no arguments or options. The command contacts OpenRouter and updates model data; help does neither.",
        ],
      },
    ],
    ["spekta sync"],
  ),
  replace: topic(
    "replace — Apply SEARCH/REPLACE blocks to a file",
    "Replace exact, unique text regions in an existing eligible workspace file.",
    [
      "spekta replace <relative/path/to/file> [blocks]",
      "spekta replace <relative/path/to/file> < blocks.txt",
    ],
    [
      {
        heading: "Input and behavior",
        lines: [
          "The first argument is the target path. Remaining arguments are joined with spaces as the replacement payload; with no payload argument, content is read from stdin.",
          "Use SEARCH/REPLACE markers: <<<<<<< SEARCH, the exact old text, =======, the new text, and >>>>>>> REPLACE. Up to 50 blocks are accepted.",
          "Each SEARCH region must match uniquely. Unmatched or ambiguous regions fail; successful replacements update the existing file and formatting is best-effort.",
          "The target must be an eligible, editable workspace file. Replace does not create a file. There are no options; payload text after the path is literal, including help-looking tokens.",
          "Help exits before reading stdin or changing a file.",
        ],
      },
    ],
    [
      "spekta replace src/app.ts '<<<<<<< SEARCH\noldCall()\n=======\nnewCall()\n>>>>>>> REPLACE'",
      "spekta replace src/app.ts < changes.txt",
    ],
  ),
  write: topic(
    "write — Create a new workspace file",
    "Write supplied content to a new eligible file and format it when supported.",
    [
      "spekta write <relative/path/to/newfile> [content]",
      "spekta write <relative/path/to/newfile> < content.txt",
    ],
    [
      {
        heading: "Input and behavior",
        lines: [
          "The first argument is a workspace-relative target path. Remaining arguments are joined with spaces as content; with no content argument, content is read from stdin.",
          "Parent directories are created when needed. Creation is exclusive: an existing file is never overwritten and returns an error.",
          "The target must pass workspace and write policy checks. Formatting is best-effort after creation; a formatting warning does not mean the write should be retried.",
          "There are no options. Content after the target path is literal, including --help and -h. Help exits before reading stdin or creating files.",
        ],
      },
    ],
    [
      "spekta write notes/plan.md 'Next steps'",
      "spekta write src/generated.ts < source.txt",
    ],
  ),
  mcp: topic(
    "mcp — Start the Spekta MCP server",
    "Run Spekta's Model Context Protocol server over standard input and output.",
    ["spekta mcp"],
    [
      {
        heading: "Behavior",
        lines: [
          "The command initializes the workspace and configured tool definitions, then starts a long-lived stdio server for an MCP client.",
          "There are no command arguments or options. The server remains active until its process is stopped.",
          "MCP startup requires valid workspace/tool configuration. Help exits before initialization, validation or server startup.",
        ],
      },
    ],
    ["spekta mcp"],
  ),
  setup: topic(
    "setup — Configure Spekta's Codex integration",
    "Preview or apply Spekta-owned global Codex configuration, hooks and optional MCP registration.",
    ["spekta setup --global --codex --dry-run|--apply [--mcp]"],
    [
      {
        heading: "Required arguments and modes",
        lines: [
          "--global and --codex are required in that order. Choose exactly one of --dry-run or --apply.",
          "Exactly one mode is required; neither mode is implied. --dry-run prints planned file changes without writing them.",
          "--apply writes the planned integration. Add --mcp to include optional MCP registration; without it, MCP is not registered.",
          "Setup checks for conflicting or unsafe configuration and can refuse with diagnostics. Applying configuration does not verify runtime activation or Codex trust.",
          "This configures Codex integration; it does not install or remove the Spekta CLI. Help never previews or applies changes.",
        ],
      },
    ],
    [
      "spekta setup --global --codex --dry-run",
      "spekta setup --global --codex --apply",
      "spekta setup --global --codex --apply --mcp",
    ],
  ),
  uninstall: topic(
    "uninstall — Remove Spekta's Codex integration",
    "Preview or remove Spekta-owned global Codex configuration and integration files.",
    ["spekta uninstall --global --codex --dry-run|--apply"],
    [
      {
        heading: "Required arguments and modes",
        lines: [
          "Use --global --codex in that order, followed by exactly one of --dry-run or --apply.",
          "--dry-run prints planned removal or update actions without changing files. --apply performs those actions.",
          "Uninstall removes the Codex integration and preserves unrelated Codex configuration. It does not uninstall the Spekta CLI package or npm link.",
          "There are no additional options. Help exits before reading or changing Codex configuration.",
        ],
      },
    ],
    [
      "spekta uninstall --global --codex --dry-run",
      "spekta uninstall --global --codex --apply",
    ],
  ),
  status: topic(
    "status — Inspect Spekta's Codex integration",
    "Report the configured state of Spekta-owned global Codex integration components.",
    ["spekta status --global --codex"],
    [
      {
        heading: "Arguments and output",
        lines: [
          "Both --global and --codex are required in that order. No other arguments are accepted.",
          "The report lists component states, trust and activation status, followed by runtime verification steps.",
          "Configuration presence does not establish that Codex trusts or has activated the integration. Status is read-only; help does not inspect configuration.",
        ],
      },
    ],
    ["spekta status --global --codex"],
  ),
};
