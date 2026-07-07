/**
 * Story format MCP tools: list_story_formats, get_format_info,
 * get_format_syntax_guide.
 */

import * as z from 'zod/v4';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StoryStore } from '../story-store.js';
import { getSyntaxGuide } from '../util/format-hints.js';
import { ok, err } from './stories.js';

/** Known built-in Twine formats with static metadata. */
const BUILT_IN_FORMATS: Record<
  string,
  { name: string; description: string; url: string }
> = {
  harlowe: {
    name: 'Harlowe',
    description:
      'Default Twine format. Beginner-friendly macro language. ' +
      'Macros use (name: args)[hook] syntax.',
    url: 'https://twine2.neocities.org/',
  },
  sugarcube: {
    name: 'SugarCube',
    description:
      'Powerful format for experienced authors. Full JavaScript access. ' +
      'Macros use <<name args>> syntax. Extensive save system.',
    url: 'https://www.motoslave.net/sugarcube/2/docs/',
  },
  chapbook: {
    name: 'Chapbook',
    description:
      'Modern format with clean prose syntax. ' +
      'Uses a vars section, inserts {var}, and modifiers [if].',
    url: 'https://klembot.github.io/chapbook/',
  },
  snowman: {
    name: 'Snowman',
    description:
      'Minimal format for JavaScript developers. ' +
      'Uses <% code %> and <%= expression %> in passages.',
    url: 'https://videlais.github.io/snowman/',
  },
  paperthin: {
    name: 'Paperthin',
    description:
      'Proofing format (not playable). Displays raw passage text ' +
      'for reviewing story content.',
    url: 'https://github.com/klembot/paperthin',
  },
};

/**
 * Reads story-formats.json from Twine's Electron userData directory.
 * Returns array of user-added format entries.
 */
function readUserFormats(): Array<{ name: string; url: string }> {
  const userData: Record<string, string> = {
    win32: path.join(os.homedir(), 'AppData', 'Roaming', 'Twine'),
    darwin: path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Twine',
    ),
    linux: path.join(os.homedir(), '.config', 'Twine'),
  };
  const dir = userData[process.platform];
  if (!dir) return [];
  const formatsPath = path.join(dir, 'story-formats.json');
  try {
    const raw = fs.readFileSync(formatsPath, 'utf-8');
    return JSON.parse(raw) as Array<{ name: string; url: string }>;
  } catch {
    return [];
  }
}

/**
 * Registers all story format tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - StoryStore instance (used for detecting used formats)
 */
export function registerFormatTools(
  server: McpServer,
  store: StoryStore,
): void {
  /** list_story_formats */
  server.registerTool(
    'list_story_formats',
    {
      description:
        'List all known Twine story formats (built-in and user-installed). ' +
        'Also shows which formats are currently used by stories in the library.',
      inputSchema: {},
    },
    async () => {
      const userFormats = readUserFormats();
      const usedFormats = new Set(
        store.listStories().map((s) => s.format),
      );

      const builtIn = Object.values(BUILT_IN_FORMATS).map((f) => ({
        ...f,
        source: 'built-in',
        usedInLibrary: usedFormats.has(f.name),
      }));

      const userAdded = userFormats.map((f) => ({
        name: f.name,
        url: f.url,
        source: 'user-added',
        usedInLibrary: usedFormats.has(f.name),
      }));

      return ok({ builtIn, userAdded });
    },
  );

  /** get_format_info */
  server.registerTool(
    'get_format_info',
    {
      description:
        'Get information about a specific story format: description, docs URL, ' +
        'and which stories in the library use it.',
      inputSchema: {
        format: z.string().describe('Format name (e.g. "Harlowe", "SugarCube")'),
      },
    },
    async ({ format }) => {
      const key = format.toLowerCase().replace(/\s+\d.*$/, '').trim();
      const builtin = BUILT_IN_FORMATS[key];
      const stories = store
        .listStories()
        .filter((s) => s.format.toLowerCase() === format.toLowerCase())
        .map((s) => ({
          name: s.name,
          formatVersion: s.formatVersion,
        }));

      if (!builtin) {
        const userFormats = readUserFormats();
        const user = userFormats.find(
          (f) => f.name.toLowerCase() === format.toLowerCase(),
        );
        if (!user) {
          return err(
            `Format "${format}" not found. ` +
            `Known formats: ${Object.values(BUILT_IN_FORMATS)
              .map((f) => f.name)
              .join(', ')}`,
          );
        }
        return ok({ ...user, source: 'user-added', stories });
      }

      return ok({ ...builtin, source: 'built-in', stories });
    },
  );

  /** get_format_syntax_guide */
  server.registerTool(
    'get_format_syntax_guide',
    {
      description:
        'Return a concise syntax reference for a story format. ' +
        'Covers variables, conditionals, links, macros/widgets.',
      inputSchema: {
        format: z.string().describe('Format name (e.g. "Harlowe", "SugarCube")'),
      },
    },
    async ({ format }) => {
      const guide = getSyntaxGuide(format);
      return { content: [{ type: 'text' as const, text: guide }] };
    },
  );
}
