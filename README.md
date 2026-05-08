# spekta-cli

AI-powered CLI tools.

## Installation

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run deploy`.

## Usage

Run `spekta` and follow the prompts.

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
