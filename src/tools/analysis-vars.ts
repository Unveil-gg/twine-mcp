/**
 * Variable and tag analysis MCP tools: find_variable_usage, check_tag_consistency.
 *
 * Split from analysis.ts to keep files under 300 lines.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoryStore } from '../story-store.js';
import { getFormatHints } from '../util/format-hints.js';
import { ok, err } from './stories.js';
import type { VarUsage } from '../types.js';

/**
 * Registers variable and tag analysis tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance
 */
export function registerAnalysisVarTools(
  server: McpServer,
  store: StoryStore,
): void {
  /** find_variable_usage */
  server.registerTool(
    'find_variable_usage',
    {
      description:
        'Scan passage text for variable set and read operations using ' +
        'format-aware patterns (SugarCube, Harlowe, Chapbook). ' +
        'Returns each variable with the passages where it is set or read.',
      inputSchema: {
        story: z.string().describe('Story name'),
        variable: z
          .string()
          .optional()
          .describe(
            'Filter to a specific variable name. Omit to return all.',
          ),
      },
    },
    async ({ story, variable }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);

      const hints = getFormatHints(full.format);
      const usageMap = new Map<string, VarUsage>();

      const getOrCreate = (v: string): VarUsage => {
        if (!usageMap.has(v)) {
          usageMap.set(v, { variable: v, setIn: [], readIn: [] });
        }
        return usageMap.get(v)!;
      };

      for (const p of full.passages) {
        if (p.tags.includes('script') || p.tags.includes('stylesheet')) {
          continue;
        }
        const setRe = new RegExp(
          hints.setPattern.source,
          hints.setPattern.flags,
        );
        const readRe = new RegExp(
          hints.readPattern.source,
          hints.readPattern.flags,
        );
        let m: RegExpMatchArray | null;
        while ((m = setRe.exec(p.text)) !== null) {
          const v = hints.extractName(m);
          if (v) getOrCreate(v).setIn.push(p.name);
        }
        while ((m = readRe.exec(p.text)) !== null) {
          const v = hints.extractName(m);
          if (v) getOrCreate(v).readIn.push(p.name);
        }
      }

      let results = [...usageMap.values()];
      if (variable) {
        const lv = variable.toLowerCase();
        results = results.filter((r) =>
          r.variable.toLowerCase().includes(lv),
        );
      }
      results.sort((a, b) => a.variable.localeCompare(b.variable));
      return ok({
        format: full.format,
        variableCount: results.length,
        variables: results,
      });
    },
  );

  /** check_tag_consistency */
  server.registerTool(
    'check_tag_consistency',
    {
      description:
        'Audit tag usage across the story. ' +
        'Reports rare tags (used < 2 times) and passages with many tags.',
      inputSchema: {
        story: z.string().describe('Story name'),
        rare_threshold: z
          .number()
          .optional()
          .default(2)
          .describe(
            'Tags used fewer times than this are flagged as rare',
          ),
      },
    },
    async ({ story, rare_threshold }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);

      const tagCounts: Record<string, number> = {};
      for (const p of full.passages) {
        for (const t of p.tags) {
          tagCounts[t] = (tagCounts[t] ?? 0) + 1;
        }
      }

      const rareTags = Object.entries(tagCounts)
        .filter(([, count]) => count < rare_threshold)
        .map(([tag, count]) => ({ tag, count }));

      const highTagPassages = full.passages
        .filter((p) => p.tags.length >= 3)
        .map((p) => ({ name: p.name, tags: p.tags }));

      const untagged = full.passages
        .filter((p) => p.tags.length === 0)
        .map((p) => p.name);

      return ok({
        totalUniqueTags: Object.keys(tagCounts).length,
        tagCounts,
        rareTags,
        highTagPassages,
        untaggedCount: untagged.length,
        untaggedPassages: untagged,
      });
    },
  );
}
