# Commit Code Review Rule

Before creating any git commit, review the code with the `code-reviewer` subagent first.

## Workflow

1. **Before committing** — when the user asks to commit, or I am about to run `git commit`, first stage the intended changes (prefer specific files over `git add .`).
2. **Delegate the review** — invoke the `code-reviewer` subagent on the staged changes (scope it with `git diff --staged`). Wait for its prioritized findings.
3. **Act on findings**:
   - **Critical / High** — do NOT commit. Surface these to the user, fix them (or get the user's call), then re-review.
   - **Medium / Low / Nit** — report them to the user briefly. Proceed with the commit unless the user wants them addressed first.
4. **Then commit** — only create the commit after the review is clean or the user has explicitly accepted the remaining findings.

## Notes

- This applies to commits I create on the user's behalf. It does not change the existing rule that commits are only made when the user explicitly asks.
- Keep the review scoped to what is being committed (the staged diff), not the whole codebase.
- If the `code-reviewer` agent is unavailable for any reason, tell the user before committing rather than silently skipping the review.
