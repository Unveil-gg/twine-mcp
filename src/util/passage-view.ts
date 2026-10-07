/**
 * Model-facing passage and story shapes. Layout coordinates stay on
 * disk and are omitted unless a caller opts in.
 */

import type { PassageFull, StoryFull, StoryMeta } from '../types.js';

/**
 * Story metadata without passages, script, or stylesheet text.
 *
 * @param story - Loaded story
 * @returns Compact story record
 */
export function storyMetaOf(story: StoryFull): StoryMeta {
  return {
    name: story.name,
    ifid: story.ifid,
    format: story.format,
    formatVersion: story.formatVersion,
    startPassage: story.startPassage,
    passageCount: story.passageCount,
    wordCount: story.wordCount,
    filePath: story.filePath,
    lastModified: story.lastModified,
  };
}

/**
 * One passage for get_passage. Layout is included only on request.
 *
 * @param passage - Full passage from the store
 * @param includeLayout - When true, add position and size
 * @returns Fields safe to send to the model
 */
export function toPassageView(
  passage: PassageFull,
  includeLayout: boolean,
): Record<string, unknown> {
  const view: Record<string, unknown> = {
    name: passage.name,
    tags: passage.tags,
    wordCount: passage.wordCount,
    text: passage.text,
    links: passage.links,
  };
  if (includeLayout) {
    view['position'] = passage.position ?? null;
    view['size'] = passage.size ?? null;
  }
  return view;
}

/**
 * Passage body without editor coordinates, for opt-in full reads.
 *
 * @param passage - Full passage from the store
 * @returns Passage fields except position and size
 */
export function passageWithoutLayout(
  passage: PassageFull,
): Record<string, unknown> {
  return {
    name: passage.name,
    tags: passage.tags,
    wordCount: passage.wordCount,
    preview: passage.preview,
    text: passage.text,
    links: passage.links,
  };
}
