/**
 * Graph analysis MCP tools: link graph, broken links, dead ends,
 * orphans, cycles, path finding, reachability.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStoryStore } from '../types.js';
import { buildLinkGraph } from '../story-store.js';
import {
  findCycles,
  reachableFrom,
  shortestPath,
} from '../util/graph-algos.js';
import { ok, err } from './stories.js';
import { storyNotFoundMsg, passageNotFoundMsg } from '../util/errors.js';

/**
 * Registers all graph analysis tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance
 */
export function registerGraphTools(
  server: McpServer,
  store: IStoryStore,
): void {
  /** get_link_graph */
  server.registerTool(
    'get_link_graph',
    {
      description:
        'Return the full directed passage link graph as an adjacency list ' +
        '(passage name → array of linked passage names). ' +
        'Set compact=true to get only passage names with outgoing link counts.',
      inputSchema: {
        story: z.string().describe('Story name'),
        compact: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'When true, returns {name, outCount, inCount} per passage ' +
            'instead of full adjacency list',
          ),
      },
    },
    async ({ story, compact }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const graph = buildLinkGraph(full);

      if (!compact) return ok(graph);

      // Compute in-degree counts
      const inCount: Record<string, number> = {};
      for (const name of Object.keys(graph)) inCount[name] = 0;
      for (const targets of Object.values(graph)) {
        for (const t of targets) {
          if (inCount[t] !== undefined) inCount[t]++;
        }
      }

      const summary = Object.entries(graph).map(([name, targets]) => ({
        name,
        outCount: targets.length,
        inCount: inCount[name] ?? 0,
      }));
      return ok(summary);
    },
  );

  /** find_broken_links */
  server.registerTool(
    'find_broken_links',
    {
      description:
        'Find all [[links]] in the story that point to passages that ' +
        'do not exist. Returns {from, target} pairs.',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const names = new Set(full.passages.map((p) => p.name));
      const broken = full.passages.flatMap((p) =>
        p.links
          .filter((l) => !names.has(l))
          .map((l) => ({ from: p.name, target: l })),
      );
      return ok({ count: broken.length, brokenLinks: broken });
    },
  );

  /** find_dead_ends */
  server.registerTool(
    'find_dead_ends',
    {
      description:
        'Find passages with no outgoing links that are not tagged "ending". ' +
        'These may be unfinished branches.',
      inputSchema: {
        story: z.string().describe('Story name'),
        ending_tag: z
          .string()
          .optional()
          .default('ending')
          .describe(
            'Tag that marks intentional endings (default: "ending")',
          ),
      },
    },
    async ({ story, ending_tag }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const deadEnds = full.passages
        .filter(
          (p) =>
            p.links.length === 0 &&
            !p.tags.includes(ending_tag),
        )
        .map((p) => ({ name: p.name, tags: p.tags, preview: p.preview }));
      return ok({ count: deadEnds.length, deadEnds });
    },
  );

  /** find_orphans */
  server.registerTool(
    'find_orphans',
    {
      description:
        'Find passages that no other passage links to (orphans). ' +
        'These cannot be reached during play unless they are the start.',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const graph = buildLinkGraph(full);
      const referenced = new Set<string>(
        Object.values(graph).flat(),
      );
      const orphans = full.passages
        .filter(
          (p) => !referenced.has(p.name) && p.name !== full.startPassage,
        )
        .map((p) => ({ name: p.name, tags: p.tags, preview: p.preview }));
      return ok({ count: orphans.length, orphans });
    },
  );

  /** find_cycles */
  server.registerTool(
    'find_cycles',
    {
      description:
        'Detect circular link paths in the story. ' +
        'Loops are normal in many stories — use this to audit them.',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const graph = buildLinkGraph(full);
      const cycles = findCycles(graph);
      return ok({ count: cycles.length, cycles });
    },
  );

  /** get_passage_path */
  server.registerTool(
    'get_passage_path',
    {
      description:
        'Find the shortest passage path between two passages (BFS). ' +
        'Returns null if unreachable.',
      inputSchema: {
        story: z.string().describe('Story name'),
        from: z.string().describe('Start passage name'),
        to: z.string().describe('Target passage name'),
      },
    },
    async ({ story, from, to }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const graph = buildLinkGraph(full);
      const path = shortestPath(graph, from, to);
      return ok({ from, to, path, length: path ? path.length - 1 : null });
    },
  );

  /** get_reachable_passages */
  server.registerTool(
    'get_reachable_passages',
    {
      description:
        'Return all passage names reachable from the start passage ' +
        '(or a given passage). Also returns unreachable passages.',
      inputSchema: {
        story: z.string().describe('Story name'),
        from: z
          .string()
          .optional()
          .describe(
            'Start passage (defaults to story start passage)',
          ),
      },
    },
    async ({ story, from }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const graph = buildLinkGraph(full);
      const start = from ?? full.startPassage;
      if (!graph[start] && !full.passages.some((p) => p.name === start)) {
        return err(passageNotFoundMsg(start, story, full.passages));
      }
      const reachable = reachableFrom(graph, start);
      const allNames = full.passages.map((p) => p.name);
      const unreachable = allNames.filter((n) => !reachable.has(n));
      return ok({
        start,
        reachableCount: reachable.size,
        reachable: [...reachable],
        unreachableCount: unreachable.length,
        unreachable,
      });
    },
  );
}
