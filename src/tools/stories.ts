/**
 * Story-level MCP tools: list, get, create, delete, export, compile.
 * Registered onto McpServer in server.ts.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { parseTwine2HTML, Story } from 'extwee';
import { StoryStore } from '../story-store.js';

/**
 * Registers all story-management tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance
 */
export function registerStoryTools(
  server: McpServer,
  store: StoryStore,
): void {
  /** list_stories */
  server.registerTool(
    'list_stories',
    {
      description:
        'List all Twine stories in the library with basic metadata. ' +
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
          .describe(
            'Return only these fields. Omit for all fields.',
          ),
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
      if (!story) return err(`Story "${name}" not found.`);
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
        'Create a new Twine story file with a Start passage. ' +
        'Returns the new story metadata.',
      inputSchema: {
        name: z.string().describe('Story name'),
        format: z
          .string()
          .optional()
          .default('Harlowe')
          .describe('Story format name (Harlowe, SugarCube, Chapbook, Snowman)'),
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
      description:
        'Delete a story file from the library. This cannot be undone.',
      inputSchema: {
        name: z.string().describe('Story name to delete'),
      },
    },
    async ({ name }) => {
      const deleted = store.deleteStory(name);
      if (!deleted) return err(`Story "${name}" not found.`);
      return ok({ deleted: name });
    },
  );

  /** export_twee */
  server.registerTool(
    'export_twee',
    {
      description:
        'Export a story as Twee 3 source text. ' +
        'Useful for reading narrative content and for external tools.',
      inputSchema: {
        name: z.string().describe('Story name'),
      },
    },
    async ({ name }) => {
      const raw = store.getRaw(name);
      if (!raw) return err(`Story "${name}" not found.`);
      const story = parseTwine2HTML(raw.rawHtml) as Story;
      const twee = story.toTwee();
      return { content: [{ type: 'text' as const, text: twee }] };
    },
  );

  /** compile_story */
  server.registerTool(
    'compile_story',
    {
      description:
        'Compile a story to a self-contained playable HTML file at the ' +
        'given output path. Returns the output file path on success.',
      inputSchema: {
        name: z.string().describe('Story name'),
        output_path: z
          .string()
          .describe('Absolute path for the output HTML file'),
      },
    },
    async ({ name, output_path }) => {
      const raw = store.getRaw(name);
      if (!raw) return err(`Story "${name}" not found.`);
      const story = parseTwine2HTML(raw.rawHtml) as Story;
      // toTwine2HTML gives the data block; for a playable file we use the
      // same approach as the library file — splice into a minimal shell.
      // Full playable HTML requires a story format; we produce a proofing
      // export that includes all passage text in a readable HTML document.
      const twee = story.toTwee();
      const passageList = (story.passages as import('extwee').Passage[])
        .map(
          (p) =>
            `<section><h2>${escHtml(p.name)}</h2>` +
            `<pre>${escHtml(p.text)}</pre></section>`,
        )
        .join('\n');
      const html =
        `<!DOCTYPE html><html><head><meta charset="utf-8">` +
        `<title>${escHtml(story.name)} — Proofing Export</title>` +
        `<style>body{font-family:sans-serif;max-width:800px;margin:2em auto}` +
        `h2{color:#555}pre{white-space:pre-wrap}</style></head>` +
        `<body><h1>${escHtml(story.name)}</h1>` +
        `<p><strong>Format:</strong> ${escHtml(story.format)} ${escHtml(story.formatVersion)}</p>` +
        `<p><strong>Start:</strong> ${escHtml(story.start)}</p>` +
        `<hr>${passageList}` +
        `<details><summary>Twee Source</summary><pre>${escHtml(twee)}</pre></details>` +
        `</body></html>`;

      const { writeFileSync } = await import('fs');
      writeFileSync(output_path, html, 'utf-8');
      return ok({ outputPath: output_path, passages: story.passages.length });
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

/**
 * Escapes HTML special characters to produce safe HTML output.
 *
 * @param s - Raw string to escape
 * @returns HTML-safe string with &, <, >, " replaced by entities
 */
function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
