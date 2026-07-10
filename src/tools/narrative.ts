/**
 * Narrative Intelligence MCP tools — orientation and context.
 *
 * Tools: summarize_story, get_story_context
 * Flow tools (get_narrative_flow, get_all_endings, get_passage_context,
 * get_story_branches) live in narrative-flow.ts.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStoryStore } from '../types.js';
import { buildLinkGraph } from '../story-store.js';
import {
  reachableFrom,
  findCycles,
} from '../util/graph-algos.js';
import { ok, err } from './stories.js';
import type { BrokenLink } from '../types.js';

/**
 * Registers orientation narrative tools on the MCP server.
 * Call registerNarrativeFlowTools (narrative-flow.ts) separately for flow tools.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance
 */
export function registerNarrativeTools(
  server: McpServer,
  store: IStoryStore,
): void {
  /** summarize_story — cheapest orientation call */
  server.registerTool(
    'summarize_story',
    {
      description:
        'Return a minimal narrative snapshot of a story: title, format, ' +
        'passage count, start passage text, branch count, ending count, ' +
        'and top issues. Designed to be the first and cheapest call (~500 tokens).',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);
      const graph = buildLinkGraph(full);
      const names = new Set(full.passages.map((p) => p.name));

      const startText =
        full.passages.find((p) => p.name === full.startPassage)?.text
          .slice(0, 200) ?? '(start passage not found)';
      const branchPoints = full.passages.filter(
        (p) => p.links.length > 1,
      ).length;
      const endingCount = full.passages.filter(
        (p) => p.tags.includes('ending') || p.links.length === 0,
      ).length;
      const brokenCount = full.passages
        .flatMap((p) => p.links.filter((l) => !names.has(l)))
        .length;
      const reachable = reachableFrom(graph, full.startPassage);
      const unreachableCount = full.passages.filter(
        (p) => !reachable.has(p.name),
      ).length;

      const issues: string[] = [];
      if (brokenCount > 0)
        issues.push(`${brokenCount} broken link(s)`);
      if (unreachableCount > 0)
        issues.push(`${unreachableCount} unreachable passage(s)`);

      return ok({
        name: full.name,
        format: `${full.format} ${full.formatVersion}`,
        passageCount: full.passageCount,
        wordCount: full.wordCount,
        startPassage: full.startPassage,
        startText,
        branchPoints,
        endingCount,
        topIssues: issues,
      });
    },
  );

  /** get_story_context — configurable bundle */
  server.registerTool(
    'get_story_context',
    {
      description:
        'Return a configurable bundle of story data for AI orientation. ' +
        'Use fields to select what to include; use compact=true to omit ' +
        'full passage text. Recommended first call: ' +
        'fields=["meta","issues"], compact=true (~200 tokens).',
      inputSchema: {
        story: z.string().describe('Story name'),
        fields: z
          .array(z.enum(['meta', 'graph', 'passages', 'issues']))
          .optional()
          .default(['meta', 'issues'])
          .describe('Data sections to include'),
        compact: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'Compact mode: passage list returns name+preview only, ' +
            'graph returns counts not adjacency list',
          ),
        max_passages: z
          .number()
          .optional()
          .default(50)
          .describe(
            'Max passages to include in passages section (compact=false only)',
          ),
      },
    },
    async ({ story, fields, compact, max_passages }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);
      const graph = buildLinkGraph(full);
      const names = new Set(full.passages.map((p) => p.name));
      const result: Record<string, unknown> = {};

      if (fields.includes('meta')) {
        result['meta'] = {
          name: full.name,
          ifid: full.ifid,
          format: full.format,
          formatVersion: full.formatVersion,
          startPassage: full.startPassage,
          passageCount: full.passageCount,
          wordCount: full.wordCount,
          lastModified: full.lastModified,
        };
      }

      if (fields.includes('graph')) {
        if (compact) {
          const inCounts: Record<string, number> = {};
          for (const n of Object.keys(graph)) inCounts[n] = 0;
          for (const targets of Object.values(graph)) {
            for (const t of targets) {
              if (inCounts[t] !== undefined) inCounts[t]++;
            }
          }
          result['graph'] = Object.entries(graph).map(([n, targets]) => ({
            name: n,
            out: targets.length,
            in: inCounts[n] ?? 0,
          }));
        } else {
          result['graph'] = graph;
        }
      }

      if (fields.includes('passages')) {
        const sliced = full.passages.slice(0, max_passages);
        result['passages'] = compact
          ? sliced.map((p) => ({
              name: p.name,
              tags: p.tags,
              wordCount: p.wordCount,
              preview: p.preview,
            }))
          : sliced;
        if (full.passages.length > max_passages) {
          result['passagesTruncated'] = true;
          result['passagesTotalCount'] = full.passages.length;
        }
      }

      if (fields.includes('issues')) {
        const broken: BrokenLink[] = full.passages.flatMap((p) =>
          p.links
            .filter((l) => !names.has(l))
            .map((l) => ({ from: p.name, target: l })),
        );
        const reachable = reachableFrom(graph, full.startPassage);
        const unreachable = full.passages
          .map((p) => p.name)
          .filter((n) => !reachable.has(n));
        const deadEnds = full.passages
          .filter(
            (p) =>
              p.links.length === 0 && !p.tags.includes('ending'),
          )
          .map((p) => p.name);
        const cycles = findCycles(graph);
        result['issues'] = {
          brokenLinks: broken,
          unreachable,
          deadEnds,
          cycleCount: cycles.length,
        };
      }

      return ok(result);
    },
  );
}
