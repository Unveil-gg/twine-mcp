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

import { McpServer, ResourceTemplate } from
  '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from
  '@modelcontextprotocol/sdk/server/stdio.js';

import { resolveConfiguredRoots } from './config.js';
import { WorkspaceStore } from './workspace-store.js';
import { buildLinkGraph } from './story-store.js';
import { setupRootsCapability } from './util/roots-capability.js';
import { registerStoryTools } from './tools/stories.js';
import { registerPassageTools } from './tools/passages.js';
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
import { VERSION } from './version.js';

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

  const server = new McpServer({ name: 'twine-mcp', version: VERSION });

  // ── MCP `roots` capability: pick up client-advertised folders ───────────────
  setupRootsCapability(server.server, store);

  // ── Story / passage / analysis tools ────────────────────────────────────────
  registerStoryTools(server, store);
  registerPassageTools(server, store);
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

  // ── MCP Resources ─────────────────────────────────────────────────────────────

  server.resource(
    'stories',
    'twine://stories',
    { description: 'All discovered game projects in the workspace' },
    async () => ({
      contents: [{
        uri: 'twine://stories',
        mimeType: 'application/json',
        text: JSON.stringify(store.listStories(), null, 2),
      }],
    }),
  );

  server.resource(
    'story',
    new ResourceTemplate('twine://story/{name}', { list: undefined }),
    { description: 'Full story data including passages' },
    async (uri, { name }) => {
      const n = Array.isArray(name) ? name[0] : name;
      const story = store.getStoryFull(n ?? '');
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: story
            ? JSON.stringify(story, null, 2)
            : JSON.stringify({ error: `Story "${n}" not found` }),
        }],
      };
    },
  );

  server.resource(
    'story-graph',
    new ResourceTemplate('twine://story/{name}/graph', { list: undefined }),
    { description: 'Passage link graph as adjacency list' },
    async (uri, { name }) => {
      const n = Array.isArray(name) ? name[0] : name;
      const story = store.getStoryFull(n ?? '');
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: story
            ? JSON.stringify(buildLinkGraph(story), null, 2)
            : JSON.stringify({ error: `Story "${n}" not found` }),
        }],
      };
    },
  );

  server.resource(
    'story-summary',
    new ResourceTemplate('twine://story/{name}/summary', { list: undefined }),
    { description: 'Compact narrative snapshot for quick AI orientation' },
    async (uri, { name }) => {
      const n = Array.isArray(name) ? name[0] : name;
      const story = store.getStoryFull(n ?? '');
      if (!story) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ error: `Story "${n}" not found` }),
          }],
        };
      }
      const graph = buildLinkGraph(story);
      const names = new Set(story.passages.map((p) => p.name));
      const { reachableFrom } = await import('./util/graph-algos.js');
      const reachable = reachableFrom(graph, story.startPassage);
      const summary = {
        name: story.name,
        format: `${story.format} ${story.formatVersion}`,
        passageCount: story.passageCount,
        wordCount: story.wordCount,
        startPassage: story.startPassage,
        startText:
          story.passages
            .find((p) => p.name === story.startPassage)
            ?.text.slice(0, 200) ?? '',
        branchPoints: story.passages.filter((p) => p.links.length > 1).length,
        endingCount: story.passages.filter(
          (p) => p.tags.includes('ending') || p.links.length === 0,
        ).length,
        issues: {
          brokenLinks: story.passages
            .flatMap((p) => p.links.filter((l) => !names.has(l)))
            .length,
          unreachable: story.passages.filter(
            (p) => !reachable.has(p.name),
          ).length,
        },
      };
      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(summary, null, 2),
        }],
      };
    },
  );

  // ── Start transport ───────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`[twine-mcp] Fatal error: ${String(error)}\n`);
  process.exit(1);
});
