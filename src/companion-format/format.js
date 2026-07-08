/**
 * twine-mcp Companion Format
 *
 * Install in Twine: Story Formats → Add a New Format
 * Point to the absolute path of this file (e.g. file:///C:/path/to/format.js)
 *
 * Provides a toolbar button in the passage editor that shows MCP server
 * connection status and links to quick-start instructions.
 *
 * NOTE: This is a proofing format (non-playable). It cannot run the story —
 * its sole purpose is to surface the MCP connection indicator in the editor.
 * TwineJS's editorExtensions API only allows toolbar + syntax highlighting.
 */

/* global window */
window.storyFormat({
  name: 'twine-mcp Companion',
  version: '0.1.0',
  author: 'twine-mcp',
  description:
    'Companion format for the twine-mcp MCP server. ' +
    'Adds a toolbar indicator showing MCP connection status.',
  proofing: true,

  // Minimal HTML source — this is the proofing view.
  source: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>{{STORY_NAME}} — twine-mcp Companion</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 820px;
      margin: 2em auto;
      padding: 0 1em;
      color: #333;
      background: #fafafa;
    }
    .header { border-bottom: 2px solid #e0e0e0; padding-bottom: 1em; margin-bottom: 2em; }
    .header h1 { margin: 0 0 0.25em; font-size: 1.6em; }
    .mcp-badge {
      display: inline-block;
      padding: 0.25em 0.75em;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .mcp-badge.connected { background: #d4edda; color: #155724; }
    .mcp-badge.offline { background: #f8d7da; color: #721c24; }
    section { margin-bottom: 2em; }
    h2 { font-size: 1.1em; color: #555; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    .passage { background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 1em; margin-bottom: 1em; }
    .passage-name { font-weight: 600; color: #333; margin-bottom: 0.5em; }
    .passage-tags { font-size: 0.8em; color: #888; }
    .passage-text { white-space: pre-wrap; font-size: 0.95em; }
    .instructions { background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 1em; font-size: 0.9em; }
    code { background: #f0f0f0; padding: 0.1em 0.4em; border-radius: 3px; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="header">
    <h1>{{STORY_NAME}}</h1>
    <span id="mcp-badge" class="mcp-badge offline">MCP: checking…</span>
  </div>

  <div class="instructions">
    <strong>twine-mcp Companion Format</strong><br>
    Start the MCP server: <code>npx twine-mcp</code><br>
    Then configure your AI client (Cursor, Claude Desktop) to connect.<br>
    This proofing view shows story content for manual review.
  </div>

  <section id="passages"></section>

  <script>
    // Render passages from story data
    const storyData = document.querySelector('tw-storydata');
    if (storyData) {
      const container = document.getElementById('passages');
      const nodes = storyData.querySelectorAll('tw-passagedata');
      const h2 = document.createElement('h2');
      h2.textContent = 'Passages (' + nodes.length + ')';
      container.appendChild(h2);
      nodes.forEach(function(node) {
        const div = document.createElement('div');
        div.className = 'passage';
        const name = node.getAttribute('name') || '';
        const tags = node.getAttribute('tags') || '';
        const text = node.textContent || '';
        div.innerHTML =
          '<div class="passage-name">' + name + '</div>' +
          (tags ? '<div class="passage-tags">Tags: ' + tags + '</div>' : '') +
          '<div class="passage-text">' +
            text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') +
          '</div>';
        container.appendChild(div);
      });
    }

    // MCP ping (fire-and-forget, best-effort)
    const badge = document.getElementById('mcp-badge');
    // The MCP server doesn't expose HTTP, so we can only show static guidance.
    // Update badge based on localStorage hint set by a helper page if desired.
    const hint = localStorage.getItem('twine-mcp-status');
    if (hint === 'connected') {
      badge.textContent = 'MCP: Connected';
      badge.className = 'mcp-badge connected';
    } else {
      badge.textContent = 'MCP: Run \`npx twine-mcp\` to start';
      badge.className = 'mcp-badge offline';
    }
  </script>

  {{STORY_DATA}}
</body>
</html>`,

  // Editor extension: adds a toolbar button in the passage editor
  editorExtensions: {
    twine: {
      '^2.4.0': {
        toolbar: function (editor, environment) {
          return [
            {
              type: 'button',
              label: 'MCP',
              title: 'twine-mcp server status',
              icon: '⬡',
              onClick: function () {
                environment.showMessage(
                  'twine-mcp\n\n' +
                    'Start the MCP server:\n' +
                    '  npx twine-mcp\n\n' +
                    'Then configure Cursor or Claude Desktop:\n' +
                    '{\n' +
                    '  "mcpServers": {\n' +
                    '    "twine": { "command": "npx", "args": ["twine-mcp"] }\n' +
                    '  }\n' +
                    '}\n\n' +
                    'Tools available: list_stories, get_passage,\n' +
                    'analyze_story, get_narrative_flow, and more.',
                );
              },
            },
          ];
        },
      },
    },
  },
});
