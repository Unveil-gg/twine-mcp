# @unveil-gg/twine-mcp

MCP server for [Twine](https://twinery.org/) interactive story authoring. Connects to your Twine story library and gives AI tools for passage editing, link-graph analysis, plot consistency checks, and narrative intelligence.

Works with **Cursor**, **Claude Code**, **Claude Desktop**, and **Codex CLI**.

---

## Setup (2 commands)

```bash
npm install -g @unveil-gg/twine-mcp
twine-mcp setup
```

The wizard auto-detects your Twine library, asks which editor you use, and writes (or copies) the MCP config — no manual JSON editing.

Restart your editor when done. Ask your AI to run `ping` to confirm the connection.

<details>
<summary>Manual config (if you prefer)</summary>

Add to your editor's MCP config (`~/.cursor/mcp.json`, `~/.claude.json`, etc.):

```json
{
  "mcpServers": {
    "twine": {
      "command": "twine-mcp",
      "env": {
        "TWINE_LIBRARY": "/Users/yourname/Documents/Twine/Stories"
      }
    }
  }
}
```

The library path is auto-detected from Twine's settings or defaults to `~/Documents/Twine/Stories`.

</details>

---

## What can it do?

| Category | Examples |
|----------|----------|
| **Story management** | List, create, delete, export Twee, compile HTML |
| **Passage CRUD** | Create, edit, rename passages (rewrites `[[links]]`) |
| **Graph analysis** | Broken links, dead ends, orphans, cycles, path finding |
| **Plot checking** | Full analysis report, variable usage, tag consistency |
| **Narrative intelligence** | Story summary, branch map, endings audit — token-efficient for AI |
| **Format awareness** | Harlowe, SugarCube, Chapbook syntax guides |

### Recommended AI workflow

```
ping → summarize_story → get_story_context → get_story_branches
     → get_narrative_flow → get_passage_context → get_all_endings
```

Start cheap (`summarize_story` ≈ 200 tokens), go deeper only when needed.

---

## Tool reference

<details>
<summary><strong>Story management</strong></summary>

| Tool | Description |
|------|-------------|
| `list_stories` | List all stories with metadata. Supports `fields` filter. |
| `get_story` | Full story data. Toggle `include_passages` and `compact`. |
| `create_story` | Create new story file with a Start passage. |
| `delete_story` | Delete a story file permanently. |
| `export_twee` | Export as Twee 3 source text. |
| `compile_story` | Produce a proofing HTML file at a given output path. |

</details>

<details>
<summary><strong>Passage CRUD</strong></summary>

| Tool | Description |
|------|-------------|
| `list_passages` | All passages with name, tags, word count. |
| `get_passage` | Full content + tags + outgoing links. |
| `create_passage` | Add a new passage with optional content, tags, position. |
| `update_passage` | Edit text, tags, or editor position. |
| `delete_passage` | Remove a passage. |
| `rename_passage` | Rename + rewrite all `[[links]]` pointing to old name. |
| `set_start_passage` | Change the story starting passage. |

</details>

<details>
<summary><strong>Graph & navigation</strong></summary>

| Tool | Description |
|------|-------------|
| `get_link_graph` | Full adjacency list or compact counts. |
| `find_broken_links` | Links to non-existent passages. |
| `find_dead_ends` | Passages with no outgoing links (not tagged `ending`). |
| `find_orphans` | Passages no other passage links to. |
| `find_cycles` | Circular link paths. |
| `get_passage_path` | Shortest path between two passages (BFS). |
| `get_reachable_passages` | All passages reachable from start + unreachable list. |

</details>

<details>
<summary><strong>Story analysis</strong></summary>

| Tool | Description |
|------|-------------|
| `analyze_story` | Comprehensive report: broken links, dead ends, orphans, cycles, stats. |
| `get_story_stats` | Word count, reading time, tag usage, branch stats. |
| `search_passages` | Full-text + tag search across all passages. |
| `find_variable_usage` | Format-aware variable set/read tracking. |
| `check_tag_consistency` | Rare tags, high-tag passages, untagged passage count. |

</details>

<details>
<summary><strong>Narrative intelligence</strong></summary>

| Tool | Description |
|------|-------------|
| `summarize_story` | Cheapest orientation call. ~500 tokens max. |
| `get_story_context` | Configurable bundle. Supports `fields` + `compact`. |
| `get_narrative_flow` | Prose in DFS order. Supports `max_depth` + `max_passages`. |
| `get_all_endings` | All terminal passages + upstream paths. |
| `get_passage_context` | Upstream paths + content + outgoing for one passage. |
| `get_story_branches` | Branch points with sub-tree reachability counts. |

</details>

<details>
<summary><strong>Format awareness & utility</strong></summary>

| Tool | Description |
|------|-------------|
| `list_story_formats` | Built-in + user-installed formats. |
| `get_format_info` | Description, docs URL, and usage in library. |
| `get_format_syntax_guide` | Syntax reference for Harlowe, SugarCube, Chapbook, Snowman. |
| `ping` | Health check + library path + story count. |
| `get_config` | Server config. |
| `batch_update` | Atomic multi-passage edit in one save. |

**MCP Resources:** `twine://stories`, `twine://story/{name}`, `twine://story/{name}/graph`, `twine://story/{name}/summary`

</details>

---

## Token efficiency

Every tool supports conventions to minimize token cost:

- **`fields`** — select which properties to return
- **`compact: true`** — name + 80-char preview only
- **`max_depth` / `max_passages`** — bound traversal output
- Passage text is never included in list/graph tools by default

---

## How it works

Watches `~/Documents/Twine/Stories/*.html` via [chokidar](https://github.com/paulmillr/chokidar), parses with [extwee](https://github.com/videlais/extwee), and splices writes back into the original HTML. TwineJS reloads on focus.

Twine has no plugin API — this server operates entirely through the file system.

---

## Contributing & development

- **[CONTRIBUTORS.md](CONTRIBUTORS.md)** — local setup, how to help, AI usage policy
- **[DEVELOPMENT.md](DEVELOPMENT.md)** — release workflow, npm auth, CI

---

## Limitations

- Desktop/Electron Twine only (web/PWA not supported)
- Passage text is opaque source (macros are not executed)
- Format conversion is guidance only, not automated
