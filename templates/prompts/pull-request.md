Generate a Conventional Commit `pull request message` based on the following commit messages:

```markdown
{{commit_messages}}
```

The `pull request message` must strictly follow this format:

```markdown
type/branch-name

type: brief description

body of the pull request message
```

Requirements:

1. The `branch-name` must be in kebab-case derived from the `brief description`.
2. The `type` must be one of: fix, feat, docs, style, refactor, perf, test, build, ci, chore, or revert.
3. The `brief description` must start with a lowercase letter.
4. The `body` should summarize the key changes and reasoning based on the provided commit history.
5. Do not include any meta-explanation or preamble. Only output the message.
