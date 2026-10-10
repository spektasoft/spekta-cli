# Workspace Inspection Reference

Related guides: [README](../README.md) · [Prompts and workflows](workflows.md) · [Runtime and configuration](configuration.md) · [Codex setup](codex-setup.md)

## Search with ripgrep

Use `spekta rg` for searches. Without `-e`/`--regexp`, the first positional operand is a regex pattern and remaining operands are paths. With explicit patterns, all positional operands are paths. Omit paths to search the workspace root recursively. Repeat `-e`/`--regexp` for alternative patterns and `-g`/`--glob` for ordered inclusion or exclusion filters. Glob values remain intact, including commas. Search is case-sensitive by default; `-i`/`--ignore-case`, `-s`/`--case-sensitive`, and `-S`/`--smart-case` select a mode. Use `--` before a literal path that begins with a dash.

The supported CLI subset runs ripgrep through RTK and keeps Spekta's formatting, eligible-file restrictions, and complete response budget. Unsupported ripgrep options, stdin, empty patterns, restricted files, paths outside the workspace, and symlink escapes are rejected. Search responses are bounded by `SPEKTA_GREP_TOKEN_LIMIT` (2000 tokens by default), 500 matches, and 100 files. The environment variable keeps its historical name; no rename is required.

The MCP equivalent is `spekta_rg`, with `patterns`, `paths`, `globs`, and `case_mode` fields. Existing MCP clients should replace `spekta_grep` and its singular `pattern`, `path`, and comma-separated `globs` with the new tool and array fields. Existing `~/.spekta/tools/grep.yaml` custom definitions are no longer loaded; migrate them to `rg.yaml`, update the definition name and four parameters, and restart Spekta.

Calls to the removed CLI `spekta grep` command, including its old help forms, fail with guidance to use `spekta rg`.

Commands without a native Spekta handler and MCP `spekta_shell` requests use one fail-closed policy before RTK starts. Supported forms are `ls`, restricted `find` discovery, and the Git inspections below.

## Listing with `ls`

`ls` accepts no options and zero or one existing relative workspace-directory operand. Files, missing directories, absolute paths, restricted targets, and escaping symlinks are rejected. The listing contains only eligible entries: names denied by ignore rules, restricted-file rules, or workspace containment are omitted without any count or notice. Spekta reads the directory itself and rejects a listing it cannot attribute to real entries. A failing child is reported by exit status only, and the complete rendered response fits the proxy output budget.

## Finding paths with `find`

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

## Git inspections

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
