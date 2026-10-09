# Runtime and Configuration Reference

Related guides: [README](../README.md) · [Workspace inspection](inspection.md) · [Prompts and workflows](workflows.md) · [Codex setup](codex-setup.md)

## Asset directory resolution

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

## Environment variables

You can configure the following environment variables to customize `spekta`'s behavior:

- `SPEKTA_COMPACT_THRESHOLD`: The token threshold above which content is compacted. Defaults to `500`.
- `SPEKTA_GREP_TOKEN_LIMIT`: The maximum complete response size for `spekta rg`, in tokens. The historical variable name is retained; no configuration rename is required. Defaults to `2000`. Search is also bounded by 500 matches and 100 files.
- `SPEKTA_READ_TOKEN_LIMIT`: The maximum number of tokens to read from a file. Defaults to `1000`.

## Configuring providers

Providers are defined in ~/.spekta/providers.yaml.

## Headless CLI usage and global state

Starting `spekta` without arguments opens the interactive menu and may initialize user state under `~/.spekta`, including global ignore and provider files. Direct commands such as `spekta prompt plan.md` are read-only with respect to this initialization: existing configuration remains readable, but bootstrap does not create or update home-managed files. `SPEKTA_HOME_OVERRIDE` is intended for tests and development; it is not required as an agent integration mechanism.

## OpenRouter (default)

Providers without a `type` field default to OpenRouter and require OPENROUTER_API_KEY.

```yaml
providers:
  - name: DeepSeek R1 (Free)
    model: deepseek/deepseek-r1:free
```

## Google Gemini

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

## `.spektaignore`

Spekta respects a custom ignore hierarchy. Patterns are cumulative and follow this priority (bottom takes precedence):

1. **Managed Defaults:** the packaged `default.ignore` asset shipped with Spekta
2. **Global User:** `~/.spekta/.spektaignore` (Your personal global defaults)
3. **Workspace:** `./.spektaignore` (Project-specific overrides)

**Note:** Add personal global patterns to `~/.spekta/.spektaignore` or project-specific patterns to `./.spektaignore`. Existing `.spektadefaultignore` files are legacy and are no longer read or modified.

### Whitelisting Git-ignored files

If a file is ignored by `.gitignore` but you want Spekta to have access to it, you can whitelist it using the `!` prefix in your `.spektaignore`:

```text
# .spektaignore
!node_modules/my-important-config/
```

This will allow Spekta tools (read, rg search, etc.) to access the path even if it remains ignored by Git.
