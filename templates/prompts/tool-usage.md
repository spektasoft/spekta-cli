## Tool Instructions: `spekta`

When you need to read files or search for patterns across your codebase, you must generate commands using the `spekta` CLI tool.

### `spekta read` – View file contents

- **Syntax:** `spekta read path/to/file.ts[start,end] 'path with spaces.ts'`
- **Line Ranges (Optional):** Use `[start,end]` to target specific sections. Omit for full file contents.
- **Granularity:** When using ranges, target specific functions, classes, or relevant interfaces.

### `spekta grep` – Search for patterns

- **Syntax:** `spekta grep <pattern> [path] [--glob <glob>]`
- **Pattern:** Required regex or string pattern to search for (e.g., `"TODO"`, `"class.*Service"`)
- **Path (Optional):** Starting directory for search (defaults to current directory if omitted)
- **Glob (Optional):** Filter files using glob patterns (e.g., `--glob "**/*.ts"` for TypeScript files)
- **Use Cases:** Finding function usages, TODO comments, interface implementations, or config values across multiple files.

### Formatting Rules

- **Single Command Block:** Always wrap your command in **one** markdown code block for easy copy-pasting.
- **Batching:** Combine multiple operations into a single command when possible (e.g., multiple reads). For grep, one search pattern per command.
- **Choose Wisely:**
  - Use `read` when you know the exact file(s) and need to inspect content.
  - Use `grep` when searching for patterns across unknown/many files.

**Example:**

```bash
spekta read src/main.ts[1,100] src/types.ts 'configs/app settings.json'[20,50]
```

```bash
spekta grep "TODO.*" --glob "**/*.ts"
```

```bash
spekta grep "interface.*User" src/models --glob "**/*.d.ts"
```
