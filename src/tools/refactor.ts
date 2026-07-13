/**
 * Story-aware refactor MCP tools: split_passage, merge_passages.
 *
 * These tools work in both library mode and project mode because they
 * operate through the IStoryStore interface (passage CRUD only).
 * For file-based move operations see project.ts (move_passage).
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Passage } from 'extwee';
import type { IStoryStore } from '../types.js';
import { ok, err } from './stories.js';
import { storyNotFoundMsg, passageNotFoundMsg } from '../util/errors.js';

/**
 * Registers split_passage and merge_passages tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - IStoryStore instance (library or project mode)
 */
export function registerRefactorTools(
  server: McpServer,
  store: IStoryStore,
): void {
  /** split_passage */
  server.registerTool(
    'split_passage',
    {
      description:
        'Split a passage into two passages at the specified line number. ' +
        'Inserts a [[new_passage_name]] link at the split point. ' +
        'The second half becomes a new passage with the given name. ' +
        'CALL FIRST: get_passage to inspect text and count lines.',
      inputSchema: {
        story: z.string().describe('Story name'),
        passage: z.string().describe('Passage name to split'),
        split_at_line: z
          .number()
          .int()
          .min(1)
          .describe(
            'Line number after which to split (1-indexed). ' +
            'Content before and including this line stays in the original. ' +
            'Content after goes into the new passage.',
          ),
        new_passage_name: z
          .string()
          .describe('Name for the newly created second passage'),
        new_passage_tags: z
          .array(z.string())
          .optional()
          .default([])
          .describe('Tags for the new passage'),
      },
    },
    async ({
      story,
      passage,
      split_at_line,
      new_passage_name,
      new_passage_tags,
    }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(storyNotFoundMsg(story, store));

      const target = storyObj.getPassageByName(passage) as Passage | undefined;
      if (!target) {
        return err(
          passageNotFoundMsg(passage, story, storyObj.passages as Passage[]),
        );
      }
      if (storyObj.getPassageByName(new_passage_name)) {
        return err(
          `Cannot split: passage "${new_passage_name}" already exists.`,
        );
      }

      const lines = target.text.split('\n');
      if (split_at_line >= lines.length) {
        return err(
          `split_at_line ${split_at_line} is out of range ` +
          `(passage has ${lines.length} line(s)).`,
        );
      }

      const firstHalf = lines.slice(0, split_at_line).join('\n');
      const secondHalf = lines.slice(split_at_line).join('\n');

      target.text = `${firstHalf}\n\n[[${new_passage_name}]]`;

      // Position the new passage to the right of the original
      const meta = (target.metadata ?? {}) as Record<string, string>;
      const pos = meta['position'];
      let newPos: string | undefined;
      if (pos) {
        const [x, y] = pos.split(',').map(Number);
        newPos = `${(x ?? 600) + 200},${y ?? 400}`;
      }
      const newMeta: Record<string, string> = newPos
        ? { position: newPos }
        : {};

      const newPassage = new Passage(
        new_passage_name,
        secondHalf.trimStart(),
        new_passage_tags,
        newMeta,
      );
      storyObj.addPassage(newPassage);
      store.saveStory(storyObj);

      return ok({
        split: passage,
        firstHalfLines: split_at_line,
        newPassage: new_passage_name,
        secondHalfLines: secondHalf.split('\n').length,
        linkInserted: `[[${new_passage_name}]]`,
      });
    },
  );

  /** merge_passages */
  server.registerTool(
    'merge_passages',
    {
      description:
        'Merge two passages into one. The content of the second passage is ' +
        'appended to the first. The direct link between them is removed. ' +
        'All other links to the second passage are rewritten to the first. ' +
        'CALL FIRST: get_passage on both passages to confirm content.',
      inputSchema: {
        story: z.string().describe('Story name'),
        keep_passage: z
          .string()
          .describe('Passage that survives the merge (receives combined content)'),
        remove_passage: z
          .string()
          .describe('Passage to merge into keep_passage (will be deleted)'),
        separator: z
          .string()
          .optional()
          .default('\n\n')
          .describe(
            'Text inserted between the two passage contents (default: blank line)',
          ),
      },
    },
    async ({ story, keep_passage, remove_passage, separator }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(storyNotFoundMsg(story, store));

      const keepP = storyObj.getPassageByName(keep_passage) as
        | Passage | undefined;
      if (!keepP) {
        return err(
          passageNotFoundMsg(
            keep_passage, story, storyObj.passages as Passage[],
          ),
        );
      }
      const removeP = storyObj.getPassageByName(remove_passage) as
        | Passage | undefined;
      if (!removeP) {
        return err(
          passageNotFoundMsg(
            remove_passage, story, storyObj.passages as Passage[],
          ),
        );
      }
      if (keep_passage === remove_passage) {
        return err('keep_passage and remove_passage must be different.');
      }

      // Combine content
      keepP.text = keepP.text + separator + removeP.text;

      // Remove direct [[remove_passage]] link patterns from keep
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        new RegExp(`\\[\\[${esc(remove_passage)}\\]\\]`, 'g'),
        new RegExp(`(\\[\\[[^\\]]*->)${esc(remove_passage)}(\\]\\])`, 'g'),
        new RegExp(`(\\[\\[)${esc(remove_passage)}(<-[^\\]]*\\]\\])`, 'g'),
        new RegExp(`(\\[\\[[^|]*\\|)${esc(remove_passage)}(\\]\\])`, 'g'),
      ];
      for (const pat of patterns) {
        keepP.text = keepP.text.replace(pat, '');
      }

      // Rewrite all references to remove_passage in other passages
      let rewritten = 0;
      for (const p of storyObj.passages as Passage[]) {
        if (p.name === keep_passage) continue;
        const orig = p.text;
        for (const pat of patterns) {
          p.text = p.text.replace(
            pat,
            (_m, ...args) => {
              const groups = args.slice(0, -2) as string[];
              if (groups.length === 2) {
                return `${groups[0]}${keep_passage}${groups[1]}`;
              }
              return `[[${keep_passage}]]`;
            },
          );
        }
        if (p.text !== orig) rewritten++;
      }

      storyObj.removePassageByName(remove_passage);

      // Update start if needed
      if (storyObj.start === remove_passage) {
        storyObj.start = keep_passage;
      }

      store.saveStory(storyObj);
      return ok({
        merged: { from: remove_passage, into: keep_passage },
        linksRewritten: rewritten,
        story,
      });
    },
  );
}
