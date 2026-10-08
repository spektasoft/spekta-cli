# Spekta CLI

Spekta is a command-line tool for AI-assisted workspace work. It lets you read and search eligible project files, inspect repository history through a restricted Git interface, and run prompt, review, and code-change workflows. Its workspace operations apply ignore and disclosure rules before returning file information.

## Prerequisites and installation

Install Node.js and npm, then clone the Spekta source repository. Run the installation commands from the cloned `spekta-cli` directory:

```bash
git clone https://github.com/spektasoft/spekta-cli.git
cd spekta-cli
npm install
npm run deploy
```

`npm install` installs the dependencies declared by this checkout. `npm run deploy` builds Spekta and globally links both executables: `spekta` and `spekta-codex-hook`. This repository checkout is the supported installation route described here; there is no published-package installation command in this guide.

## First use

Check that the CLI is available without starting a workflow:

```bash
spekta --help
```

Help works without provider credentials and does not initialize personal configuration. Running `spekta` with no arguments opens the interactive menu and may create initial files under `~/.spekta`. For example, read an eligible file directly:

```bash
spekta read README.md
```

Use `spekta --help` for the command list and `spekta <command> --help` or `spekta help <command>` for command details. AI workflows that call a provider need that provider's credentials: OpenRouter configurations without an explicit type use `OPENROUTER_API_KEY`; Gemini configurations use `GEMINI_API_KEY`. Help and workspace inspection do not require those keys.

## Set up Codex

Spekta's Codex hook can route supported shell inspection requests through Spekta's workspace policies. Preview the proposed changes first, then apply them if they look right:

```bash
spekta setup --global --codex --dry-run
spekta setup --global --codex --apply
spekta status --global --codex
```

The setup command owns a marked Spekta section in `~/.codex/AGENTS.md` and its hook entry in `~/.codex/hooks.json`. It preserves unrelated instruction text and configuration. Preview prints planned file contents and makes no changes; apply writes them. Setup checks for competing or ambiguous active hooks and refuses when it cannot safely proceed. The hook executable must be on `PATH`. Status reports configured components, but configuration does not prove Codex has trusted or activated the hook. Review and trust the exact hook through Codex's `/hooks` interface, then follow the runtime verification steps reported by status. Project-local hooks also depend on project trust.

MCP registration is optional. It requires a compatible Codex executable on `PATH` (0.160.1 or newer for the verified session-workspace launch contract), as well as the Spekta CLI. To include it, use:

```bash
spekta setup --global --codex --dry-run --mcp
spekta setup --global --codex --apply --mcp
```

MCP registration configures an opt-in stdio server; start a new Codex session to load it. For verified platforms, hook behavior, supported command forms, and remaining limits, see [Codex setup and compatibility](guides/codex-setup.md).

## Remove Codex integration

Preview and apply integration removal before removing the CLI. Uninstall affects Spekta-owned Codex integration files and preserves unrelated Codex content; it does not remove the npm-linked CLI:

```bash
spekta uninstall --global --codex --dry-run
spekta uninstall --global --codex --apply
```

## Remove the CLI

The deployment script links this checkout under the package name `spekta-cli`. From any directory, remove that global link with npm:

```bash
npm unlink --global spekta-cli
```

This removes the CLI executables but keeps the source checkout and your personal `~/.spekta` settings. Spekta never deletes personal configuration automatically. If you also choose to delete it, inspect `~/.spekta` first: it may contain provider configuration and secrets, global ignore rules, personal prompts, and generated output. Then remove the directory explicitly:

```bash
rm -ri ~/.spekta
```

The interactive removal asks before deleting its contents. Skip this step to keep your personal settings.

## Command reference

Run `spekta --help` for every built-in command and supported proxy family, including commands not shown in the interactive menu. Use `spekta <command> --help` or `spekta help <command>` for accepted syntax and examples. For example:

```bash
spekta --help
spekta read --help
spekta git diff --help
```

The detailed references explain the limits and configuration behind common workflows:

- [Workspace inspection](guides/inspection.md): discovery, Git inspection, policy, and response limits.
- [Prompts and workflows](guides/workflows.md): prompt templates, generated output, and commit workflows.
- [Runtime and configuration](guides/configuration.md): assets, providers, environment variables, and ignore rules.
- [Codex setup and compatibility](guides/codex-setup.md): hook setup, trust, supported requests, and removal.
