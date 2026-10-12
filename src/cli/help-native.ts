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
      "Print complete original lines with accurate coverage and continuation ranges.",
    usage: [
      "spekta read [--save] [--allowance <tokens>] [--expected-version <marker>] <path[start,end]>...",
      "spekta read --overview [--save] [--allowance <tokens>] <path>...",
      "spekta read [--save]",
      "spekta help read",
    ],
    complete: true,
    sections: [
      {
        heading: "Operands and ranges",
        lines: [
          "Direct reading requires one or more literal file paths; multiple paths share one response budget. Mixed batches retain eligible siblings and identify every operand by its one-based position.",
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
          "--overview  Opt in to a structural overview. It may omit original source evidence, which is identified by absolute line markers. Cannot be combined with an explicit range; unsupported formats return labeled original content with normal chunking.",
          "--expected-version <marker>  Check the Version marker from an earlier read. Also accepts --expected-version=<marker>. Requires exactly one file path.",
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
          "--allowance <tokens> requests a positive whole-number response allowance. The default is SPEKTA_READ_TOKEN_LIMIT (1000); it covers the whole rendered response and cannot exceed SPEKTA_READ_TOKEN_CEILING (8000). The workspace owner sets the ceiling; it is not a security boundary. Invalid and over-ceiling values are rejected with guidance.",
          "Example: spekta read --allowance 2000 'src/index.ts[1,200]'",
          "Ordinary full-file and explicit-range reads return original content. The legacy SPEKTA_COMPACT_THRESHOLD (default 500 tokens) does not affect ordinary reads or explicit overviews.",
          "When a read exceeds the response budget, Spekta returns a contiguous chunk of complete original lines with the actual delivered range and a Next range operand. Repeat that operand with --expected-version set to the earlier Version marker to continue safely; ranges extending beyond EOF report only existing lines.",
          "Each rendered file includes a Version marker for its canonical target and original bytes, including empty files and ranges beyond EOF. MCP accepts the same marker as expectedVersion.",
          "version_mismatch returns no content and exits nonzero. Discard earlier chunks and restart from the original requested range without --expected-version; for MCP, omit expectedVersion.",
          "Eligibility and canonical targets are checked again on every request. Newly unavailable targets return unavailable_access. Version checking does not provide an atomic snapshot across files; omitting the expected version reads the currently eligible content.",
          "An incomplete read exits nonzero with output_limit_exceeded. A single line that cannot fit is withheld with guidance to request a supported allowance increase; lines are never shortened. Empty files and requests beyond EOF report no lines.",
          "Printed and saved results use the same complete-line contract. The complete response budget includes headings, coverage, version markers, continuation guidance, the MCP envelope and the save-path notice when applicable.",
          "Multi-file reads report Batch: success or Batch: partial_result and an explicit outcome for every operand. returned means the requested range is complete; incomplete includes a chunk; budget_limited means no requested line fits; unavailable conceals the path; unattempted means retrieval could not start.",
          "All operand metadata is reserved before content retrieval. Conservative reservation can reject a batch whose metadata cannot fit; split it into fewer operands or request a supported allowance increase. Readable operands share content opportunities fairly, and unused allowance is redistributed.",
          "Each readable batch operand reports its original requested range and Version. Continue each Next range separately with --expected-version, or MCP expectedVersion. A single expected version still requires exactly one path.",
          "Partial batches exit nonzero and MCP marks isError while preserving useful content. Whole lines are never shortened or compacted to fit.",
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
          "Unsupported options or nonpositive/reversed ranges yield usage_error before reading. unavailable_access conceals denied paths and existence; internal_failure conceals private diagnostics. Both identify operand positions when possible and exit nonzero. Help performs no read, save or initialization.",
        ],
      },
    ],
    examples: [
      "spekta read README.md",
      "spekta read 'src/index.ts[10,20]'",
      "spekta read --expected-version '<Version marker from prior response>' 'src/index.ts[21,40]'",
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
  rg: topic(
    "rg — Search eligible workspace files",
    "Search eligible workspace files through RTK with a documented subset of native ripgrep operands.",
    [
      "spekta rg [--allowance TOKENS] [--profile] [-e PATTERN]... [PATTERN] [PATH]... [-- PATH]...",
    ],
    [
      {
        heading: "Arguments and behavior",
        lines: [
          "Without -e or --regexp, the first positional operand is the regex and later operands are paths. With explicit patterns, every positional operand is a path. Omitted paths search the workspace root recursively.",
          "Repeat -e/--regexp for alternative patterns and -g/--glob for ordered inclusion or exclusion filters; glob values retain commas. Use -i/--ignore-case, -s/--case-sensitive, or -S/--smart-case (case-sensitive by default). Use -- before literal dash-prefixed operands. Spekta keeps eligible-file restrictions and its own output formatting; unsupported options are rejected. MCP accepts patterns, paths, globs, and case_mode as separate values.",
          "Only the documented options are supported; other ripgrep flags, stdin, and empty or whitespace-only patterns are rejected. Spekta applies workspace eligibility and response limits, so this is not full native ripgrep compatibility.",
          "Search is limited to eligible workspace files and applies Git and Spekta ignore rules. Restricted paths and symlink escapes are rejected.",
          "Multiple requested roots report positional outcomes. Unavailable operands conceal their names; requested scope is incomplete even when eligible roots have no matches. Overflow cancels search and withholds every match. Reduce roots or narrow the pattern/path/glob, or increase --allowance within its configured ceiling.",
        ],
      },
      {
        heading: "Execution and response budget",
        lines: [
          "Search runs through rtk proxy rg. Missing RTK or ripgrep is reported as an engine failure.",
          "After two seconds, long searches report a fixed phase on stderr; subsequent phase changes and five-second heartbeats follow, capped at four progress events. Fast searches emit no progress. MCP sends notifications/progress only when the caller supplied a progressToken. Progress contains no roots, counts, matches, or backend text.",
          "Use --profile to add aggregate preparation and search timings to the final response when the allowance has room. MCP accepts profile: true. Timing metadata reserves response allowance and is suppressed for denied or partial scopes.",
          "SPEKTA_GREP_TOKEN_LIMIT (the retained historical setting) defaults to 2000 tokens. One --allowance TOKENS value may appear before --; it must be a positive whole number no greater than SPEKTA_GREP_TOKEN_CEILING (16000 by default) and covers the complete rendered response. Results are also bounded by 500 matches and 100 files.",
          "usage_error, unavailable_access, internal_failure, no_matches, and output_limit_exceeded label the public outcome. Failures exit nonzero; no_matches is a complete successful empty search. Overflow withholds every match and cancels the RTK process tree. Narrow with a symbol/pattern (-e 'class Name'), path (src/module/file.ts), or glob (-g '*.ts').",
          "Accepted requests budget the complete rendered response, including every success, operational failure, and final metadata, to the requested allowance. Rejected invalid, over-ceiling, or too-small allowances use the configured default whenever possible. If mandatory MCP ID echo prevents a nonempty diagnostic from fitting, only the rejected response may exceed the default; its diagnostic body is capped at 64 tokens and contains no matches or request contents. The complete response can grow with the ID and has no absolute cap. Accepted allowances are never enlarged.",
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
