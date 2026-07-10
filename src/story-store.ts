/**
 * story-store — shared graph utilities used by MCP resources.
 * StoryStore (library mode) has been removed; use WorkspaceStore instead.
 */

import type { StoryFull, LinkGraph } from './types.js';

/**
 * Build a passage link adjacency list from a StoryFull.
 * Only links that resolve to an existing passage are included.
 *
 * @param story - Full story data including passages and their links
 * @returns Adjacency list: passage name → array of linked passage names
 */
export function buildLinkGraph(story: StoryFull): LinkGraph {
  const graph: LinkGraph = {};
  const names = new Set(story.passages.map((p) => p.name));
  for (const p of story.passages) {
    graph[p.name] = p.links.filter((l) => names.has(l));
  }
  return graph;
}
