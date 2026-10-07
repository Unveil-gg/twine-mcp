/**
 * Reusable prompt workflows for story audits.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStoryStore, StoryFull } from '../types.js';
import { buildLinkGraph } from '../story-store.js';
import { findCycles } from '../util/graph-algos.js';
import { passageNotFoundMsg, storyNotFoundMsg } from '../util/errors.js';

const LIST_CAP = 25;

/**
 * Register narrative prompt templates.
 *
 * @param server - McpServer instance
 * @param store - Story store
 */
export function registerNarrativePrompts(
  server: McpServer,
  store: IStoryStore,
): void {
  server.registerPrompt(
    'audit_branching_dead_ends',
    {
      title: 'Audit branching dead ends',
      description:
        'List dead ends, orphans, broken links, and cycles, then ' +
        'ask for targeted passage patches.',
      argsSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: auditPrompt(store, story),
        },
      }],
    }),
  );

  server.registerPrompt(
    'check_narrative_continuity',
    {
      title: 'Check narrative continuity',
      description:
        'Orient on the start excerpt and branch points, then read ' +
        'individual passages before editing.',
      argsSchema: {
        story: z.string().describe('Story name'),
        from: z.string().optional().describe(
          'Passage to treat as the start of the check',
        ),
      },
    },
    async ({ story, from }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: continuityPrompt(store, story, from),
        },
      }],
    }),
  );
}

/** Prompt body for the dead-end audit. */
function auditPrompt(store: IStoryStore, storyName: string): string {
  const story = store.getStoryFull(storyName);
  if (!story) return JSON.stringify(storyNotFoundMsg(storyName, store));

  const names = new Set(story.passages.map((p) => p.name));
  const graph = buildLinkGraph(story);
  const referenced = new Set(Object.values(graph).flat());
  const broken = story.passages.flatMap((p) =>
    p.links
      .filter((link) => !names.has(link))
      .map((link) => `${p.name} -> ${link}`),
  );
  const deadEnds = story.passages
    .filter((p) => p.links.length === 0 && !p.tags.includes('ending'))
    .map((p) => p.name);
  const orphans = story.passages
    .filter((p) =>
      !referenced.has(p.name) && p.name !== story.startPassage)
    .map((p) => p.name);
  const cycles = findCycles(graph).map((cycle) => cycle.join(' -> '));

  return [
    `Audit branching dead ends for '${story.name}'.`,
    `Passages: ${story.passageCount}. Start: ${story.startPassage}.`,
    '',
    section('Broken links', broken),
    section('Dead ends', deadEnds),
    section('Orphans', orphans),
    section('Cycles', cycles),
    '',
    'Fix specific passages with patch_passage. Call get_passage ' +
      'before editing. Do not rewrite the whole story.',
  ].join('\n');
}

/** Prompt body for the continuity check. */
function continuityPrompt(
  store: IStoryStore,
  storyName: string,
  from: string | undefined,
): string {
  const story = store.getStoryFull(storyName);
  if (!story) return JSON.stringify(storyNotFoundMsg(storyName, store));

  const startName = from ?? story.startPassage;
  const start = story.passages.find((p) => p.name === startName);
  if (!start) {
    return JSON.stringify(
      passageNotFoundMsg(startName, story.name, story.passages),
    );
  }

  const branches = branchLines(story);
  const excerpt = start.text.slice(0, 200);
  return [
    `Check narrative continuity for '${story.name}' ` +
      `starting at '${start.name}'.`,
    '',
    'Start excerpt:',
    excerpt,
    '',
    section('Branch points', branches),
    '',
    'Call get_passage for any passage you need to read. ' +
      'Use patch_passage for local text changes.',
  ].join('\n');
}

/** Branch points as "Name: link, link". */
function branchLines(story: StoryFull): string[] {
  return story.passages
    .filter((p) => p.links.length > 1)
    .map((p) => `${p.name}: ${p.links.join(', ')}`);
}

/** Render a capped name list. */
function section(title: string, items: string[]): string {
  if (items.length === 0) return `${title}: none`;
  const shown = items.slice(0, LIST_CAP);
  const extra = items.length - shown.length;
  const lines = shown.map((item) => `- ${item}`);
  if (extra > 0) lines.push(`- +${extra} more`);
  return [`${title}:`, ...lines].join('\n');
}
