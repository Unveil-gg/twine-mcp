/**
 * Enriched error message builders for common "not found" failures.
 *
 * Returns strings, not MCP response objects, to avoid circular imports
 * with tools/stories.ts. Use as: return err(storyNotFoundMsg(...))
 */

import type { IStoryStore } from '../types.js';

const MAX_PASSAGE_SUGGESTIONS = 5;

/**
 * Build a "story not found" message that lists available story names
 * so the agent can self-correct without an extra round-trip.
 *
 * @param name  - Story name that was not found
 * @param store - Store to query for available names
 * @returns Error message string
 */
export function storyNotFoundMsg(
  name: string,
  store: IStoryStore,
): string {
  const names = store.listStories().map((s) => s.name);
  const hint = names.length > 0
    ? ` Available: ${names.map((n) => `"${n}"`).join(', ')}.`
    : ' No stories discovered in workspace.';
  return `Story "${name}" not found.${hint}`;
}

/**
 * Build a "passage not found" message with partial-match suggestions
 * from the story's passage list so the agent can self-correct.
 *
 * @param passage   - Passage name that was not found
 * @param storyName - Story the lookup was attempted in
 * @param passages  - All passages in the story (name property required)
 * @returns Error message string
 */
export function passageNotFoundMsg(
  passage: string,
  storyName: string,
  passages: Array<{ name: string }>,
): string {
  const lower = passage.toLowerCase();
  const suggestions = passages
    .map((p) => p.name)
    .filter((n) => n.toLowerCase().includes(lower))
    .slice(0, MAX_PASSAGE_SUGGESTIONS);
  const hint = suggestions.length > 0
    ? ` Did you mean: ${suggestions.map((n) => `"${n}"`).join(', ')}?`
    : ` Use list_passages to see all ${passages.length} passage names.`;
  return `Passage "${passage}" not found in "${storyName}".${hint}`;
}
