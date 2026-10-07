#!/usr/bin/env node
/**
 * twine-mcp — MCP server for Twine interactive story authoring.
 *
 * Transport: stdio (default for Cursor, Claude Code, Claude Desktop)
 *
 * Workspace roots (a Twee project may live under any of these):
 *   - ~/.twine-mcp/config.json → { "workspaceRoots": [...] }
 *   - TWINE_WORKSPACE_ROOTS=/a,/b  — comma/semicolon-separated list
 *   - TWINE_PROJECT=/path          — legacy singular var (still works)
 *   - Folders advertised by the MCP client itself, if it supports the
 *     `roots` capability (e.g. the folder open in the editor). These
 *     are additive to the above, never a replacement for them.
 *
 * Usage:
 *   npx @unveil-gg/twine-mcp
 *   twine-mcp setup        ← interactive first-run wizard
 */

import { McpServer } from
  '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from
  '@modelcontextprotocol/sdk/server/stdio.js';

import { resolveConfiguredRoots } from './config.js';
import { WorkspaceStore } from './workspace-store.js';
import { setupRootsCapability } from './util/roots-capability.js';
import { registerStoryTools } from './tools/stories.js';
import { registerPassageTools } from './tools/passages.js';
import { registerPassagePatchTool } from './tools/passage-patch.js';
import { registerGraphTools } from './tools/graph.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerAnalysisVarTools } from './tools/analysis-vars.js';
import { registerNarrativeTools } from './tools/narrative.js';
import { registerNarrativeFlowTools } from './tools/narrative-flow.js';
import { registerFormatTools } from './tools/formats.js';
import { registerCssTools } from './tools/css.js';
import { registerProjectTools } from './tools/project.js';
import { registerRefactorTools } from './tools/refactor.js';
import { registerAgentNotesTools } from './tools/agent-notes.js';
import { registerUtilityTools } from './tools/utility.js';
import { registerStoryResources } from './resources/stories.js';
import {
  notifyStoryUpdated,
  registerResourceSubscriptions,
} from './resources/subscriptions.js';
import { registerNarrativePrompts } from './prompts/narrative.js';
import { VERSION } from './version.js';

const INSTRUCTIONS =
  'Read summarize_story or twine://stories/{name}/manifest before ' +
  'editing. Do not request a full Twee or HTML dump. Read one passage ' +
  'with get_passage. Use patch_passage for local edits and ' +
  'update_passage only to replace a whole passage. Layout coordinates ' +
  'are omitted unless include_layout is true.';

async function main(): Promise<void> {
  // Route `setup` subcommand before starting the MCP server
  if (process.argv[2] === 'setup') {
    const { runSetup } = await import('./cli/setup.js');
    await runSetup();
    return;
  }

  const configuredRoots = resolveConfiguredRoots();
  const store = new WorkspaceStore(configuredRoots);
  await store.init();

  const games = store.listStories();
  process.stderr.write(
    `[twine-mcp] v${VERSION} — configured roots: ` +
    `${configuredRoots.length ? configuredRoots.join(', ') : '(none)'} ` +
    `(${games.length} game${games.length === 1 ? '' : 's'} found)\n`,
  );
  if (configuredRoots.length === 0) {
    process.stderr.write(
      '[twine-mcp] no workspaceRoots configured — waiting for the ' +
      'client to advertise its own roots (see the `roots` MCP capability)\n',
    );
  }
  if (games.length > 0) {
    process.stderr.write(
      `[twine-mcp] games: ${games.map((g) => g.name).join(', ')}\n`,
    );
  }

  const server = new McpServer(
    { name: 'twine-mcp', version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  // ── MCP `roots` capability: pick up client-advertised folders ───────────────
  setupRootsCapability(server.server, store);

  // ── Story / passage / analysis tools ────────────────────────────────────────
  registerStoryTools(server, store);
  registerPassageTools(server, store);
  registerPassagePatchTool(server, store);
  registerGraphTools(server, store);
  registerAnalysisTools(server, store);
  registerAnalysisVarTools(server, store);
  registerNarrativeTools(server, store);
  registerNarrativeFlowTools(server, store);
  registerFormatTools(server, store);
  registerCssTools(server, store);
  registerRefactorTools(server, store);
  registerProjectTools(server, store);
  registerAgentNotesTools(server, store);
  registerUtilityTools(server, store);

  registerStoryResources(server, store);
  const subscriptions = registerResourceSubscriptions(server);
  registerNarrativePrompts(server, store);
  store.enableSourceWatch((projectRoot) => {
    const name = store.storyNameForRoot(projectRoot);
    if (!name) return;
    void notifyStoryUpdated(server.server, subscriptions, name)
      .catch((error: unknown) => {
        process.stderr.write(
          `[twine-mcp] resource notify failed: ${String(error)}\n`,
        );
      });
  });

  // ── Start transport ───────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`[twine-mcp] Fatal error: ${String(error)}\n`);
  process.exit(1);
});
