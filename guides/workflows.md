# Prompt and Workflow Reference

Related guides: [README](../README.md) · [Workspace inspection](inspection.md) · [Runtime and configuration](configuration.md) · [Codex setup](codex-setup.md)

## Prompt templates and Nunjucks

Spekta features a dynamic Nunjucks-based prompt template system located in `templates/prompts/` (or directly in the asset root) and user home directory `~/.spekta/prompts/`.

## Prompt structure and metadata

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

## Subfolders and partials

- **Main Prompts (`templates/prompts/*.md`):** Prompts with `name` and `description` YAML frontmatter are listed automatically in the `spekta prompt` UI menu.
- **Partials (`templates/prompts/partials/*.md`):** Reusable partial snippets (e.g., `partials/tool-usage.md`). Excluded from command selection menus and included in templates via `{% include "partials/tool-usage.md" %}`.

## Standard global context variables

The following read-only variables are automatically injected into all prompt templates:

- `id`: A unique 12-character hex ID string generated per prompt execution.
- `cwd`: Current working directory path (`process.cwd()`).
- `git_diff`: Safe read-only output of `git diff --no-ext-diff`.
- `timestamp`: Current ISO timestamp string.
- `tools`: Available Spekta AI tools array documentation.

## Composable prompt CLI

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

## Commit prompt CLI

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
