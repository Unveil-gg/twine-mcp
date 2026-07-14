/**
 * CSS tools: read and write the stylesheet passage for a story.
 *
 * Each Twine story format stores CSS in a special passage:
 *   - SugarCube  → named "StoryStyle" (no tag required)
 *   - Harlowe    → any passage tagged "stylesheet"
 *   - Chapbook   → any passage tagged "stylesheet"
 *   - Snowman    → any passage tagged "stylesheet"
 *
 * These tools handle format detection automatically so callers
 * do not need to know the convention in advance.
 *
 * Tag-based conventions are handled specially: extwee absorbs any
 * [stylesheet]-tagged passage's text into Story.storyStylesheet at
 * parse time, so it never appears in the passages array. These tools
 * read/write that field directly instead of searching passages for it.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Passage } from 'extwee';
import type { IStoryStore } from '../types.js';
import { ok, err } from './stories.js';
import { storyNotFoundMsg } from '../util/errors.js';
import { getStylesheetPassage } from '../util/format-hints.js';
import type { PassageFull } from '../types.js';

/**
 * Find the stylesheet passage in a list of passages according to
 * the convention for the story's format.
 *
 * @param passages   - All passages in the story
 * @param formatName - Story format name
 * @returns The matching PassageFull, or undefined if none exists
 */
function findStylesheetPassage(
  passages: PassageFull[],
  formatName: string,
): PassageFull | undefined {
  const info = getStylesheetPassage(formatName);
  if (info.tag === null) {
    return passages.find((p) => p.name === info.name);
  }
  return passages.find((p) => p.tags.includes(info.tag as string));
}

/**
 * Registers get_stylesheet and update_stylesheet MCP tools.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance
 */
export function registerCssTools(
  server: McpServer,
  store: IStoryStore,
): void {
  /** get_stylesheet */
  server.registerTool(
    'get_stylesheet',
    {
      description:
        'Read the CSS stylesheet for a story. Returns the passage ' +
        'name, current CSS content, and which format convention is ' +
        'used. Returns null css if no stylesheet passage exists yet.',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));

      const info = getStylesheetPassage(full.format);

      if (info.tag) {
        const css = full.storyStylesheet || null;
        return ok({
          story,
          format: full.format,
          convention: `tag: "${info.tag}"`,
          passageName: css ? info.name : null,
          css,
        });
      }

      const passage = findStylesheetPassage(full.passages, full.format);
      return ok({
        story,
        format: full.format,
        convention: `name: "${info.name}"`,
        passageName: passage?.name ?? null,
        css: passage?.text ?? null,
      });
    },
  );

  /** update_stylesheet */
  server.registerTool(
    'update_stylesheet',
    {
      description:
        'Write CSS to the story stylesheet. Creates the passage if ' +
        'it does not exist. Use mode "replace" (default) to overwrite, ' +
        'or "append" to add rules after the existing content. ' +
        'Always call get_stylesheet first to read current state.',
      inputSchema: {
        story: z.string().describe('Story name'),
        css: z.string().describe('CSS content to write'),
        mode: z
          .enum(['replace', 'append'])
          .optional()
          .default('replace')
          .describe(
            '"replace" overwrites the entire stylesheet (default). ' +
            '"append" adds css after existing content.',
          ),
      },
    },
    async ({ story, css, mode }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(storyNotFoundMsg(story, store));

      const info = getStylesheetPassage(full.format);
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(storyNotFoundMsg(story, store));

      if (info.tag) {
        const existingCss = storyObj.storyStylesheet;
        storyObj.storyStylesheet =
          mode === 'append' && existingCss
            ? `${existingCss}\n\n${css}`
            : css;
        store.saveStory(storyObj);
        return ok({
          action: existingCss ? 'updated' : 'created',
          passageName: info.name,
          tags: [info.tag],
          mode,
          story,
        });
      }

      const existing = findStylesheetPassage(full.passages, full.format);

      if (existing) {
        const p = storyObj.getPassageByName(existing.name) as
          | Passage
          | undefined;
        if (!p) return err(`Stylesheet passage not found in store.`);
        p.text = mode === 'append'
          ? `${p.text}\n\n${css}`.trimStart()
          : css;
        store.saveStory(storyObj);
        return ok({
          action: 'updated',
          passageName: existing.name,
          mode,
          story,
        });
      }

      // No stylesheet passage exists — create one (name-based
      // convention only; the tag-based case returned above).
      const newPassage = new Passage(info.name, css, [], {});
      storyObj.addPassage(newPassage);
      store.saveStory(storyObj);
      return ok({
        action: 'created',
        passageName: info.name,
        tags: [],
        mode: 'replace',
        story,
      });
    },
  );
}
