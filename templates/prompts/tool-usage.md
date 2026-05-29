## Tool Instructions: `spekta`

When you need to read files or search for patterns across the codebase, you must generate commands using the `spekta` CLI tool. All output **must** be redirected to a file named `result.md` for analysis.

### `spekta read` – View file contents

- **Syntax:** `spekta read path/to/file.ts[start,end] >> result.md`
- **Line Ranges (Optional):** Use `[start,end]` to target specific sections. Omit for full file contents.
- **Redirection:** Always append to `result.md`.

### `spekta grep` – Search for patterns

- **Syntax:** `spekta grep <pattern> [path] [--glob <glob>] >> result.md`
- **Pattern:** Required regex or string pattern to search for.
- **Path/Glob:** Optional filters for directory and file types.
- **Redirection:** Always append to `result.md`.

### Formatting & Execution Rules

1.  **Single Command Block:** Always wrap your command in **one** markdown code block.
2.  **Append Mode:** Always use the `>> result.md` suffix for every command. This ensures all results are collected in a single file without overwriting previous data.
3.  **Labeling (Optional but Recommended):** You may use `echo` to add headers to `result.md` so the contents are easier to navigate.
4.  **Batching:** If multiple files need to be read or multiple searches performed, provide them as a sequence of commands within the same code block.

**Example: Reading multiple files and searching**

```bash
echo "--- File contents ---" >> result.md
spekta read src/main.ts[1,100] >> result.md
spekta read src/utils/helpers.ts >> result.md
echo "--- Search Results ---" >> result.md
spekta grep "interface.*User" --glob "**/*.ts" >> result.md
```

**Example: Searching specific directories**

```bash
spekta grep "TODO.*" src/components --glob "**/*.tsx" >> result.md
```

**Example: Reading specific line ranges**

```bash
spekta read 'configs/app settings.json'[20,50] >> result.md
```
