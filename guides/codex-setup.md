# Codex setup and compatibility

Related guides: [README](../README.md) · [Workspace inspection](inspection.md) · [Prompts and workflows](workflows.md) · [Runtime and configuration](configuration.md)

Spekta configures its Codex hook and instructions through `spekta setup`; the same integration can be inspected with `spekta status` and removed with `spekta uninstall`. These commands operate on global Codex configuration. The hook routes a narrow set of shell inspection commands through Spekta's existing workspace policies.

## Prerequisites and setup

Deploy Spekta so both `spekta` and `spekta-codex-hook` are executable on `PATH`. To configure the hook and instructions, preview the plan and apply it:

```bash
spekta setup --global --codex --dry-run
spekta setup --global --codex --apply
spekta status --global --codex
```

The preview displays planned file actions and contents without writing. Apply writes the changes. Spekta owns one `PreToolUse` hook entry in `~/.codex/hooks.json` and a marked section in `~/.codex/AGENTS.md`. It preserves unrelated JSON properties, hooks, and instruction text. It checks active global and workspace hook sources for conflicting or ambiguous Bash hooks; when it cannot interpret them safely, it refuses and reports which source needs review. Resolve such conflicts manually before retrying.

The hook matches Codex's `Bash` tool. Setup does not establish trust, activation, or project trust. Review and trust the exact hook through Codex's `/hooks` interface. Use the runtime verification steps from `spekta status --global --codex` to confirm that the configured hook is active. Codex's normal approval and sandbox handling still applies after a command is rewritten. The hook is fail-open on its own errors and is not a security boundary; if Spekta rejects a rewritten operation under workspace policy, do not retry the original command through another route.

## Optional MCP registration

MCP can be registered as an optional stdio server alongside the hook. It requires both Spekta executables on `PATH` and Codex CLI 0.160.1 or newer so Spekta can verify the session-workspace launch contract. Preview and apply it with `--mcp`:

```bash
spekta setup --global --codex --dry-run --mcp
spekta setup --global --codex --apply --mcp
```

Start a new Codex session after registration to load the opt-in server. MCP setup is checked for compatibility and configuration conflicts; an incompatible Codex version, missing executable, or ambiguous existing MCP configuration causes a refusal with diagnostics.

## Supported hook requests

On the verified platform, the hook recognizes literal standalone `ls`, `find`, `cat`, `sed`, and `rg` requests, plus the supported `rtk rg` wrapper form. Search routing supports repeated `-e`/`--regexp` patterns, multiple path operands, `-i`/`--ignore-case`, `-s`/`--case-sensitive`, `-S`/`--smart-case`, repeated intact `-g`/`--glob` values, and `--` option termination. The hook preserves argument order and quoting, and rewrites these requests to `spekta rg`. Spekta applies workspace and eligible-file restrictions and its complete-response budget; if it rejects a request or exceeds that budget, do not retry the original native command or another route. Unsupported native flags, stdin, pattern files, substitutions, redirections, pipelines, expansions, and compound shell syntax pass through unchanged. Read routing accepts `cat PATH` with no options, and `sed -n 'START,ENDp' PATH` or `sed -n 'STARTp' PATH` with one path; starts are positive decimal line numbers, and a numeric end must be at least the start (or `$`).

The hook reads one event up to 64 KiB and has a two-second stdin deadline. A rewrite asks Codex to run the transformed command; the hook itself never executes the pending command. Codex still applies its usual approval and sandbox handling, and Spekta performs its filesystem policy checks during execution.

## Compatibility

Hook routing was verified for Codex CLI 0.160.0 and 0.160.1 on local Linux with Bash. This is a bounded compatibility record, not a promise about later releases. Zsh, native Windows, and remote/cloud execution are not verified. The hook depends on the deployed `spekta-codex-hook` executable being available in the environment where Codex runs it.

## Remove the integration

Preview and then apply removal:

```bash
spekta uninstall --global --codex --dry-run
spekta uninstall --global --codex --apply
```

Uninstall removes Spekta-owned hook and instruction content, preserving unrelated Codex settings and text. It can refuse when owned content was changed ambiguously, so inspect its diagnostic and preview before applying. This operation does not remove the globally linked Spekta CLI; remove that separately with `npm unlink --global spekta-cli`. Personal Spekta settings under `~/.spekta` are retained unless you explicitly remove them yourself.

## Owned configuration

The global Codex instruction file is `~/.codex/AGENTS.md`. The hook configuration is `~/.codex/hooks.json`, using the documented `hooks.PreToolUse` command-hook shape. The hook matches Codex's `Bash` tool and invokes the stable absolute `spekta-codex-hook` executable resolved from `PATH`; paths containing spaces are quoted in the proposed command.

Spekta owns one `PreToolUse` event entry whose matcher is `^(Bash)$` and whose nested command handler invokes `spekta-codex-hook`. Its shared instruction ownership identifiers are `<!-- spekta:codex-usage:start -->` and `<!-- spekta:codex-usage:end -->`. Duplicate, malformed, or unexpectedly edited owned content makes the preview refuse with a repair diagnostic. Unrelated JSON properties, hooks, and instruction prose are preserved in the proposed content.

The owned instructions prefer CLI operations, allow MCP only as an explicitly enabled fallback when the CLI is unavailable, identify the supported discovery/read/search/Git operation families, direct focused retrieval, and forbid retries through another path after policy rejection.

## Official Codex references

The hook event and response shape, `Bash` matching, timeout, and trust behavior follow Codex's [hooks documentation](https://developers.openai.com/codex/hooks) and [advanced configuration documentation](https://developers.openai.com/codex/config-advanced). The global `AGENTS.md` instruction source follows Codex's documented user-level instruction discovery from `~/.codex`.

The command reference in [README](../README.md) covers installation and first use. For the exact accepted command-line syntax, use `spekta setup --help`, `spekta status --help`, and `spekta uninstall --help`.
