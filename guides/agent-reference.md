# Agent command and recovery reference

Related guides: [Workspace inspection](inspection.md) · [Codex setup and compatibility](codex-setup.md) · [Runtime and configuration](configuration.md)

Use Spekta for supported operations on workspace files. It applies workspace eligibility, ignore rules, and response limits before returning results. Run `spekta help <command>` for the current syntax; MCP equivalents are listed in command help.

## Choose a command

| Need                                      | Command                                                           | What it returns                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Read original file content                | `spekta read README.md`                                           | Complete original lines, within the response budget                                        |
| Read a range or structure                 | `spekta read 'src/main.ts[20,60]'` · `spekta read --overview src` | Inclusive, 1-based original lines, or an explicitly requested structural overview          |
| List entries in directories               | `spekta ls src docs`                                              | Immediate eligible entries                                                                 |
| Discover paths under roots                | `spekta find src test -type f -name '*.ts'`                       | Eligible paths matching supported predicates                                               |
| Search multiple roots                     | `spekta rg -e 'TODO' -e 'FIXME' src docs`                         | Eligible matches with an outcome for each requested root                                   |
| Inspect repository changes                | `spekta git status --short` · `spekta git diff -- src/file.ts`    | Supported, filtered Git inspection                                                         |
| Identify the configured build and budgets | `spekta status --global --codex`                                  | Executable/build identity, hook routing, component states, and effective operation budgets |

`read` accepts literal paths; it does not expand globs. Use `find` or `rg` for discovery and search. `ls` is not recursive. `find` accepts zero or more roots before at most one `-type f|d` and one `-name PATTERN`; predicates may be in either order. `rg` accepts repeated `-e` patterns, roots, and ordered `-g` globs. These commands implement documented subsets, not the full native `find` or ripgrep grammar.

## Bounded reads and recovery

Response allowances cover the complete rendered response, including metadata and outcome text. Defaults and configured ceilings are reported by `spekta status --global --codex`; a valid positive `--allowance TOKENS` overrides a default up to that operation's ceiling. Current shipped defaults and ceilings are:

| Operation                | Default | Ceiling |
| ------------------------ | ------: | ------: |
| Read                     |   1,000 |   8,000 |
| Search                   |   2,000 |  16,000 |
| Discovery (`ls`, `find`) |   1,000 |   8,000 |
| Git inspection           |   1,000 |   8,000 |

For a long read, Spekta returns a contiguous chunk of complete original lines and a `Next range`. Continue with that range and the returned version marker:

```bash
spekta read --expected-version 'VERSION_MARKER' 'src/main.ts[61,100]'
```

Use the exact next range and marker from the response. A version mismatch returns no content; restart from the original range without an expected version. A single line that cannot fit is withheld. For mixed read batches, outcomes are reported per operand and readable files share one allowance; continue chunks separately because an expected version applies to exactly one path. If batch metadata cannot fit, split the batch. `--overview` is opt-in and may omit original source evidence.

Search overflow cancels the search and withholds every match. Narrow roots, pattern, path, or glob first; request more tokens only when the useful result needs them and the configured ceiling allows it. A requested root that is unavailable or incomplete makes the requested scope incomplete even if other roots have no matches. Do not interpret those results as a complete search.

Search has a 30-second default deadline; `--deadline-ms MS` sets a request deadline, and caller cancellation also stops the search. Long searches report bounded phase/heartbeat progress; MCP sends progress only when the caller supplied a progress token. `--profile` adds aggregate preparation and search timings when the response allowance has room; timing is suppressed for denied or partial scopes. An incomplete or cancelled search is not a complete negative result.

For discovery overflow, narrow roots or predicates; split a metadata-heavy root batch. `ls` has no pagination. For Git overflow, narrow the operation or paths. A Git response shows only eligible paths. `status` can include eligible untracked files, but native ignored untracked files do not appear. `diff` is a tracked comparison and omits new untracked content, so an empty diff does not establish that the workspace is unchanged.

## Workspace routing and RTK

Use Spekta for supported workspace reads, discovery, search, and Git inspection. The Codex hook rewrites supported standalone shell requests to Spekta; explicit `rtk` commands stay on the normal RTK route. Use `rtk cat` or `rtk rg` for authorized reads/searches outside the event workspace, such as an installed skill under your home directory. Normal host approvals and filesystem permissions still apply.

The hook does not execute the pending command; Codex handles the rewritten command under its usual approval and sandbox rules. A path spelled as inside the workspace that escapes through a symlink remains subject to Spekta's policy. If Spekta refuses an operation, do not retry it through native shell, RTK, MCP, or another route. Unsupported or compound shell forms continue through the normal shell path and are not evidence that Spekta policy allowed the operation.

## Git scope and handoff

Spekta supports `status`, `log`, `show`, `diff`, and read-only `branch` inspection. Use the operation-specific help for accepted flags and operands. Put options before `--`; give literal relative workspace paths after `--`. `show REV:path` accepts one repository-relative blob selector. Unsupported flags, pathspec magic, workspace overrides, and mutating Git commands are rejected. Results are filtered to eligible paths, including historical paths; excluded names, contents, counts, and existence are not disclosed.

When handing off local work, provide an explicit changed-file list and a brief description for each file. `spekta git status` is an eligible Git view, not a complete tracker of every local change: policy-hidden paths and files not represented by Git status may be absent. State separately when a change is outside that summary rather than inferring that no other changes exist.

## Build and hook status

Invoke status through the same executable or absolute entrypoint used for the command being attributed. Status reports the resolved executable and on-disk artifact hash when available, build version, build-time source revision/state, configured hook routing, component states, and effective read/search/discovery/Git budgets. Unknown identity or provenance remains unknown; build-time source metadata does not prove correspondence to the source currently on disk, and timestamps do not prove correspondence.

Configured hook presence is distinct from trust and activation. Status reports trust and activation separately and provides runtime verification steps; configuration alone does not establish either. Follow those steps in the intended Codex session to confirm which hook handles requests. An executable hash identifies on-disk bytes and does not prove which bytes an already-running process loaded.
