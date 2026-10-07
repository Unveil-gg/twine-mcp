/**
 * Search-and-replace edits for a single passage body.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Passage } from 'extwee';
import type { IStoryStore } from '../types.js';
import type { ToolError } from '../util/errors.js';
import { passageNotFoundMsg, storyNotFoundMsg } from '../util/errors.js';
import { mutating } from '../util/tool-annotations.js';
import { err, ok } from './stories.js';

/** Successful in-memory patch. */
export interface PatchSuccess {
  ok: true;
  text: string;
  replacements: number;
}

/** Patch rejected before any write. */
export interface PatchFailure {
  ok: false;
  error: ToolError;
}

/**
 * Replace an exact snippet in passage text.
 *
 * @param text - Current passage body
 * @param oldText - Exact snippet to find
 * @param newText - Replacement text
 * @param replaceAll - Replace every match instead of requiring one
 * @returns Updated text, or a diagnostic when the snippet is missing
 *   or ambiguous
 */
export function applyTextPatch(
  text: string,
  oldText: string,
  newText: string,
  replaceAll: boolean,
): PatchSuccess | PatchFailure {
  if (oldText.length === 0) {
    return {
      ok: false,
      error: {
        error: 'PassagePatchMiss',
        message:
          'old_text must not be empty. Call get_passage and retry.',
        matchCount: 0,
      },
    };
  }

  const matchCount = countOccurrences(text, oldText);
  if (matchCount === 0) {
    return {
      ok: false,
      error: {
        error: 'PassagePatchMiss',
        message:
          'old_text was not found. Call get_passage and retry ' +
          'with an exact snippet.',
        matchCount: 0,
      },
    };
  }
  if (matchCount > 1 && !replaceAll) {
    return {
      ok: false,
      error: {
        error: 'PassagePatchAmbiguous',
        message:
          `old_text matched ${matchCount} times. ` +
          'Set replace_all or include more surrounding text.',
        matchCount,
      },
    };
  }

  const next = replaceAll
    ? replaceAllLiteral(text, oldText, newText)
    : text.replace(oldText, newText);
  return {
    ok: true,
    text: next,
    replacements: replaceAll ? matchCount : 1,
  };
}

/**
 * Registers patch_passage on the MCP server.
 *
 * @param server - McpServer instance
 * @param store - Story store
 */
export function registerPassagePatchTool(
  server: McpServer,
  store: IStoryStore,
): void {
  server.registerTool(
    'patch_passage',
    {
      annotations: mutating,
      description:
        'Replace an exact snippet in one passage. Prefer this over ' +
        'update_passage for local edits. Call get_passage first so ' +
        'old_text matches the current body.',
      inputSchema: {
        story: z.string().describe('Story name'),
        passage: z.string().describe('Passage name'),
        old_text: z.string().describe('Exact text to replace'),
        new_text: z.string().describe('Replacement text'),
        replace_all: z
          .boolean()
          .optional()
          .default(false)
          .describe('Replace every match. Default requires one match.'),
      },
    },
    async ({ story, passage, old_text, new_text, replace_all }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(storyNotFoundMsg(story, store));
      const target = storyObj.getPassageByName(passage) as
        | Passage
        | undefined;
      if (!target) {
        return err(
          passageNotFoundMsg(
            passage,
            story,
            storyObj.passages as Passage[],
          ),
        );
      }

      const patched = applyTextPatch(
        target.text ?? '',
        old_text,
        new_text,
        replace_all,
      );
      if (!patched.ok) return err(patched.error);

      target.text = patched.text;
      store.saveStory(storyObj);
      return ok({
        patched: true,
        replacements: patched.replacements,
        story,
        passage,
      });
    },
  );
}

/** Count non-overlapping occurrences of a literal snippet. */
function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (index <= text.length) {
    const at = text.indexOf(needle, index);
    if (at === -1) break;
    count++;
    index = at + needle.length;
  }
  return count;
}

/** Replace every non-overlapping occurrence of a literal snippet. */
function replaceAllLiteral(
  text: string,
  oldText: string,
  newText: string,
): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const at = text.indexOf(oldText, index);
    if (at === -1) {
      out += text.slice(index);
      break;
    }
    out += text.slice(index, at) + newText;
    index = at + oldText.length;
  }
  return out;
}
