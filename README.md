# spekta-cli

AI-powered CLI tools.

## Getting Started

### Installation

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run deploy`.

### Usage

Run `spekta` and follow the prompts.

### Codex inspection routing (experimental)

`npm run deploy` also installs the standalone `spekta-codex-hook` binary. To enable the experimental integration, add this synchronous hook manually to your Codex `config.toml`:

```toml
[features]
hooks = true

[hooks]

[[hooks.PreToolUse]]
matcher = "^Bash$"

[[hooks.PreToolUse.hooks]]
type = "command"
command = "spekta-codex-hook"
timeout = 3
```

Review and trust the exact hook in `/hooks`; project-local hooks are skipped for untrusted projects. The hook reads one event (at most 64 KiB, with a two-second stdin deadline) and rewrites supported literal standalone `ls`, `find`, `cat`, `sed`, and `rg` requests, including the exact `rtk rg` wrapper form used by RTK-enabled shells. Search routing supports one literal pattern, an optional single path, `-i`/`--ignore-case` before the pattern, and repeatable `-g`/`--glob` values before the pattern (except comma-containing globs). `-e PATTERN` and `--` are supported to preserve patterns beginning with `-`. These forms become Spekta `grep` requests and retain Spekta's existing ripgrep engine, ignore rules, and bounded outcomes. Other search flags, multiple paths, stdin, pattern files, substitutions, redirections, pipelines, expansions, and compound shell syntax remain unchanged. Read routing supports `cat PATH` with one path and no options, and `sed -n 'START,ENDp' PATH` (also `sed -n 'STARTp' PATH`) with one path. `START` is a positive decimal line number; numeric `END` must be at least `START`, or may be `$`. These forms become `spekta read PATH` or `spekta read 'PATH[START,END]'`. Quoted path contents are preserved. Its response uses `hookSpecificOutput` with `hookEventName: "PreToolUse"`, `permissionDecision: "allow"`, and `updatedInput.command`. Hook failures are fail-open, so this is a routing convenience rather than a security boundary. Codex then performs its usual approval and sandbox handling. Filesystem policy checks happen in Spekta during execution.

The verified compatibility candidate is Codex CLI 0.160.1 on local Linux with Bash; prior ls routing was also verified on 0.160.0. Zsh, native Windows, and remote/cloud execution are not verified. Codex documents hooks for unified exec as `Bash`; preservation of unified-exec settings was verified on 0.160.0. No configuration or project trust is installed automatically.

### RTK Proxy Inspection

Commands without a native Spekta handler and MCP `spekta_shell` requests use one fail-closed policy before RTK starts. Supported forms are `ls`, restricted `find` discovery, and the Git inspections below.

`ls` accepts no options and zero or one existing relative workspace-directory operand. Files, missing directories, absolute paths, restricted targets, and escaping symlinks are rejected. The listing contains only eligible entries: names denied by ignore rules, restricted-file rules, or workspace containment are omitted without any count or notice. Spekta reads the directory itself and rejects a listing it cannot attribute to real entries. A failing child is reported by exit status only, and the complete rendered response fits the proxy output budget.

#### Restricted Find Discovery

`find` accepts zero or one existing relative workspace-directory root. Omitting the root uses `.`. CLI and MCP requests use the same classifier.

| Component      | Supported forms                                                                          |
| -------------- | ---------------------------------------------------------------------------------------- |
| Root           | `.`, ordinary relative directory names, nested directories, and an optional leading `./` |
| Type predicate | At most one `-type f` or `-type d`                                                       |
| Name predicate | At most one `-name PATTERN`                                                              |
| Combination    | Implicit conjunction; predicates may appear in either order                              |
| Output         | Default printing or one terminal `-print`                                                |

Patterns must be nonempty strings without control characters. Pass each pattern as one argument. Wildcards remain literal argument contents until native find interprets them. Name values such as `.env`, `../outside`, and `-exec` are filters, not filesystem roots or executable actions. The shared reserved `--spekta-force` option remains rejected wherever it appears.

Roots must remain lexically and canonically inside the workspace and cannot target restricted paths or aliases to them. Files, missing roots, dangling roots, absolute POSIX/Windows/UNC paths, escaping symlink roots, and inaccessible roots are rejected. Root syntax excludes control characters, backslashes, colons, wildcard characters, tilde expansion, `..` segments, trailing slashes, repeated separators, and interior `.` segments. Names such as `..internal`, roots containing spaces, and `./-directory` are supported.

Requests execute through `rtk proxy find -P` with an explicit workspace cwd. Physical traversal does not follow directory symlinks encountered beneath the root. A contained directory symlink supplied as the root is treated as the link itself; it is not traversed. Symlink roots with trailing slashes or dot suffixes are unsupported.

Restricted-path checks protect cwd and explicit roots. Discovery output is not recursively filtered by restricted filename. For example, `-name '.env'` is a literal name filter when the root itself is permitted.

Every unlisted predicate, expression operator, traversal option, and output action is rejected before RTK starts. This includes `-exec`, `-execdir`, `-ok`, `-okdir`, `-delete`, `-fprint`, `-fprint0`, `-fprintf`, `-fls`, `-printf`, `-print0`, `-prune`, `-quit`, `-follow`, `-H`, `-L`, and user-supplied `-P`. Multiple roots and duplicate predicates are unsupported.

```bash
spekta find . -type f -name '*.ts'
spekta find -type f -name '*.ts'
spekta find src -name '*.ts' -type f -print
spekta find 'space name' -name 'file name.ts'
```

Equivalent MCP requests use `command: "find"` and argument arrays such as:

```json
{
  "command": "find",
  "args": [".", "-type", "f", "-name", "*.ts"]
}
```

```json
{
  "command": "find",
  "args": ["src", "-name", "*.ts", "-type", "f", "-print"]
}
```

Omitted MCP args and `[]` use the default root and default printing.

The supported backend environment is Linux or WSL with GNU Findutils available as `find`. Native Windows `find.exe` is incompatible. Spekta's direct `rtk find` route is not used because RTK may implement simple expressions through its own walker with different filtering semantics.

RTK proxy argument handling was reviewed in versions 0.46.0, 0.49.0, and 0.50.0. The separately installed RTK version is not inferred from Spekta's dependencies. Review other releases and run the backend suite before extending the verified compatibility list.

The real backend suite is opt-in. Its skipped suite name shows the command to enable it. Before completing a find change, run the backend suite on Linux or WSL with a reviewed RTK version and GNU Findutils:

```bash
npm run test:find-backend
```

`test:find-backend` sets `SPEKTA_FIND_BACKEND_TESTS=1` and runs Vitest once. Selecting the file with ordinary `npm test` alone still skips it.

When selected, the suite fails if RTK is missing, its version has not been reviewed, or its proxy does not resolve GNU Findutils.

| Git command | Supported flags                                                                                                                                                                                         | Operands                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `status`    | `-s`, `--short`, `-b`, `--branch`, `--porcelain`, `--porcelain=v1`, `--porcelain=v2`, `--untracked-files=no`, `--untracked-files=normal`, `--untracked-files=all`                                       | Relative paths after `--`                                                                                     |
| `log`       | `--oneline`, `--graph`, `--all`, `--decorate`, `--decorate=short`, `--decorate=full`, `--decorate=no`, `-n N`, `--max-count=N`, `-p`, `--patch`, `--no-patch`, `--stat`, `--name-only`, `--name-status` | Revisions/ranges, then optional `--` and relative paths                                                       |
| `show`      | `--oneline`, `-p`, `--patch`, `--no-patch`, `--stat`, `--name-only`, `--name-status`                                                                                                                    | At most one revision, then optional `--` and paths; alternatively one `REV:path` blob selector                |
| `diff`      | `--cached`, `--staged`, `-p`, `--patch`, `--no-patch`, `--stat`, `--name-only`, `--name-status`                                                                                                         | Zero, one, or two revisions; alternatively one complete two/three-dot range; optional `--` and relative paths |

`branch` supports listing only: no arguments lists local branches. Supported flags are `--list`/`-l`, `--all`/`-a`, `--remotes`/`-r`, and `--verbose`/`-v`. Verbose requests retain their listing selection but disclose branch names only; tracking details and commit subjects are withheld because they are free text that cannot be attributed safely. Branch names are useful identifiers, but their presence does not establish that ancillary text is safe to disclose. All flags must precede patterns. Patterns require an explicit `--list` or `-l`, even with `--all` or `--remotes`; multiple patterns and one optional `--` before patterns are supported. Repeated supported flags are accepted, including `-v -v`; bundles such as `-vv` are unsupported. Patterns are branch-name filters, not filesystem paths. Empty patterns, control characters, and option-looking operands (including after `--`) are rejected. Bare names, start points, creation, deletion, rename, copy, tracking/upstream changes, description editing, and every unlisted option are rejected before execution. Supported listing never invokes a pager. The complete formatted CLI response and MCP response stay within the proxy output budget; long listings carry an explicit truncation marker.

```bash
spekta git branch
spekta git branch --all --verbose
spekta git branch --list 'feature/*'
spekta git branch -r -l -- 'origin/*'
```

Equivalent MCP requests use `command: "git"` with `args: ["branch"]`, `args: ["branch", "--all", "--verbose"]`, or `args: ["branch", "--list", "feature/*"]`. Pass patterns as individual strings; shell examples quote glob patterns to prevent shell expansion.

Put flags before revisions. `N` must be a positive decimal safe integer; use only one count option. Bundled/abbreviated options and other value spellings are unsupported. A second `--` is unsupported; ordinary filenames beginning with a dash are allowed after `--` for status/log/show/diff paths.

Revisions support `HEAD`, hexadecimal IDs, conservative ASCII named refs such as `main`, `feature/topic`, and `refs/heads/main`, and ancestry suffixes such as `HEAD~2` and `HEAD^`. Log also accepts two/three-dot ranges such as `main..HEAD`, `main...HEAD`, `..HEAD`, and `HEAD..`; both endpoints cannot be empty. Reflog, search, exclusion, dereference, and other revision forms are unsupported. Revisions are never checked as filesystem paths; an internal separator prevents Git from treating an unknown revision as a filename.

`diff` compares the working tree with the index by default. With one revision it compares the working tree with that revision; two revisions compare endpoints. `A..B` compares endpoints and `A...B` compares the merge base of A/B with B; diff requires both range endpoints. A range must be the only revision operand. `--cached` and `--staged` compare the index with HEAD or one supplied revision, and support an unborn HEAD when no revision is supplied. Only one staged selector is allowed; staged ranges, multiple staged revisions, blob selectors, `--no-index`, and all unlisted diff flags are unsupported.

Paths must stay lexically and canonically inside the current workspace and cannot target restricted files or aliases to them. Absolute POSIX/Windows/UNC paths, escaping or dangling symlinks, Git pathspec magic, wildcards, backslashes, colons, tilde expansion syntax, and control characters are unsupported. Ordinary missing paths remain valid for historical inspection. Spaces and option-looking filenames are supported after `--`. History summaries filter historical paths (including deleted paths and both rename endpoints) through the workspace disclosure policy, even for broad or directory selections. Summary counts describe eligible paths only. Commit messages, graph/decorations, and other free text are rejected because they cannot be attributed safely to eligible paths.

`show REV:path` uses a repository-relative blob path. The nearest `.git` directory or worktree `.git` file establishes its root. From a nested workspace directory, only blob paths inside that workspace are accepted. Empty paths, dot/dot-dot segments, `REV:./path`, index-stage selectors, additional path operands, and unsupported repository markers are rejected.

```bash
spekta ls src
spekta git status --short
spekta git status --porcelain=v2 -- src
spekta git log --name-status -n 5 main..HEAD -- src
spekta git show --stat HEAD
spekta git show HEAD -- src/example.ts
spekta git show HEAD:src/example.ts
spekta git diff -- src/example.ts
spekta git diff --cached -- src/example.ts
spekta git diff --staged HEAD -- src
spekta git diff HEAD~1 HEAD -- src
spekta git diff main...HEAD -- src
```

MCP examples use `command: "git"` with `args: ["status", "--short"]`, `args: ["log", "--oneline", "-n", "5", "main..HEAD", "--", "src"]`, `args: ["show", "HEAD:src/example.ts"]`, `args: ["diff", "--", "src/example.ts"]`, `args: ["diff", "--cached", "--", "src"]`, or `args: ["diff", "main...HEAD", "--", "src"]`. Omitting Git args is unsupported. `ls` accepts omitted args, `[]`, or one directory.

User global options and unknown arguments are rejected, including `-c`, `--config-env`, `-C`, `--git-dir`, `--work-tree`, their attached/equals forms, and `--spekta-force`. Ambient `GIT_DIR`, `GIT_WORK_TREE`, or `GIT_COMMON_DIR` also refuse Git requests because they override workspace interpretation. Tests, builds, package scripts, and other Git commands remain unsupported.

Git status responses contain individual eligible changes, with JSON-quoted workspace-relative paths. Default and long status requests use short status entries; porcelain v2 retains its entry metadata. Renames and copies are returned only when both endpoints are eligible. Untracked `normal` directory summaries expand to eligible files, while `--untracked-files=no` suppresses them. Broad and directory requests never disclose denied descendants or counts. Unsafe path representations are rejected. Requested branch metadata is retained (v2 returns branch head and object ID); diagnostics from the child are withheld and its failure exit status is preserved. Status disables optional index writes and budgets the complete CLI and MCP responses after filtering.

Supported Git forms execute via `rtk proxy git` to preserve native flag and operand meaning. Spekta condenses and redacts the output. Internal controls disable pagers, use literal pathspecs, and disable external diff/text conversion for log/show/diff. Diff also forces short submodule output and disables automatic index refresh through an internal configuration override, preserving repository state during inspection. Patch output includes a rename only when both paths are eligible; binary changes produce a path-specific notice without binary data. Copy detection is unavailable because RTK rejects its required Git option. Combined merge patches and ambiguous metadata representations are rejected. Unsupported requests never prompt or execute: CLI writes a bounded, redacted diagnostic to stderr and exits nonzero; MCP returns `isError: true`. Supported Git failures retain CLI failure badges and MCP errors; missing RTK produces the existing installation advisory.

## Prompt System

### Prompt Templates & Nunjucks Engine

Spekta features a dynamic Nunjucks-based prompt template system located in `templates/prompts/` (or directly in the asset root) and user home directory `~/.spekta/prompts/`.

### Prompt Structure & Metadata

Composable prompts use standard markdown files with YAML frontmatter metadata:

```yaml
---
name: Feature Audit
description: Run structured code audit on recent changes
default_output: ".spekta/audits/{{ id }}.md"
---
# Audit Report: {{ id }}
Working Directory: {{ cwd }}
Timestamp: {{ timestamp }}

## Changes
{{ git_diff }}
```

### Subfolders & Partials

- **Main Prompts (`templates/prompts/*.md`):** Prompts with `name` and `description` YAML frontmatter are listed automatically in the `spekta prompt` UI menu.
- **Partials (`templates/prompts/partials/*.md`):** Reusable partial snippets (e.g., `partials/tool-usage.md`). Excluded from command selection menus and included in templates via `{% include "partials/tool-usage.md" %}`.

### Standard Global Context Variables

The following read-only variables are automatically injected into all prompt templates:

- `id`: A unique 12-character hex ID string generated per prompt execution.
- `cwd`: Current working directory path (`process.cwd()`).
- `git_diff`: Safe read-only output of `git diff --no-ext-diff`.
- `timestamp`: Current ISO timestamp string.
- `tools`: Available Spekta AI tools array documentation.

### Composable Prompt CLI

Composable prompts are discovered from the built-in prompt directory and your user prompt directory (`~/.spekta/prompts`). A prompt must define YAML `name` and `description` metadata to appear in the prompt menu.

Invoke a prompt by filename or by its exact YAML metadata name:

```bash
# Use the prompt filename.
spekta prompt review-validation.md

# Use the YAML frontmatter name.
spekta prompt "Review Validation"
```

By default, Spekta persists the rendered prompt. It uses the prompt's rendered `default_output` when present, `--output` when provided, or the existing uncategorized output directory as a fallback. Parent directories are created automatically, and relative paths are resolved from the current working directory. Use `--stdout` to emit the rendered prompt only to standard output without writing to disk; `--output` has no persistence effect when used with `--stdout`.

```bash
# Emit rendered content without writing an output file.
spekta prompt plan.md --stdout

# Override the default output destination.
spekta prompt plan.md \
  --output .spekta/audits/plan.md

# Persist the output without launching SPEKTA_EDITOR.
spekta prompt plan.md --no-editor
```

For headless workflows that use other generated-output commands, set `SPEKTA_NO_EDITOR=1` to persist output and report its path without launching the configured editor:

```bash
SPEKTA_NO_EDITOR=1 spekta summarize
```

`--no-editor` takes precedence for `spekta prompt`; `SPEKTA_NO_EDITOR=1` applies to shared generated-output flows. Neither setting changes persistence, and `--stdout` continues to bypass both persistence and editor handling.

`--stdout` emits the rendered prompt content for pipelines and AI-agent skills. Diagnostics are sent to stderr, so command substitution captures only the rendered prompt:

```bash
rendered_prompt=$(
  spekta prompt "Review Validation" --stdout
)
```

### Commit Prompt CLI

`spekta commit` is non-interactive by default. It writes the complete commit prompt to a temporary file and reports the path, so an agent can read it after the command exits:

```bash
spekta commit
cat /tmp/spekta-prompt-*.md
```

Use `--stdout` to emit the prompt without creating a file, or `--no-editor` to explicitly suppress an editor. Use `--interactive` to open the provider-selection and optional commit workflow. `SPEKTA_NO_EDITOR=1` remains a global fallback for generated-output commands.

`--prompt-only` explicitly stops before provider lookup and AI execution. `--stdout` is a delivery option and may be combined with prompt-only or generated-message mode. Use `--message --model <provider-name-or-model-id>` to generate a formatted message headlessly; the model selector must exactly match one configured provider name or model. Use `--commit --model <provider-name-or-model-id>` to commit the generated message directly, without an editor or confirmation; direct commit cannot be combined with `--stdout`.

```bash
spekta commit --stdout
spekta commit --no-editor
spekta commit --interactive
spekta commit --prompt-only --stdout
spekta commit --model <configured-model> --message --stdout
spekta commit --model <configured-provider-name> --commit
```

Running `spekta prompt` without a selector preserves the interactive prompt menu. Invalid selectors, unknown options, missing option values, and multiple selectors return a nonzero exit status.

## Runtime and Assets

### Asset Directory Resolution

Spekta resolves internal tools, prompt templates, and default ignore patterns dynamically. It supports both nested build structures and flat deployment layouts:

1. **Nested Structure (Default Build Output):**
   - `<ASSET_ROOT>/templates/tools/`
   - `<ASSET_ROOT>/templates/prompts/`
   - `<ASSET_ROOT>/templates/default.ignore`

2. **Flat Structure (Direct Deployment / Home Directories):**
   - `<ASSET_ROOT>/tools/`
   - `<ASSET_ROOT>/prompts/`
   - `<ASSET_ROOT>/default.ignore`

At startup, the runtime checks for `templates/<subfolder>` and falls back to `<ASSET_ROOT>/<subfolder>` automatically, ensuring compatibility with custom installations and flattened package deployments.

## Configuration

### Environment Variables

You can configure the following environment variables to customize `spekta`'s behavior:

- `SPEKTA_COMPACT_THRESHOLD`: The token threshold above which content is compacted. Defaults to `500`.
- `SPEKTA_GREP_TOKEN_LIMIT`: The maximum number of tokens `spekta grep` may return before results are truncated. Defaults to `2000`.
- `SPEKTA_READ_TOKEN_LIMIT`: The maximum number of tokens to read from a file. Defaults to `1000`.

### Configuring Providers

Providers are defined in ~/.spekta/providers.yaml.

## Headless CLI usage and global state

Starting `spekta` without arguments opens the interactive menu and may initialize user state under `~/.spekta`, including global ignore and provider files. Direct commands such as `spekta prompt plan.md` are read-only with respect to this initialization: existing configuration remains readable, but bootstrap does not create or update home-managed files. `SPEKTA_HOME_OVERRIDE` is intended for tests and development; it is not required as an agent integration mechanism.

### OpenRouter (default)

Providers without a `type` field default to OpenRouter and require OPENROUTER_API_KEY.

```yaml
providers:
  - name: DeepSeek R1 (Free)
    model: deepseek/deepseek-r1:free
```

### Google Gemini

Set `type: gemini` and ensure GEMINI_API_KEY is set in your environment.

```yaml
providers:
  - name: Gemini 3 Flash Preview
    type: gemini
    model: gemini-3-flash-preview
  - name: Gemini 3.1 Pro Preview
    type: gemini
    model: gemini-3.1-pro-preview
    config:
      temperature: 0.7
```

### .spektaignore

Spekta respects a custom ignore hierarchy. Patterns are cumulative and follow this priority (bottom takes precedence):

1. **Managed Defaults:** the packaged `default.ignore` asset shipped with Spekta
2. **Global User:** `~/.spekta/.spektaignore` (Your personal global defaults)
3. **Workspace:** `./.spektaignore` (Project-specific overrides)

**Note:** Add personal global patterns to `~/.spekta/.spektaignore` or project-specific patterns to `./.spektaignore`. Existing `.spektadefaultignore` files are legacy and are no longer read or modified.

#### Whitelisting / Overriding Git

If a file is ignored by `.gitignore` but you want Spekta to have access to it, you can whitelist it using the `!` prefix in your `.spektaignore`:

```text
# .spektaignore
!node_modules/my-important-config/
```

This will allow Spekta tools (read, grep, etc.) to access the path even if it remains ignored by Git.
