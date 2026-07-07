# twine-mcp

A locally-run MCP server for [Twine](https://twinery.org/) interactive story authoring.

Connects to Twine's story library on the file system and exposes tools for story management, passage CRUD, link-graph analysis, plot consistency checking, and AI-optimized narrative intelligence — all callable from Cursor, Claude Desktop, or any MCP-compatible AI client.

---

## Quick start

```bash
# Option A: zero-install
npx twine-mcp

# Option B: global install
npm install -g twine-mcp
twine-mcp

# Custom library path
TWINE_LIBRARY="C:/Users/you/Documents/Twine/Stories" npx twine-mcp
```

The server auto-discovers your Twine story library from:
1. `TWINE_LIBRARY` environment variable
2. Electron `app-prefs.json` (reads `storyLibraryFolderPath`)
3. OS default: `~/Documents/Twine/Stories`

---

## Cursor setup

Add to your `.cursor/mcp.json` (or user-level MCP config):

```json
{
  "mcpServers": {
    "twine": {
      "command": "npx",
      "args": ["twine-mcp"],
      "env": {
        "TWINE_LIBRARY": "C:/Users/yourname/Documents/Twine/Stories"
      }
    }
  }
}
```

---

## Claude Desktop setup

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "twine": {
      "command": "npx",
      "args": ["twine-mcp"]
    }
  }
}
```

---

## Companion format (optional)

The companion format adds a toolbar button to the Twine passage editor showing MCP status and setup instructions.

**Install:**
1. Open Twine → Story Formats → Add a New Format
2. Enter the path to `src/companion-format/format.js` as a `file://` URL:
   - Windows: `file:///C:/Users/you/Documents/Unveil/twine-mcp/twine-mcp/src/companion-format/format.js`
   - macOS/Linux: `file:///home/you/.../twine-mcp/src/companion-format/format.js`
3. Set it as a proofing format on any story to see the MCP indicator

---

## Tool reference

### Recommended AI workflow (cheapest → richest)

```
1. ping                         health check, confirm connection
2. summarize_story              ~200 tokens, orient to story structure
3. get_story_context            configurable bundle with issues list
4. get_story_branches           decision tree overview
5. get_narrative_flow           full prose in DFS order
6. get_passage_context          deep dive on a specific passage
7. get_all_endings              audit every ending path
```

### Story management
| Tool | Description |
|------|-------------|
| `list_stories` | List all stories with metadata. Supports `fields` filter. |
| `get_story` | Full story data. Toggle `include_passages` and `compact`. |
| `create_story` | Create new story file with a Start passage. |
| `delete_story` | Delete a story file permanently. |
| `export_twee` | Export as Twee 3 source text. |
| `compile_story` | Produce a proofing HTML file at a given output path. |

### Passage CRUD
| Tool | Description |
|------|-------------|
| `list_passages` | All passages with name, tags, word count. |
| `get_passage` | Full content + tags + outgoing links. |
| `create_passage` | Add a new passage with optional content, tags, position. |
| `update_passage` | Edit text, tags, or editor position. |
| `delete_passage` | Remove a passage. |
| `rename_passage` | Rename + rewrite all `[[links]]` pointing to old name. |
| `set_start_passage` | Change the story starting passage. |

### Graph & navigation
| Tool | Description |
|------|-------------|
| `get_link_graph` | Full adjacency list or compact counts. |
| `find_broken_links` | Links to non-existent passages. |
| `find_dead_ends` | Passages with no outgoing links (not tagged `ending`). |
| `find_orphans` | Passages no other passage links to. |
| `find_cycles` | Circular link paths. |
| `get_passage_path` | Shortest path between two passages (BFS). |
| `get_reachable_passages` | All passages reachable from start + unreachable list. |

### Story analysis
| Tool | Description |
|------|-------------|
| `analyze_story` | Comprehensive report: broken links, dead ends, orphans, cycles, stats. |
| `get_story_stats` | Word count, reading time, tag usage, branch stats. |
| `search_passages` | Full-text + tag search across all passages. |
| `find_variable_usage` | Format-aware variable set/read tracking (Harlowe, SugarCube, Chapbook). |
| `check_tag_consistency` | Rare tags, high-tag passages, untagged passage count. |

### Narrative intelligence (AI-optimized)
| Tool | Description |
|------|-------------|
| `summarize_story` | Cheapest orientation call. ~500 tokens max. |
| `get_story_context` | Configurable bundle. Supports `fields` + `compact` params. |
| `get_narrative_flow` | Prose in DFS order. Supports `max_depth` + `max_passages`. |
| `get_all_endings` | All terminal passages + upstream paths. |
| `get_passage_context` | Upstream paths + content + outgoing for one passage. |
| `get_story_branches` | Branch points with sub-tree reachability counts. |

### Story format awareness
| Tool | Description |
|------|-------------|
| `list_story_formats` | Built-in + user-installed formats. |
| `get_format_info` | Description, docs URL, and usage in library. |
| `get_format_syntax_guide` | Concise syntax reference for Harlowe, SugarCube, Chapbook, Snowman. |

### Utility
| Tool | Description |
|------|-------------|
| `ping` | Health check + library path + story count. |
| `get_config` | Server config. |
| `batch_update` | Atomic multi-passage edit in one save. |

### MCP Resources
| URI | Description |
|-----|-------------|
| `twine://stories` | Story index |
| `twine://story/{name}` | Full story data |
| `twine://story/{name}/graph` | Passage link graph |
| `twine://story/{name}/summary` | Compact narrative snapshot |

---

## Token efficiency conventions

Every tool follows these conventions to minimize token cost:

- **`fields`** — select which properties to return (e.g. `["name","tags"]`)
- **`compact: true`** — passage lists return name + 80-char preview only
- **`max_depth` / `max_passages`** — bound traversal output
- Passage text is **never included** in list/graph tools by default
- `get_story_context(fields=["meta","issues"], compact=true)` ≈ 200 tokens

---

## How it works

twine-mcp watches `~/Documents/Twine/Stories/*.html` with [chokidar](https://github.com/paulmillr/chokidar). Files are parsed using [extwee](https://github.com/videlais/extwee). Writes splice updated `<tw-storydata>` back into the original HTML — preserving the embedded story format. TwineJS detects file changes on focus and reloads automatically.

**Twine has no plugin API or HTTP server** — this server operates entirely through the file system. The companion story format adds a cosmetic toolbar button but cannot perform deeper integration.

---

## Development

```bash
git clone <repo>
cd twine-mcp
npm install
npm run build        # compile TypeScript
npm start            # run server
npm test             # run tests (vitest)
```

---

## Scope & limitations

- Desktop/Electron Twine only (v1 — web/PWA localStorage not supported)
- Passage text is treated as opaque source (macros/widgets are not executed)
- Format conversion (Harlowe → SugarCube) is guidance only, not automated
- `compile_story` produces a proofing HTML; fully playable output requires a story format bundle
