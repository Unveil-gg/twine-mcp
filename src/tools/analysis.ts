/**
 * Story analysis MCP tools: analyze_story, get_story_stats, search_passages.
 * Variable/tag tools (find_variable_usage, check_tag_consistency) live in
 * analysis-vars.ts to keep file size under 300 lines.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStoryStore } from '../types.js';
import { buildLinkGraph } from '../story-store.js';
import { findCycles, reachableFrom } from '../util/graph-algos.js';
import { ok, err } from './stories.js';
import { storyNotFoundMsg } from '../util/errors.js';
import type { AnalysisReport, BrokenLink } from '../types.js';

/**
 * Registers core story analysis tools on the MCP server.
 * Call registerAnalysisVarTools (analysis-vars.ts) separately.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance
 */
export function registerAnalysisTools(
  server: McpServer,
  store: IStoryStore,
): void {
  /** analyze_story */
  server.registerTool(
    'analyze_story',
    {
      description:
        'Run a comprehensive structural analysis of a story. ' +
        'Returns broken links, dead ends, orphans, unreachable passages, ' +
        'cycles, word count, branching factor, and tag usage. ' +
        'This is the primary plot consistency check.',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const graph = buildLinkGraph(full);
      const names = new Set(full.passages.map((p) => p.name));

      const brokenLinks: BrokenLink[] = full.passages.flatMap((p) =>
        p.links
          .filter((l) => !names.has(l))
          .map((l) => ({ from: p.name, target: l })),
      );

      const ENDING_TAG = 'ending';
      const deadEnds = full.passages
        .filter(
          (p) => p.links.length === 0 && !p.tags.includes(ENDING_TAG),
        )
        .map((p) => p.name);

      const referenced = new Set(Object.values(graph).flat());
      const orphans = full.passages
        .filter(
          (p) =>
            !referenced.has(p.name) && p.name !== full.startPassage,
        )
        .map((p) => p.name);

      const reachable = reachableFrom(graph, full.startPassage);
      const unreachable = full.passages
        .map((p) => p.name)
        .filter((n) => !reachable.has(n));

      const cycles = findCycles(graph);

      const totalWords = full.passages.reduce(
        (s, p) => s + p.wordCount,
        0,
      );
      const branchPoints = full.passages.filter(
        (p) => p.links.length > 1,
      ).length;
      const avgOut =
        full.passages.length > 0
          ? full.passages.reduce((s, p) => s + p.links.length, 0) /
            full.passages.length
          : 0;

      const tagUsage: Record<string, number> = {};
      for (const p of full.passages) {
        for (const t of p.tags) {
          tagUsage[t] = (tagUsage[t] ?? 0) + 1;
        }
      }

      const report: AnalysisReport = {
        storyName: full.name,
        passageCount: full.passageCount,
        wordCount: totalWords,
        avgWordsPerPassage:
          full.passageCount > 0
            ? Math.round(totalWords / full.passageCount)
            : 0,
        branchPoints,
        branchingFactor: Math.round(avgOut * 100) / 100,
        brokenLinks,
        deadEnds,
        orphans,
        unreachable,
        cycles,
        tagUsage,
        estimatedReadingMinutes: Math.ceil(totalWords / 200),
      };
      return ok(report);
    },
  );

  /** get_story_stats */
  server.registerTool(
    'get_story_stats',
    {
      description:
        'Get word count, passage count, reading time estimate, ' +
        'and tag usage breakdown for a story.',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));

      const totalWords = full.passages.reduce(
        (s, p) => s + p.wordCount,
        0,
      );
      const tagUsage: Record<string, number> = {};
      for (const p of full.passages) {
        for (const t of p.tags) {
          tagUsage[t] = (tagUsage[t] ?? 0) + 1;
        }
      }
      const linkCounts = full.passages.map((p) => p.links.length);
      const maxLinks = Math.max(0, ...linkCounts);
      const endingCount = full.passages.filter(
        (p) => p.tags.includes('ending') || p.links.length === 0,
      ).length;

      return ok({
        name: full.name,
        format: `${full.format} ${full.formatVersion}`,
        passageCount: full.passageCount,
        wordCount: totalWords,
        avgWordsPerPassage:
          full.passageCount > 0
            ? Math.round(totalWords / full.passageCount)
            : 0,
        estimatedReadingMinutes: Math.ceil(totalWords / 200),
        maxOutgoingLinks: maxLinks,
        endingPassageCount: endingCount,
        tagUsage,
        startPassage: full.startPassage,
      });
    },
  );

  /** search_passages */
  server.registerTool(
    'search_passages',
    {
      description:
        'Search passage text and/or names across a story. ' +
        'Returns matching passages with their name, tags, and a preview.',
      inputSchema: {
        story: z.string().describe('Story name'),
        query: z
          .string()
          .describe('Text to search for (case-insensitive substring)'),
        search_in: z
          .enum(['text', 'name', 'tags', 'all'])
          .optional()
          .default('all')
          .describe('Where to search'),
        tag_filter: z
          .string()
          .optional()
          .describe('Additional filter: only passages with this tag'),
      },
    },
    async ({ story, query, search_in, tag_filter }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));
      const lq = query.toLowerCase();

      const matches = full.passages
        .filter((p) => {
          if (tag_filter && !p.tags.includes(tag_filter)) return false;
          if (search_in === 'text' || search_in === 'all') {
            if (p.text.toLowerCase().includes(lq)) return true;
          }
          if (search_in === 'name' || search_in === 'all') {
            if (p.name.toLowerCase().includes(lq)) return true;
          }
          if (search_in === 'tags' || search_in === 'all') {
            if (p.tags.some((t) => t.toLowerCase().includes(lq)))
              return true;
          }
          return false;
        })
        .map((p) => ({
          name: p.name,
          tags: p.tags,
          preview: p.preview,
          wordCount: p.wordCount,
        }));

      return ok({ query, count: matches.length, matches });
    },
  );
}
