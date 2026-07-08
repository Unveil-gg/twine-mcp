#!/usr/bin/env node
/**
 * twine-mcp — MCP server for Twine interactive story authoring.
 *
 * Transport: stdio (default for Cursor, Claude Desktop, VS Code)
 *
 * Startup:
 *   npx @unveil/twine-mcp
 *   twine-mcp setup              ← interactive first-run wizard
 *   TWINE_LIBRARY=/path/to/stories twine-mcp
 */

// Route the `setup` subcommand before importing the heavy MCP SDK.
if (process.argv[2] === 'setup') {
  const { runSetup } = await import('./cli/setup.js');
  await runSetup();
  process.exit(0);
}

import { McpServer, ResourceTemplate } from
  '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from
  '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import { resolveLibraryPath, ensureLibraryExists } from './config.js';
import { StoryStore, buildLinkGraph } from './story-store.js';
import { registerStoryTools, ok, err } from './tools/stories.js';
import { registerPassageTools } from './tools/passages.js';
import { registerGraphTools } from './tools/graph.js';
import { registerAnalysisTools } from './tools/analysis.js';
import { registerAnalysisVarTools } from './tools/analysis-vars.js';
import { registerNarrativeTools } from './tools/narrative.js';
import { registerNarrativeFlowTools } from './tools/narrative-flow.js';
import { registerFormatTools } from './tools/formats.js';

async function main(): Promise<void> {
  const libraryPath = resolveLibraryPath();
  ensureLibraryExists(libraryPath);

  const store = new StoryStore(libraryPath);
  await store.init();

  const server = new McpServer({
    name: 'twine-mcp',
    version: '0.1.0',
  });

  // ── Tool registration ────────────────────────────────────────────────────
  registerStoryTools(server, store);
  registerPassageTools(server, store);
  registerGraphTools(server, store);
  registerAnalysisTools(server, store);
  registerAnalysisVarTools(server, store);
  registerNarrativeTools(server, store);
  registerNarrativeFlowTools(server, store);
  registerFormatTools(server, store);

  // ── Utility tools ────────────────────────────────────────────────────────

  /** ping */
  server.registerTool(
    'ping',
    {
      description: 'Health check. Returns server version and library path.',
      inputSchema: {},
    },
    async () =>
      ok({
        status: 'ok',
        version: '0.1.0',
        libraryPath,
        storyCount: store.listStories().length,
      }),
  );

  /** get_config */
  server.registerTool(
    'get_config',
    {
      description: 'Return current server configuration.',
      inputSchema: {},
    },
    async () =>
      ok({
        libraryPath,
        platform: process.platform,
        nodeVersion: process.version,
      }),
  );

  /** batch_update — atomic multi-passage edit */
  server.registerTool(
    'batch_update',
    {
      description:
        'Apply multiple passage updates to a story in a single atomic save. ' +
        'Each update must specify a passage name. ' +
        'Specify text, tags, or position to update each field.',
      inputSchema: {
        story: z.string().describe('Story name'),
        updates: z
          .array(
            z.object({
              passage: z.string().describe('Passage name'),
              text: z.string().optional(),
              tags: z.array(z.string()).optional(),
              position: z.string().optional(),
            }),
          )
          .min(1)
          .describe('List of passage updates to apply'),
      },
    },
    async ({ story, updates }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(`Story "${story}" not found.`);
      const applied: string[] = [];
      const failed: string[] = [];

      for (const u of updates) {
        const p = storyObj.getPassageByName(u.passage) as
          | import('extwee').Passage
          | undefined;
        if (!p) {
          failed.push(u.passage);
          continue;
        }
        if (u.text !== undefined) p.text = u.text;
        if (u.tags !== undefined) p.tags = u.tags;
        if (u.position !== undefined) {
          const meta = (p.metadata ?? {}) as Record<string, string>;
          meta['position'] = u.position;
          p.metadata = meta;
        }
        applied.push(u.passage);
      }

      if (applied.length > 0) store.saveStory(storyObj);
      return ok({ applied, failed });
    },
  );

  // ── MCP Resources ────────────────────────────────────────────────────────

  /** twine://stories — story index */
  server.resource(
    'stories',
    'twine://stories',
    { description: 'All stories in the library' },
    async () => ({
      contents: [
        {
          uri: 'twine://stories',
          mimeType: 'application/json',
          text: JSON.stringify(store.listStories(), null, 2),
        },
      ],
    }),
  );

  /** twine://story/{name} — full story */
  server.resource(
    'story',
    new ResourceTemplate('twine://story/{name}', { list: undefined }),
    { description: 'Full story data including passages' },
    async (uri, { name }) => {
      const n = Array.isArray(name) ? name[0] : name;
      const story = store.getStoryFull(n ?? '');
      const text = story
        ? JSON.stringify(story, null, 2)
        : JSON.stringify({ error: `Story "${n}" not found` });
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text }],
      };
    },
  );

  /** twine://story/{name}/graph — passage link graph */
  server.resource(
    'story-graph',
    new ResourceTemplate('twine://story/{name}/graph', { list: undefined }),
    { description: 'Passage link graph as adjacency list' },
    async (uri, { name }) => {
      const n = Array.isArray(name) ? name[0] : name;
      const story = store.getStoryFull(n ?? '');
      const text = story
        ? JSON.stringify(buildLinkGraph(story), null, 2)
        : JSON.stringify({ error: `Story "${n}" not found` });
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text }],
      };
    },
  );

  /** twine://story/{name}/summary — compact narrative snapshot */
  server.resource(
    'story-summary',
    new ResourceTemplate('twine://story/{name}/summary', {
      list: undefined,
    }),
    { description: 'Compact narrative snapshot for quick AI orientation' },
    async (uri, { name }) => {
      const n = Array.isArray(name) ? name[0] : name;
      const story = store.getStoryFull(n ?? '');
      if (!story) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Story "${n}" not found` }),
            },
          ],
        };
      }
      const graph = buildLinkGraph(story);
      const names = new Set(story.passages.map((p) => p.name));
      const brokenCount = story.passages
        .flatMap((p) => p.links.filter((l) => !names.has(l)))
        .length;
      const { reachableFrom } = await import('./util/graph-algos.js');
      const reachable = reachableFrom(graph, story.startPassage);
      const unreachableCount = story.passages.filter(
        (p) => !reachable.has(p.name),
      ).length;
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
        branchPoints: story.passages.filter((p) => p.links.length > 1)
          .length,
        endingCount: story.passages.filter(
          (p) => p.tags.includes('ending') || p.links.length === 0,
        ).length,
        issues: {
          brokenLinks: brokenCount,
          unreachable: unreachableCount,
        },
      };
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  // ── Start transport ──────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[twine-mcp] Server started. Library: ${libraryPath}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`[twine-mcp] Fatal error: ${String(error)}\n`);
  process.exit(1);
});
