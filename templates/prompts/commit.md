Generate a Conventional Commit `commit message` based on the following Git diff:

```markdown
{{diff}}
```

The `commit message` should be strictly in this format:

```markdown
type: brief description

body of the commit message
```

The `type` must be one of the following: fix, feat, docs, style, refactor, perf, test, build, ci, chore, or revert.

Identify the `type` from the diff, create a `brief description`, and include a `body of the commit message` that explains the changes or reasoning. The body must also include a list of file changes under a `Changes:` header. In the list, include the file status (e.g., Created, Modified) and a summary of the change for that file.

Example of the body format:

```markdown
This commit introduces a new feature for user profile customization, allowing users to upload an avatar and set a display name.

Changes:

- Modified `routes/api.php`: Added new endpoint for profile updates.
- Created `app/Http/Controllers/ProfileController.php`: Implemented logic for handling profile changes.
- Modified `resources/js/components/Profile.vue`: Built the front-end interface for user settings.
```

The `brief description` should start with a lowercase letter. Do not include any explanations, only provide the `commit message`.
