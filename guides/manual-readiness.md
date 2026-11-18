# Manual readiness check before push or merge (native Windows)

This is a manual check for native Windows. It does not assume CI exists. WSL is a separate future workflow. Smoke checks do not replace the full suite.

## 1. Record the candidate and environment

Choose the candidate revision to check. Before selecting tests, identify the comparison base that matches the target of the push or merge. Record the base and candidate's full SHAs; include changes already committed between those trees as well as local changes. Do not assume a reported commit contains the intended changes without checking it. If the appropriate base is unknown or disputed, mark changed-file selection **INCOMPLETE** and ask the human to choose it.

In PowerShell, capture:

```powershell
git rev-parse HEAD
git status --short --untracked-files=all
git diff --cached --name-only
git diff --name-only
$PSVersionTable.PSVersion
node --version
npm.cmd --version
git --version
rtk --version
Get-Command script.exe
script.exe --version
```

For committed changes, the proposed comparison form is `git diff --name-only <base-sha> <candidate-sha>`. The placeholders must be replaced with the agreed full SHAs. This comparison form has not been validated in this procedure; confirm the base/candidate meaning and command result before using the path list.

Also record Windows edition/build and architecture. If `script.exe` cannot be found or its version check fails, record the real-Git portion as **INCOMPLETE**. The current real-Git harness requires `git`, `rtk`, and `script` to run. The observed Windows `script.exe` is from Cygwin; this procedure does not claim Cygwin-free operation. Do not install it or change PATH/security settings as part of this check.

## 2. Select tests related to changed files

Before selecting tests, combine the changed paths from the committed-tree comparison with staged paths, unstaged paths, and relevant new/untracked paths from `git status`. This covers the candidate's committed changes since the chosen base plus local work. For each changed source file, test input, fixture, or relevant configuration file, select direct tests and relevant integration/adapter tests, and record why they cover the change. Keep the comparison base and explicit test-file list the same for all repetitions of a candidate.

Do not rely on Vitest `--changed` as the only selector: its comparison baseline and coverage for this repository have not been established. Do not choose a baseline silently. If the baseline or relevant test mapping is unclear, this portion is **INCOMPLETE**; ask for human direction rather than assuming no tests apply.

When code changes have no clear test mapping, ask the affected subsystem maintainer or reviewer to identify the tests. Until the mapping is clear, mark this portion **INCOMPLETE**. An empty test list for code changes, test inputs, fixtures, or relevant configuration is also **INCOMPLETE**. The changed-file test step may be **NOT REQUIRED** only when the baseline is clear and the complete committed-plus-local path set shows documentation-only changes that do not affect test inputs or configuration; record the paths and reason. This does not claim broad test coverage for every kind of input or data file.

For an approved explicit file list, the proposed Vitest form is:

```powershell
npm.cmd test -- --run <test-file-1> <test-file-2>
```

Replace the placeholders with the selected test paths; do not type the angle brackets literally. This command form is based on the package's `vitest` script and Vitest's `run` filters, but has not been validated as part of this procedure. The file list is not permission to run tests on unchanged files; get human approval for the exact selection before running it.

## 3. Run the two smoke checks in this order

First run the portable smoke:

```powershell
npm.cmd run test:smoke:portable
```

It uses a fixed allowlist: `src/commands/proxy/proxy-execution.real.test.ts` and `src/api/mcp-server-process.integration.test.ts`. These checks use real child processes; the MCP process test also builds into a temporary `.mcp-process-*` directory in the project root and removes it during teardown. The wrapper writes a JSON report under OS temp and removes it afterward. The checks need installed development dependencies, Node.js/npm available to child processes, permission to spawn processes, and a writable project root. They do not need provider credentials.

Then run the required real-Git smoke:

```powershell
npm.cmd run test:smoke:real-git
```

It selects `src/commands/proxy/proxy-git.integration.test.ts` and sets `SPEKTA_REQUIRE_GIT_INTEGRATION=1` for that Vitest process. It requires runnable `git`, `rtk`, and `script` (currently the observed Cygwin `script.exe`). It creates and removes temporary real Git repositories and an OS-temp JSON report. Do not call this check Cygwin-free. The proposed separation of the non-PTY Git smoke from Unix/WSL pager coverage is an unimplemented potential dependency; this procedure does not change the harness or remove its shared prerequisite gate.

Both smoke wrappers validate the JSON report. The selected file must appear and have nonempty passing results, with no failed, skipped, pending, todo, or disabled tests. Record each command, elapsed time, exit code, test counts, skips, missing prerequisites, and any temporary-output or cleanup issue.

## 4. Record outcomes

- **PASS:** every applicable required check completes successfully, all selected tests pass without skips, and the total sequence is within the 10-minute upper limit. Record separately whether it met the preferred 2–3-minute target.
- **FAIL:** a selected test assertion or required check fails after it starts and returns a test result.
- **INCOMPLETE:** a required prerequisite is missing; a required test is skipped, missing, or empty; changed-file selection is unclear or empty for code changes; a command cannot start; a timeout occurs; or the result/cleanup evidence is unavailable. In particular, missing `script` makes the required real-Git portion **INCOMPLETE**, never passed.
- **NOT REQUIRED:** only for the changed-file test step when all changed paths are documentation-only and do not affect test inputs or configuration; record the paths and reason. Other empty selections are **INCOMPLETE**. The two smoke checks remain required.
- **OVER BUDGET:** if the full sequence takes more than 10 minutes, record that result and let an active process finish. Do not stop it without human authorization. Treat the sequence as not passed even if its individual checks passed. A completed sequence above 3 minutes but at or below 10 minutes misses the target but is within the upper limit.

If a check times out, mark it **INCOMPLETE**; a timeout is never a pass.

## 5. Repeat on the same candidate

For the initial sample, run the complete applicable sequence three times with the same comparison base, revision, working-tree state, environment, prerequisites, and explicit test selection. Record base and candidate revisions and status before and after each repetition. Do not edit or stage/unstage files between runs. If relevant source/test state or the selected list changes, begin a new sample. Three successful runs are limited initial evidence, not proof of long-term reliability or universal merge readiness.

Previous measurements at one Windows candidate took 75.597–95.176 seconds for the two smoke commands and before/after state checks. The one-time environment inventory and later evidence reporting were outside that timing. This is not a measured end-to-end human workflow time. Treat 2–3 minutes as the target and 10 minutes as the upper limit; measure the actual agreed workflow before claiming either is met.

## Keep broader checks separate

The existing `npm.cmd run lint` invokes `eslint .` across the repository; its configuration applies rules to source TypeScript/TSX and excludes generated/build/dependency/config paths. The initial fast routine leaves whole-project lint out. `npm.cmd run build` runs Vite and writes generated build output; the initial routine leaves this standalone build out. There is no standalone typecheck/static-analysis script in `package.json`. These exclusions do not override project instructions to format and lint/static-check changed files when applicable. Do not use `npm.cmd run lint:fix` as a check; it can edit files. `npm.cmd run deploy` also refreshes the global CLI link and is not part of readiness.

The human runs the full suite separately on the final pre-merge candidate. The proposed one-shot command is `npm.cmd test -- --run`, based on the package's `vitest` script and Vitest's `run` mode; this PowerShell command form was not validated in this session. Confirm it before using it. This procedure does not include a full-suite result. Native Windows configuration excludes eight parser-backed test files because Tree-sitter is unavailable:

- `src/utils/compactor.test.ts`
- `src/utils/compactor/compactor.compatibility.test.ts`
- `src/utils/compactor/engine.compactable-tier.test.ts`
- `src/utils/compactor/engine.test.ts`
- `src/utils/compactor/function-regions.test.ts`
- `src/utils/compactor/index.test.ts`
- `src/utils/compactor/parser.test.ts`
- `src/utils/compactor/test-regions.test.ts`

Record those exclusions with the Windows full-suite result. WSL coverage is separate; a Windows smoke or full-suite result does not stand in for it.
