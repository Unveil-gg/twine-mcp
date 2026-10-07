/**
 * Story-level MCP tools: list, get, create, delete, export.
 * Registered onto McpServer in server.ts.
 */

import fs from 'fs';
import path from 'path';
import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStoryStore } from '../types.js';
import type { ToolError } from '../util/errors.js';
import { storyNotFoundMsg } from '../util/errors.js';
import { storyMetaOf } from '../util/passage-view.js';
import {
  destructive,
  mutating,
  readOnly,
} from '../util/tool-annotations.js';

const STORY_FORMATS = [
  'Harlowe',
  'SugarCube',
  'Chapbook',
  'Snowman',
] as const;

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
      annotations: readOnly,
      description:
        'List Twine projects in the workspace. ' +
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
      store.rescan?.();
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
      annotations: readOnly,
      description:
        'Story metadata only. Set include_passages for a title index ' +
        '(name, tags, wordCount). Passage text is get_passage. ' +
        'The manifest resource is twine://stories/{name}/manifest.',
      inputSchema: {
        name: z.string().describe('Story name'),
        include_passages: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Include {name, tags, wordCount} per passage. No text.',
          ),
      },
    },
    async ({ name, include_passages }) => {
      const story = store.getStoryFull(name);
      if (!story) return err(storyNotFoundMsg(name, store));
      const meta = storyMetaOf(story);
      if (!include_passages) return ok(meta);
      return ok({
        ...meta,
        passages: story.passages.map((p) => ({
          name: p.name,
          tags: p.tags,
          wordCount: p.wordCount,
        })),
      });
    },
  );

  /** create_story */
  server.registerTool(
    'create_story',
    {
      annotations: mutating,
      description:
        'Create a new Twine story with a Start passage. ' +
        'For a full project with src/ layout use create_project instead.',
      inputSchema: {
        name: z.string().describe('Story name'),
        format: z
          .enum(STORY_FORMATS)
          .optional()
          .default('Harlowe')
          .describe('Story format'),
        format_version: z
          .string()
          .optional()
          .default('3.3.9')
          .describe('Story format version'),
      },
    },
    async ({ name, format, format_version }) => {
      if (store.listStories().some((s) => s.name === name)) {
        return err(`Story '${name}' already exists.`);
      }
      const meta = store.createStory(name, format, format_version);
      return ok(meta);
    },
  );

  /** delete_story */
  server.registerTool(
    'delete_story',
    {
      annotations: destructive,
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
      annotations: mutating,
      description:
        'Write the story to export/<story>.twee and return the path. ' +
        'Does not return Twee source. Read passages with get_passage.',
      inputSchema: {
        name: z.string().describe('Story name'),
      },
    },
    async ({ name }) => {
      const storyObj = store.getStoryObject(name);
      const root = store.getProjectRoot?.(name) ?? null;
      if (!storyObj || !root) return err(storyNotFoundMsg(name, store));
      const twee = storyObj.toTwee();
      const outputPath = tweeExportPath(root, name);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, twee, 'utf-8');
      return ok({
        outputPath,
        byteSize: Buffer.byteLength(twee, 'utf8'),
        passageCount: storyObj.passages.length,
      });
    },
  );
}

/**
 * Path for a Twee export next to the project.
 *
 * @param root - Project directory
 * @param name - Story name
 * @returns Absolute .twee path under export/
 */
function tweeExportPath(root: string, name: string): string {
  const safe = name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'story';
  return path.join(root, 'export', `${safe}.twee`);
}

/** Wrap a value as a successful MCP text response. */
export function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}

/**
 * Wrap a diagnostic as an MCP error response.
 *
 * @param message - Structured error, or a plain message
 * @returns Tool result with isError set
 */
export function err(message: string | ToolError) {
  const payload: ToolError = typeof message === 'string'
    ? { error: 'Error', message }
    : message;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    isError: true as const,
  };
}
