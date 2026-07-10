#!/usr/bin/env node
/**
 * twine-mcp — MCP server for Twine interactive story authoring.
 *
 * Transport: stdio (default for Cursor, Claude Desktop, VS Code)
 *
 * Modes:
 *   Library mode  (default): watches ~/Documents/Twine/Stories/*.html
 *   Project mode  (new):     reads/writes src/**\/*.twee in a Git project
 *
 * Environment variables:
 *   TWINE_PROJECT=/path/to/project   → project mode
 *   TWINE_LIBRARY=/path/to/stories   → library mode with custom path
 *
 * Usage:
 *   npx @unveil-gg/twine-mcp
 *   twine-mcp setup           ← interactive first-run wizard
 *   TWINE_PROJECT=/my/game twine-mcp
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

import {
  resolveLibraryPath,
  ensureLibraryExists,
  resolveProjectRoot,
  getServerMode,
} from './config.js';
import { StoryStore, buildLinkGraph } from './story-store.js';
import { ProjectStore } from './project-store.js';
import type { IStoryStore } from './types.js';
import { registerStoryTools, ok, err } from './tools/stories.js';
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
import { listCachedFormats } from './format-manager.js';
import { VERSION } from './version.js';

async function main(): Promise<void> {
  const mode = getServerMode();
  let store: IStoryStore;
  let projectStore: ProjectStore | null = null;
  let libraryPath = '';

  if (mode === 'project') {
    const projectRoot = resolveProjectRoot()!;
    projectStore = new ProjectStore(projectRoot);
    await projectStore.init();
    store = projectStore;
    process.stderr.write(
      `[twine-mcp] v${VERSION} — project mode. Root: ${projectRoot}\n`,
    );
  } else {
    libraryPath = resolveLibraryPath();
    ensureLibraryExists(libraryPath);
    const storyStore = new StoryStore(libraryPath);
    await storyStore.init();
    store = storyStore;
    process.stderr.write(
      `[twine-mcp] v${VERSION} — library mode. Library: ${libraryPath}\n`,
    );
  }

  const server = new McpServer({ name: 'twine-mcp', version: VERSION });

  // ── Core tools (both modes) ──────────────────────────────────────────────
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

  // ── Project-mode tools ───────────────────────────────────────────────────
  if (projectStore) {
    registerProjectTools(server, projectStore);
  }

  // ── Utility tools ────────────────────────────────────────────────────────

  /** ping */
  server.registerTool(
    'ping',
    {
      description:
        'Health check. Returns server version, operating mode, ' +
        'and story/project info.',
      inputSchema: {},
    },
    async () => {
      const stories = store.listStories();
      return ok({
        status: 'ok',
        version: VERSION,
        mode,
        ...(mode === 'project' && projectStore
          ? {
              projectRoot: projectStore.projectRoot,
              storyName: stories[0]?.name ?? null,
              passageCount: stories[0]?.passageCount ?? 0,
            }
          : {
              libraryPath,
              storyCount: stories.length,
            }),
        cachedFormats: listCachedFormats(),
      });
    },
  );

  /** get_config */
  server.registerTool(
    'get_config',
    {
      description: 'Return current server configuration and operating mode.',
      inputSchema: {},
    },
    async () =>
      ok({
        version: VERSION,
        mode,
        ...(mode === 'project' && projectStore
          ? { projectRoot: projectStore.projectRoot }
          : { libraryPath }),
        platform: process.platform,
        nodeVersion: process.version,
        cachedFormats: listCachedFormats(),
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
          | import('extwee').Passage | undefined;
        if (!p) { failed.push(u.passage); continue; }
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

  server.resource(
    'stories',
    'twine://stories',
    { description: 'All stories in the library or current project' },
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

  // ── Start transport ──────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`[twine-mcp] Fatal error: ${String(error)}\n`);
  process.exit(1);
});
