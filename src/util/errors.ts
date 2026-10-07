/**
 * Diagnostic payloads for tool failures.
 *
 * Return these from err() so the model can self-correct in one turn.
 */

import type { IStoryStore } from '../types.js';

const MAX_SUGGESTIONS = 5;

/** Structured tool error returned as JSON text. */
export interface ToolError {
  error: string;
  message: string;
  suggestions?: string[];
  matchCount?: number;
}

/**
 * Rank passage or story names that resemble a missing query.
 * Substring matches come first, then a short edit-distance fallback.
 *
 * @param query - Name the caller asked for
 * @param names - Candidate names that do exist
 * @returns Up to five suggestions
 */
export function suggestNames(query: string, names: string[]): string[] {
  const q = query.toLowerCase();
  const ranked: string[] = [];
  const seen = new Set<string>();

  const push = (name: string): void => {
    if (seen.has(name) || ranked.length >= MAX_SUGGESTIONS) return;
    seen.add(name);
    ranked.push(name);
  };

  for (const name of names) {
    if (name.toLowerCase() === q) push(name);
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.includes(q) || (q.length >= 3 && q.includes(lower))) {
      push(name);
    }
  }
  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  for (const name of names) {
    const lower = name.toLowerCase();
    if (tokens.some((token) => lower.includes(token))) push(name);
  }

  const maxDist = Math.max(2, Math.floor(q.length * 0.34));
  const fuzzy = names
    .filter((name) => !seen.has(name))
    .map((name) => ({
      name,
      dist: editDistance(q, name.toLowerCase(), maxDist),
    }))
    .filter((item) => item.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name));
  for (const item of fuzzy) push(item.name);
  return ranked;
}

/**
 * Build a StoryNotFound payload listing similar story names.
 *
 * @param name - Story name that was not found
 * @param store - Store to query for available names
 * @returns Diagnostic error
 */
export function storyNotFoundMsg(
  name: string,
  store: IStoryStore,
): ToolError {
  const names = store.listStories().map((s) => s.name);
  return {
    error: 'StoryNotFound',
    message: `Story '${name}' does not exist.`,
    suggestions: suggestNames(name, names),
  };
}

/**
 * Build a PassageNotFound payload with close passage titles.
 *
 * @param passage - Passage name that was not found
 * @param _storyName - Story the lookup was attempted in
 * @param passages - All passages in the story
 * @returns Diagnostic error
 */
export function passageNotFoundMsg(
  passage: string,
  _storyName: string,
  passages: Array<{ name: string }>,
): ToolError {
  return {
    error: 'PassageNotFound',
    message: `Passage '${passage}' does not exist.`,
    suggestions: suggestNames(
      passage,
      passages.map((p) => p.name),
    ),
  };
}

/**
 * Levenshtein distance, capped so distant names are rejected early.
 *
 * @param a - Lowercased query
 * @param b - Lowercased candidate
 * @param max - Largest distance worth computing
 * @returns Distance, or max + 1 when the strings are too far apart
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const next = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    next[0] = i;
    let rowMin = next[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(
        prev[j] + 1,
        next[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (next[j] < rowMin) rowMin = next[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = next[j];
  }
  return prev[b.length];
}
