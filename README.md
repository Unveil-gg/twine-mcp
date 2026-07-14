<p align="center">
  <img src="assets/twine-mcp-logo.png" alt="Twine MCP logo" width="160" />
</p>

<h1 align="center">Twine MCP</h1>

<p align="center">
<a href="https://www.npmjs.com/package/@unveil-gg/twine-mcp"><img src="https://img.shields.io/npm/v/@unveil-gg/twine-mcp.svg?style=flat-square" alt="npm version" hspace="3"/></a><a href="https://github.com/Unveil-gg/twine-mcp/actions/workflows/ci.yml"><img src="https://github.com/Unveil-gg/twine-mcp/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" hspace="3"/></a><a href="https://www.npmjs.com/package/@unveil-gg/twine-mcp"><img src="https://img.shields.io/npm/l/@unveil-gg/twine-mcp.svg?style=flat-square" alt="license" hspace="3"/></a><a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-8B5CF6?style=flat-square" alt="MCP compatible" hspace="3"/></a>
</p>

MCP server for AI-assisted [Twine](https://twinery.org/) interactive story authoring. Edits `.twee` files directly, provides build tooling to output playable HTML, and can export stories for visualization in the Twine GUI.

Works with **Cursor**, **Claude Code**, **Claude Desktop**, and **Codex CLI**.

---

## Setup

```bash
npm install -g @unveil-gg/twine-mcp
twine-mcp setup
```

The wizard asks for your workspace directory, picks your editor, and writes the MCP config — no manual JSON editing.

Restart your editor when done. Ask your AI to run `ping` to confirm.

<details>
<summary>Manual config</summary>

Add to your editor's MCP config (`~/.cursor/mcp.json`, `~/.claude.json`, etc.):

```json
{
  "mcpServers": {
    "twine": {
      "command": "twine-mcp",
      "env": {
        "TWINE_PROJECT": "/Users/yourname/Documents/games"
      }
    }
  }
}
```

`TWINE_PROJECT` can point to a single game folder or a workspace containing multiple games. The server discovers all projects automatically, and supports multiple workspace roots at once — including the folder open in your editor. See [DEVELOPMENT.md](DEVELOPMENT.md#workspace-roots) for details.

</details>

---

## Tools

| Category | Tools |
|----------|-------|
| **Stories** | `list_stories`, `get_story`, `create_story`, `delete_story`, `export_twee` |
| **Passages** | `list_passages`, `get_passage`, `create_passage`, `update_passage`, `delete_passage`, `rename_passage`, `set_start_passage`, `batch_update` |
| **CSS** | `get_stylesheet`, `update_stylesheet` |
| **Graph** | `get_link_graph`, `find_broken_links`, `find_dead_ends`, `find_orphans`, `find_cycles`, `get_passage_path`, `get_reachable_passages` |
| **Analysis** | `analyze_story`, `get_story_stats`, `search_passages`, `find_variable_usage`, `check_tag_consistency` |
| **Narrative** | `summarize_story`, `get_story_context`, `get_narrative_flow`, `get_all_endings`, `get_passage_context`, `get_story_branches` |
| **Project** | `create_project`, `build_story`, `validate_story`, `import_from_twine`, `export_for_twine`, `move_passage`, `list_files` |
| **Formats** | `list_story_formats`, `get_format_info`, `get_format_syntax_guide` |
| **Refactor** | `split_passage`, `merge_passages` |
| **Utility** | `ping`, `get_config`, `list_workspace_roots`, `rescan_workspace` |

**MCP Resources:** `twine://stories`, `twine://story/{name}`, `twine://story/{name}/graph`, `twine://story/{name}/summary`

### Recommended AI workflow

```
ping → summarize_story → get_story_context → get_story_branches
     → get_narrative_flow → get_passage_context → get_all_endings
```

Start cheap (`summarize_story` ≈ 200 tokens), go deeper only when needed.

---

## Contributing & development

- **[CONTRIBUTORS.md](CONTRIBUTORS.md)** — local setup, how to help, AI usage policy
- **[DEVELOPMENT.md](DEVELOPMENT.md)** — release workflow, npm auth, CI
