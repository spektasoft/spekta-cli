# spekta-cli

AI-powered CLI tools.

## Installation

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run deploy`.

## Usage

Run `spekta` and follow the prompts.

## Environment Variables

You can configure the following environment variables to customize `spekta`'s behavior:

- `SPEKTA_COMPACT_THRESHOLD`: The token threshold above which content is compacted. Defaults to `500`.
- `SPEKTA_READ_TOKEN_LIMIT`: The maximum number of tokens to read from a file. Defaults to `1000`.

## Configuring Providers

Providers are defined in ~/.spekta/providers.yaml.

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

## Configuration

### .spektaignore

Spekta respects a custom ignore file `.spektaignore`. This file uses the same syntax as `.gitignore`.

#### Location & Priority

1. **Global:** `~/.spekta/.spektaignore` (Created automatically on first run)
2. **Workspace:** `./.spektaignore`

Patterns are cumulative. Workspace patterns take precedence over Global patterns.

#### Whitelisting / Overriding Git

If a file is ignored by `.gitignore` but you want Spekta to have access to it, you can whitelist it using the `!` prefix in your `.spektaignore`:

```text
# .spektaignore
!node_modules/my-important-config/
```

This will allow Spekta tools (read, grep, etc.) to access the path even if it remains ignored by Git.
