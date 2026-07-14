# Development guide

Internal reference for maintainers — release workflow, npm auth, and CI.

---

## Release workflow

Version tags must match `package.json`. The git tag gets a `v` prefix; the package version does not.

| `package.json` | Git tag |
|----------------|---------|
| `0.1.0` | `v0.1.0` |
| `0.2.0` | `v0.2.0` |

### Steps for each release

```bash
# 1. Bump version in package.json
# 2. Commit
git add package.json
git commit -m "chore: bump version to 0.2.0"

# 3. Tag (must match package.json with v prefix)
git tag v0.2.0

# 4. Push commit and tag — CI publishes to npm
git push
git push origin v0.2.0
```

Pushing a `v*` tag triggers [`.github/workflows/publish.yml`](.github/workflows/publish.yml), which:

1. Validates the tag matches `package.json`
2. Runs `npm ci`, build, and tests
3. Publishes to npm with the `NPM_TOKEN` secret
4. Opens a GitHub issue if anything fails

npm does not allow republishing the same version. Every release needs a new version bump.

### Manual publish (fallback)

If CI is unavailable:

```bash
npm run build
npm test
npm publish --access public
```

---

## npm authentication

### Local machine (recommended)

```bash
npm login
```

This opens a browser and saves credentials to `~/.npmrc`. Use this for day-to-day publishing.

### Local machine (access token)

If you prefer a granular access token from [npmjs.com/settings/tokens](https://www.npmjs.com/settings/tokens):

```bash
npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN_HERE
```

This writes to your **user-level** `~/.npmrc`. Never commit tokens to the repo.

**Security rules:**

- Do not put tokens in `package.json`, `.npmrc` in the repo, or docs
- Do not paste tokens in issues, PRs, or chat
- Revoke and rotate immediately if a token is exposed
- Use GitHub Actions secrets (`NPM_TOKEN`) for CI — not repo files

### GitHub Actions

The publish workflow reads `secrets.NPM_TOKEN`. Add it at:

**Repo → Settings → Secrets and variables → Actions → New repository secret**

Name: `NPM_TOKEN`  
Value: your npm granular access token (Automation or Publish type)

---

## Project scripts

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run dev          # tsc --watch
npm start            # run MCP server (stdio)
npm run setup        # interactive setup wizard
npm test             # vitest
```

`prepublishOnly` runs `npm run build` automatically before `npm publish`.

---

## CI overview

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push/PR to `main` | Lint, build, and test; open issue on failure |
| `publish.yml` | Push tag `v*` | Build, test, publish to npm; open issue on failure |

---

## Versioning notes

- **0.x.y** — pre-1.0; breaking changes are acceptable while iterating
- **1.0.0** — first stable API commitment
- Bump patch for fixes, minor for features, major for breaking changes

---

## Local MCP testing

After building, point your editor at the local server (see [CONTRIBUTORS.md](CONTRIBUTORS.md)) or run:

```bash
TWINE_LIBRARY="~/Documents/Twine/Stories" npm start
```

The server uses stdio transport — it will appear to hang in the terminal; that is normal. Your editor spawns it as a child process.

---

## Workspace roots

twine-mcp scans one or more **workspace roots** for Twee projects. Roots can come from any combination of:

- **`~/.twine-mcp/config.json`** — `{ "workspaceRoots": ["/path/a", "/path/b"] }`
- **`TWINE_WORKSPACE_ROOTS`** env var — comma- or semicolon-separated paths
- **`TWINE_PROJECT`** env var — legacy singular var, still supported, contributes one more root
- **The MCP client's own folders** — if your client (Cursor, Claude Code, Codex, etc.) advertises the `roots` capability, the folder(s) it has open are added automatically. This works even if that folder was never listed in your config — for example, a repo you just opened with a freshly `create_project`-scaffolded game inside it.

All of these are combined (unioned), not replaced — a client's open folder never hides your configured roots, and vice versa.

Run `list_workspace_roots` (or `get_config`) at any time to see the exact set of roots being scanned. Discovery re-scans automatically on every `list_stories`/`get_config` call, and immediately after `create_project`/`import_from_twine` — no server restart needed. `rescan_workspace` is available if you want to trigger a re-scan explicitly.

If the same story name is discovered under two different roots, `list_stories` will show both (differentiated by `filePath`), and tools that look a story up by name will raise a clear "ambiguous story name" error rather than silently picking one — rename one of the projects to resolve it.
