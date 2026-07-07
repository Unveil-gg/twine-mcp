# Agent Guidelines — twine-mcp

## Style
- Follow the [Google TypeScript/JavaScript Style Guide](https://google.github.io/styleguide/tsguide.html).
- Keep lines ≤ 80 chars; hard cap at 100 when unavoidable.
- Use `const` over `let`; avoid `var`.
- Prefer `async/await` over raw promise chains.
- Name booleans with `is`/`has`/`can` prefixes.

## Changes
- Make surgical, minimal diffs — touch only what is necessary.
- One concern per commit; avoid mixing refactors with feature work.
- Never duplicate logic; check existing utilities before adding new ones.
- Keep files under 300 lines; flag and discuss refactors before proceeding.

## After Every Code Change
Suggest a git commit in this format:

```
git add <changed files>
git commit -m "<type>(<scope>): <short imperative summary>"
```

Common types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.
