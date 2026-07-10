/**
 * Narrative flow MCP tools: get_narrative_flow, get_all_endings,
 * get_passage_context, get_story_branches.
 *
 * Split from narrative.ts to keep files under 300 lines.
 * Import and register via registerNarrativeFlowTools in server.ts.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStoryStore } from '../types.js';
import { buildLinkGraph } from '../story-store.js';
import {
  dfsOrdered,
  reachableFrom,
  upstreamPaths,
} from '../util/graph-algos.js';
import { ok, err } from './stories.js';

/**
 * Registers flow/traversal narrative tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance
 */
export function registerNarrativeFlowTools(
  server: McpServer,
  store: IStoryStore,
): void {
  /** get_narrative_flow */
  server.registerTool(
    'get_narrative_flow',
    {
      description:
        'Walk the story graph from the start passage using DFS and return ' +
        'passages in traversal order with their full content. ' +
        'Best for reading the story as a sequence. ' +
        'Use max_depth and max_passages to bound token cost.',
      inputSchema: {
        story: z.string().describe('Story name'),
        from: z
          .string()
          .optional()
          .describe('Start passage (defaults to story start)'),
        max_depth: z
          .number()
          .optional()
          .default(20)
          .describe('Maximum link-follow depth'),
        max_passages: z
          .number()
          .optional()
          .default(30)
          .describe('Maximum passages to return'),
      },
    },
    async ({ story, from, max_depth, max_passages }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);
      const graph = buildLinkGraph(full);
      const start = from ?? full.startPassage;
      const passageMap = new Map(full.passages.map((p) => [p.name, p]));

      if (!passageMap.has(start)) {
        return err(`Passage "${start}" not found.`);
      }

      const order = dfsOrdered(graph, start, max_depth, max_passages);
      const flow = order.map(({ name, depth }) => {
        const p = passageMap.get(name);
        return {
          name,
          depth,
          text: p?.text ?? '',
          links: p?.links ?? [],
          tags: p?.tags ?? [],
        };
      });

      return ok({
        start,
        passageCount: flow.length,
        totalPassages: full.passageCount,
        truncated: flow.length < full.passageCount,
        flow,
      });
    },
  );

  /** get_all_endings */
  server.registerTool(
    'get_all_endings',
    {
      description:
        'Return all terminal passages (no outgoing links, or tagged "ending") ' +
        'plus upstream paths to each. Use this to audit how each ending ' +
        'is reached and whether the narrative is satisfying.',
      inputSchema: {
        story: z.string().describe('Story name'),
        max_paths: z
          .number()
          .optional()
          .default(3)
          .describe('Max upstream paths to show per ending'),
      },
    },
    async ({ story, max_paths }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);
      const graph = buildLinkGraph(full);

      const endings = full.passages.filter(
        (p) => p.links.length === 0 || p.tags.includes('ending'),
      );

      const result = endings.map((p) => {
        const paths = upstreamPaths(graph, p.name, max_paths);
        return {
          name: p.name,
          tags: p.tags,
          text: p.text,
          upstreamPaths: paths,
        };
      });

      return ok({ endingCount: result.length, endings: result });
    },
  );

  /** get_passage_context */
  server.registerTool(
    'get_passage_context',
    {
      description:
        'For a given passage, return its full content, all upstream paths ' +
        'that lead to it, and all outgoing options. ' +
        'Critical for catching plot contradictions: "how did the player get here?"',
      inputSchema: {
        story: z.string().describe('Story name'),
        passage: z.string().describe('Passage name'),
        max_upstream_paths: z
          .number()
          .optional()
          .default(5)
          .describe('Max upstream paths to return'),
      },
    },
    async ({ story, passage, max_upstream_paths }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);
      const p = full.passages.find((x) => x.name === passage);
      if (!p) return err(`Passage "${passage}" not found.`);
      const graph = buildLinkGraph(full);
      const paths = upstreamPaths(graph, passage, max_upstream_paths);
      const outgoing = p.links.map((l) => ({
        target: l,
        exists: full.passages.some((x) => x.name === l),
      }));

      return ok({
        name: p.name,
        tags: p.tags,
        text: p.text,
        wordCount: p.wordCount,
        upstreamPaths: paths,
        outgoing,
        isStart: full.startPassage === passage,
        isEnding: p.links.length === 0 || p.tags.includes('ending'),
      });
    },
  );

  /** get_story_branches */
  server.registerTool(
    'get_story_branches',
    {
      description:
        'Return all branch points (passages with 2+ outgoing links) ' +
        'with how many passages each branch can reach. ' +
        'Understand the decision tree without reading everything.',
      inputSchema: {
        story: z.string().describe('Story name'),
        min_choices: z
          .number()
          .optional()
          .default(2)
          .describe(
            'Minimum outgoing links to be considered a branch',
          ),
      },
    },
    async ({ story, min_choices }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);
      const graph = buildLinkGraph(full);

      const order = dfsOrdered(graph, full.startPassage);
      const depthMap = new Map(order.map((n) => [n.name, n.depth]));

      const branches = full.passages
        .filter((p) => p.links.length >= min_choices)
        .map((p) => ({
          name: p.name,
          depth: depthMap.get(p.name) ?? -1,
          choices: p.links.map((t) => ({
            target: t,
            exists: full.passages.some((x) => x.name === t),
            reachableCount: reachableFrom(graph, t).size,
          })),
          preview: p.preview,
        }));

      branches.sort((a, b) => a.depth - b.depth);
      return ok({ branchCount: branches.length, branches });
    },
  );
}
