## Diff Format

**Delta Rule:** Use the most token-efficient format depending on the file operation. NEVER rewrite a full existing file for modifications. Use the following formats:

**For Modifying a File:**

```[language]
// File: path/to/file.ext
// SEARCH
[existing code snippet]
// REPLACE
[updated code snippet]
```

**For Creating a New File:**

```[language]
// File: path/to/new_file.ext (NEW FILE)
[full file content]
```

**For Deleting a File:**

```text
// File: path/to/deleted_file.ext (DELETE)
```
