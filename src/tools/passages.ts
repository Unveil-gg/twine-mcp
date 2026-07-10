/**
 * Passage-level MCP tools: list, get, create, update, delete, rename.
 * rename_passage rewrites all [[links]] pointing to the old name.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Passage } from 'extwee';
import type { IStoryStore } from '../types.js';
import { ok, err } from './stories.js';

/**
 * Registers all passage CRUD tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance
 */
export function registerPassageTools(
  server: McpServer,
  store: IStoryStore,
): void {
  /** list_passages */
  server.registerTool(
    'list_passages',
    {
      description:
        'List all passages in a story with metadata. ' +
        'Use fields to limit response size. Passage text is not ' +
        'included by default — use get_passage for full content.',
      inputSchema: {
        story: z.string().describe('Story name'),
        fields: z
          .array(
            z.enum([
              'name',
              'tags',
              'wordCount',
              'position',
              'preview',
              'links',
              'file',
            ]),
          )
          .optional()
          .describe(
            'Fields to include. Default: name, tags, wordCount. ' +
            '"file" is project-mode only (source .twee path).',
          ),
        tag_filter: z
          .string()
          .optional()
          .describe('Return only passages with this tag'),
      },
    },
    async ({ story, fields, tag_filter }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);

      let passages = full.passages;
      if (tag_filter) {
        passages = passages.filter((p) => p.tags.includes(tag_filter));
      }

      const defaultFields = ['name', 'tags', 'wordCount'];
      const selectedFields = fields ?? defaultFields;

      const result = passages.map((p) => {
        const src = p as unknown as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const f of selectedFields) {
          if (f === 'file') {
            out['file'] = store.getPassageFile?.(p.name) ?? null;
          } else {
            out[f] = src[f];
          }
        }
        return out;
      });
      return ok(result);
    },
  );

  /** get_passage */
  server.registerTool(
    'get_passage',
    {
      description:
        'Get the full content, tags, and outgoing links of a single passage.',
      inputSchema: {
        story: z.string().describe('Story name'),
        passage: z.string().describe('Passage name'),
      },
    },
    async ({ story, passage }) => {
      const full = store.getStoryFull(story);
      if (!full) return err(`Story "${story}" not found.`);
      const p = full.passages.find((x) => x.name === passage);
      if (!p) return err(`Passage "${passage}" not found in "${story}".`);
      return ok(p);
    },
  );

  /** create_passage */
  server.registerTool(
    'create_passage',
    {
      description: 'Add a new passage to a story.',
      inputSchema: {
        story: z.string().describe('Story name'),
        name: z.string().describe('New passage name'),
        text: z
          .string()
          .optional()
          .default('')
          .describe('Passage content'),
        tags: z
          .array(z.string())
          .optional()
          .default([])
          .describe('Tags for the passage'),
        position: z
          .string()
          .optional()
          .describe('Editor position as "x,y" (e.g. "600,400")'),
      },
    },
    async ({ story, name, text, tags, position }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(`Story "${story}" not found.`);
      if (storyObj.getPassageByName(name)) {
        return err(`Passage "${name}" already exists in "${story}".`);
      }
      const meta: Record<string, string> = {};
      if (position) meta['position'] = position;
      const passage = new Passage(name, text, tags, meta);
      storyObj.addPassage(passage);
      store.saveStory(storyObj);
      return ok({ created: name, story });
    },
  );

  /** update_passage */
  server.registerTool(
    'update_passage',
    {
      description:
        'Edit a passage: update text, tags, and/or editor position. ' +
        'Omit fields you do not want to change.',
      inputSchema: {
        story: z.string().describe('Story name'),
        passage: z.string().describe('Passage name'),
        text: z.string().optional().describe('New passage content'),
        tags: z
          .array(z.string())
          .optional()
          .describe('New tag list (replaces existing)'),
        position: z
          .string()
          .optional()
          .describe('New editor position as "x,y"'),
      },
    },
    async ({ story, passage, text, tags, position }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(`Story "${story}" not found.`);
      const p = storyObj.getPassageByName(passage) as Passage | undefined;
      if (!p) {
        return err(`Passage "${passage}" not found in "${story}".`);
      }
      if (text !== undefined) p.text = text;
      if (tags !== undefined) p.tags = tags;
      if (position !== undefined) {
        const meta = (p.metadata ?? {}) as Record<string, string>;
        meta['position'] = position;
        p.metadata = meta;
      }
      store.saveStory(storyObj);
      return ok({ updated: passage, story });
    },
  );

  /** delete_passage */
  server.registerTool(
    'delete_passage',
    {
      description: 'Remove a passage from a story.',
      inputSchema: {
        story: z.string().describe('Story name'),
        passage: z.string().describe('Passage name to delete'),
      },
    },
    async ({ story, passage }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(`Story "${story}" not found.`);
      if (!storyObj.getPassageByName(passage)) {
        return err(`Passage "${passage}" not found in "${story}".`);
      }
      storyObj.removePassageByName(passage);
      store.saveStory(storyObj);
      return ok({ deleted: passage, story });
    },
  );

  /** rename_passage */
  server.registerTool(
    'rename_passage',
    {
      description:
        'Rename a passage and rewrite all [[links]] that point to it ' +
        'across the entire story. Also updates startPassage if needed.',
      inputSchema: {
        story: z.string().describe('Story name'),
        old_name: z.string().describe('Current passage name'),
        new_name: z.string().describe('New passage name'),
      },
    },
    async ({ story, old_name, new_name }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(`Story "${story}" not found.`);
      const target = storyObj.getPassageByName(old_name) as
        | Passage
        | undefined;
      if (!target) {
        return err(`Passage "${old_name}" not found in "${story}".`);
      }
      if (storyObj.getPassageByName(new_name)) {
        return err(
          `Cannot rename: passage "${new_name}" already exists.`,
        );
      }

      // Rename the passage itself.
      target.name = new_name;

      // Update start passage if needed.
      if (storyObj.start === old_name) storyObj.start = new_name;

      // Rewrite [[links]] in all passage texts.
      let rewrittenCount = 0;
      const patterns = [
        // [[old_name]] → [[new_name]]
        new RegExp(
          `\\[\\[${escapeRegex(old_name)}\\]\\]`,
          'g',
        ),
        // [[display->old_name]] → [[display->new_name]]
        new RegExp(
          `(\\[\\[[^\\]]*->)${escapeRegex(old_name)}(\\]\\])`,
          'g',
        ),
        // [[old_name<-display]] → [[new_name<-display]]
        new RegExp(
          `(\\[\\[)${escapeRegex(old_name)}(<-[^\\]]*\\]\\])`,
          'g',
        ),
        // [[display|old_name]] → [[display|new_name]]
        new RegExp(
          `(\\[\\[[^|]*\\|)${escapeRegex(old_name)}(\\]\\])`,
          'g',
        ),
      ];

      for (const p of storyObj.passages as Passage[]) {
        let text = p.text;
        const original = text;
        for (const pat of patterns) {
          text = text.replace(
            pat,
            (_m: string, ...args: unknown[]) => {
              // For plain [[old_name]] the replacement is simple.
              if (args.length === 1 && typeof args[0] === 'number') {
                return `[[${new_name}]]`;
              }
              // For grouped replacements, stitch groups around new_name.
              const groups = args.slice(0, -2) as string[];
              if (groups.length === 2) {
                return `${groups[0]}${new_name}${groups[1]}`;
              }
              return `[[${new_name}]]`;
            },
          );
        }
        if (text !== original) {
          p.text = text;
          rewrittenCount++;
        }
      }

      store.saveStory(storyObj);
      return ok({
        renamed: { from: old_name, to: new_name },
        linksRewritten: rewrittenCount,
        story,
      });
    },
  );

  /** set_start_passage */
  server.registerTool(
    'set_start_passage',
    {
      description: 'Set which passage is the story starting point.',
      inputSchema: {
        story: z.string().describe('Story name'),
        passage: z.string().describe('Passage name to set as start'),
      },
    },
    async ({ story, passage }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(`Story "${story}" not found.`);
      if (!storyObj.getPassageByName(passage)) {
        return err(`Passage "${passage}" not found in "${story}".`);
      }
      storyObj.start = passage;
      store.saveStory(storyObj);
      return ok({ startPassage: passage, story });
    },
  );
}

/** Escape a string for use in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
