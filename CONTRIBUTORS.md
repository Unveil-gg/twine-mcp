# Contributing to @unveil-gg/twine-mcp

Thanks for helping improve the Twine MCP server. This guide covers local setup, how to contribute, and our policies on AI-assisted development.

---

## Local setup

### Prerequisites

- **Node.js 20+**
- **npm**
- **Twine** (desktop/Electron) with at least one story in your library
- An MCP-compatible editor (Cursor, Claude Code, Claude Desktop, or Codex CLI)

### Clone and run from source

```bash
git clone https://github.com/Unveil-gg/twine-mcp
cd twine-mcp
npm install
npm run build
npm test
```

### Point your editor at the local build

Instead of the globally installed package, use the compiled entry point:

```json
{
  "mcpServers": {
    "twine": {
      "command": "node",
      "args": ["/absolute/path/to/twine-mcp/dist/server.js"],
      "env": {
        "TWINE_LIBRARY": "/Users/you/Documents/Twine/Stories"
      }
    }
  }
}
```

Or run the setup wizard against your local build:

```bash
node dist/server.js setup
```

### Useful scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | TypeScript watch mode |
| `npm start` | Run MCP server (stdio) |
| `npm test` | Run vitest suite |
| `npm run setup` | Interactive MCP config wizard |

See [DEVELOPMENT.md](DEVELOPMENT.md) for release workflow, npm publishing, and CI details.

---

## How to help

### Good first contributions

- Bug fixes with a clear repro
- Documentation improvements
- Test coverage for graph/analysis utilities
- Story format regex patterns (Harlowe, SugarCube, Chapbook)

### Before you open a PR

1. **Search existing issues** — avoid duplicate work
2. **Keep diffs focused** — one concern per PR when possible
3. **Run the test suite** — `npm test` must pass
4. **Follow existing style** — see [AGENTS.md](AGENTS.md) for agent/human coding guidelines
5. **Keep files under 300 lines** — split modules if needed

### Pull request checklist

- [ ] Change is scoped and explained in the PR description
- [ ] Tests added or updated where behavior changed
- [ ] README or tool docs updated if user-facing behavior changed
- [ ] No secrets, tokens, or local paths committed

### Reporting bugs

Include:

- OS and Node version
- Editor (Cursor, Claude Code, etc.)
- Twine story format (Harlowe, SugarCube, …)
- Steps to reproduce
- Expected vs actual behavior

---

## AI usage policy

We welcome AI-assisted development — this project is built for AI tooling — but contributions must meet the same quality bar as fully human-written code.

### Allowed

- Using AI to explore the codebase, draft implementations, write tests, or improve docs
- Using Cursor, Claude Code, Copilot, or similar during development
- Using this MCP server to test Twine integration while building features

### Required

- **You are responsible for every line you submit.** Read, understand, and be able to explain your changes
- **No blind copy-paste.** AI output must be reviewed, adapted to project conventions, and tested
- **Disclose significant AI assistance** in PR descriptions when it shaped the approach (a brief note is enough)
- **Do not commit AI-generated secrets** — tokens, `.env` values, or personal file paths

### Not allowed

- Submitting unreviewed AI output without running tests
- Using AI to generate large unrelated refactors mixed with feature work
- Committing generated code that duplicates existing utilities
- Publishing or sharing npm tokens, API keys, or credentials in issues, PRs, or docs

### For maintainers reviewing AI-assisted PRs

Apply the same review standards: correctness, scope, tests, security, and readability. AI assistance is not a reason to skip review.

---

## Code style

See [AGENTS.md](AGENTS.md) for concise style rules (Google TS guide, line length, commit format).

---

## Questions?

Open a [GitHub issue](https://github.com/Unveil-gg/twine-mcp/issues) for bugs, feature ideas, or setup help.
