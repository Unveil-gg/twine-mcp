/**
 * Compact resource payloads. No passage text and no layout coordinates.
 */

import { buildLinkGraph } from '../story-store.js';
import { reachableFrom } from '../util/graph-algos.js';
import { storyMetaOf } from '../util/passage-view.js';
import type { StoryFull } from '../types.js';

/**
 * Manifest: story metadata plus a passage index.
 *
 * @param story - Loaded story
 * @returns JSON-ready manifest
 */
export function buildManifest(story: StoryFull): Record<string, unknown> {
  return {
    ...storyMetaOf(story),
    passages: story.passages.map((p) => ({
      name: p.name,
      tags: p.tags,
      wordCount: p.wordCount,
      links: p.links,
    })),
  };
}

/**
 * Directed link graph of passage names.
 *
 * @param story - Loaded story
 * @returns Adjacency list
 */
export function buildGraphResource(
  story: StoryFull,
): Record<string, string[]> {
  return buildLinkGraph(story);
}

/**
 * Short orientation snapshot for a story resource.
 *
 * @param story - Loaded story
 * @returns Counts, a short start excerpt, and issue totals
 */
export function buildSummary(story: StoryFull): Record<string, unknown> {
  const graph = buildLinkGraph(story);
  const names = new Set(story.passages.map((p) => p.name));
  const reachable = reachableFrom(graph, story.startPassage);
  const startText = story.passages
    .find((p) => p.name === story.startPassage)
    ?.text.slice(0, 200) ?? '';
  return {
    name: story.name,
    format: `${story.format} ${story.formatVersion}`,
    passageCount: story.passageCount,
    wordCount: story.wordCount,
    startPassage: story.startPassage,
    startText,
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
}
