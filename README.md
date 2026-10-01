# spekta-cli

AI-powered CLI tools.

## Getting Started

### Installation

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run deploy`.

### Usage

Run `spekta` and follow the prompts.

### RTK Proxy Inspection

Commands without a native Spekta handler and MCP `spekta_shell` requests use one fail-closed policy before RTK starts. Supported forms are `ls` and the Git inspections below.

`ls` accepts no options and zero or one existing relative workspace-directory operand. Files, missing directories, absolute paths, restricted targets, and escaping symlinks are rejected.

| Git command | Supported flags                                                                                                                                                                                         | Operands                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `status`    | `-s`, `--short`, `-b`, `--branch`, `--porcelain`, `--porcelain=v1`, `--porcelain=v2`, `--untracked-files=no`, `--untracked-files=normal`, `--untracked-files=all`                                       | Relative paths after `--`                                                                      |
| `log`       | `--oneline`, `--graph`, `--all`, `--decorate`, `--decorate=short`, `--decorate=full`, `--decorate=no`, `-n N`, `--max-count=N`, `-p`, `--patch`, `--no-patch`, `--stat`, `--name-only`, `--name-status` | Revisions/ranges, then optional `--` and relative paths                                        |
| `show`      | `--oneline`, `-p`, `--patch`, `--no-patch`, `--stat`, `--name-only`, `--name-status`                                                                                                                    | At most one revision, then optional `--` and paths; alternatively one `REV:path` blob selector |

Put flags before revisions. `N` must be a positive decimal safe integer; use only one count option. Bundled/abbreviated options and other value spellings are unsupported. A second `--` is unsupported; ordinary filenames beginning with a dash are allowed after `--`.

Revisions support `HEAD`, hexadecimal IDs, conservative ASCII named refs such as `main`, `feature/topic`, and `refs/heads/main`, and ancestry suffixes such as `HEAD~2` and `HEAD^`. Log also accepts two/three-dot ranges such as `main..HEAD`, `main...HEAD`, `..HEAD`, and `HEAD..`; both endpoints cannot be empty. Reflog, search, exclusion, dereference, and other revision forms are unsupported. Revisions are never checked as filesystem paths; an internal separator prevents Git from treating an unknown revision as a filename.

Paths must stay lexically and canonically inside the current workspace and cannot target restricted files or aliases to them. Absolute POSIX/Windows/UNC paths, escaping or dangling symlinks, Git pathspec magic, wildcards, backslashes, colons, tilde expansion syntax, and control characters are unsupported. Ordinary missing paths remain valid for historical inspection. Spaces and option-looking filenames are supported after `--`. These checks protect explicit operands; unscoped history output is not filtered by filename.

`show REV:path` uses a repository-relative blob path. The nearest `.git` directory or worktree `.git` file establishes its root. From a nested workspace directory, only blob paths inside that workspace are accepted. Empty paths, dot/dot-dot segments, `REV:./path`, index-stage selectors, additional path operands, and unsupported repository markers are rejected.

```bash
spekta ls src
spekta git status --short
spekta git status --porcelain=v2 -- src
spekta git log --oneline -n 5 main..HEAD -- src
spekta git show --stat HEAD
spekta git show HEAD -- src/example.ts
spekta git show HEAD:src/example.ts
```

MCP examples use `command: "git"` with `args: ["status", "--short"]`, `args: ["log", "--oneline", "-n", "5", "main..HEAD", "--", "src"]`, or `args: ["show", "HEAD:src/example.ts"]`. Omitting Git args is unsupported. `ls` accepts omitted args, `[]`, or one directory.

User global options and unknown arguments are rejected, including `-c`, `--config-env`, `-C`, `--git-dir`, `--work-tree`, their attached/equals forms, and `--spekta-force`. Ambient `GIT_DIR`, `GIT_WORK_TREE`, or `GIT_COMMON_DIR` also refuse Git requests because they override workspace interpretation. Tests, builds, package scripts, and other Git commands remain unsupported.

Supported Git forms execute via `rtk proxy git` to preserve native flag and operand meaning. Spekta condenses and redacts the output. Internal controls disable pagers, use literal pathspecs, and disable external diff/text conversion for log/show. Unsupported requests never prompt or execute: CLI writes a bounded, redacted diagnostic to stderr and exits nonzero; MCP returns `isError: true`. Supported Git failures retain CLI failure badges and MCP errors; missing RTK produces the existing installation advisory.

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
