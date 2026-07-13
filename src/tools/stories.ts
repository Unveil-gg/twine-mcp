/**
 * Story-level MCP tools: list, get, create, delete, export.
 * Registered onto McpServer in server.ts.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStoryStore } from '../types.js';
import { storyNotFoundMsg } from '../util/errors.js';

/**
 * Registers all story-management tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - IStoryStore implementation
 */
export function registerStoryTools(
  server: McpServer,
  store: IStoryStore,
): void {
  /** list_stories */
  server.registerTool(
    'list_stories',
    {
      description:
        'List all Twine game projects discovered in the workspace. ' +
        'Use this to understand what stories exist — helpful for ' +
        'disambiguation when the user has multiple games. ' +
        'Use fields to limit output size.',
      inputSchema: {
        fields: z
          .array(
            z.enum([
              'name',
              'ifid',
              'format',
              'passageCount',
              'wordCount',
              'lastModified',
              'filePath',
            ]),
          )
          .optional()
          .describe('Return only these fields. Omit for all fields.'),
      },
    },
    async ({ fields }) => {
      const stories = store.listStories();
      const results = stories.map((s) => {
        if (!fields) return s;
        const src = s as unknown as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const f of fields) out[f] = src[f];
        return out;
      });
      return ok(results);
    },
  );

  /** get_story */
  server.registerTool(
    'get_story',
    {
      description:
        'Get full details for a story, optionally including passage list.',
      inputSchema: {
        name: z.string().describe('Story name'),
        include_passages: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include passage list in response'),
        compact: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'When true, passage list returns name + preview only (no full text)',
          ),
      },
    },
    async ({ name, include_passages, compact }) => {
      const story = store.getStoryFull(name);
      if (!story) return err(storyNotFoundMsg(name, store));
      if (!include_passages) {
        const { passages: _, ...meta } = story;
        return ok(meta);
      }
      if (compact) {
        return ok({
          ...story,
          passages: story.passages.map((p) => ({
            name: p.name,
            tags: p.tags,
            wordCount: p.wordCount,
            preview: p.preview,
          })),
        });
      }
      return ok(story);
    },
  );

  /** create_story */
  server.registerTool(
    'create_story',
    {
      description:
        'Create a new Twine story with a Start passage. ' +
        'For a full project with src/ layout use create_project instead.',
      inputSchema: {
        name: z.string().describe('Story name'),
        format: z
          .string()
          .optional()
          .default('Harlowe')
          .describe(
            'Story format name (Harlowe, SugarCube, Chapbook, Snowman)',
          ),
        format_version: z
          .string()
          .optional()
          .default('3.3.9')
          .describe('Story format version'),
      },
    },
    async ({ name, format, format_version }) => {
      if (store.listStories().some((s) => s.name === name)) {
        return err(`Story "${name}" already exists.`);
      }
      const meta = store.createStory(name, format, format_version);
      return ok(meta);
    },
  );

  /** delete_story */
  server.registerTool(
    'delete_story',
    {
      description: 'Delete a story. This cannot be undone.',
      inputSchema: {
        name: z.string().describe('Story name to delete'),
      },
    },
    async ({ name }) => {
      const deleted = store.deleteStory(name);
      if (!deleted) return err(storyNotFoundMsg(name, store));
      return ok({ deleted: name });
    },
  );

  /** export_twee */
  server.registerTool(
    'export_twee',
    {
      description:
        'Export a story as Twee 3 source text. ' +
        'Useful for reading all passage content or feeding into external tools.',
      inputSchema: {
        name: z.string().describe('Story name'),
      },
    },
    async ({ name }) => {
      const storyObj = store.getStoryObject(name);
      if (!storyObj) return err(storyNotFoundMsg(name, store));
      return {
        content: [{ type: 'text' as const, text: storyObj.toTwee() }],
      };
    },
  );
}

/** Wrap a value as a successful MCP text response. */
export function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Wrap an error message as an MCP text response. */
export function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: `ERROR: ${message}` }],
    isError: true,
  };
}
