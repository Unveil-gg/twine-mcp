/**
 * Agent working notes tools.
 *
 * Provides persistent, session-spanning memory per story via a
 * .agent-notes.md file stored in the project root. The file is
 * human-readable, committable, and intentionally lean — agents
 * should treat it like a todo.md: write current objectives, not
 * the full story history.
 */

import fs from 'fs';
import path from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { IStoryStore } from '../types.js';
import { ok, err } from './stories.js';
import { storyNotFoundMsg } from '../util/errors.js';

const NOTES_FILENAME = '.agent-notes.md';

/**
 * Resolve the notes file path for a project root.
 *
 * @param projectRoot - Absolute project directory path
 * @returns Absolute path to .agent-notes.md
 */
function notesPath(projectRoot: string): string {
  return path.join(projectRoot, NOTES_FILENAME);
}

/**
 * Register get_agent_notes and update_agent_notes MCP tools.
 *
 * @param server - MCP server instance
 * @param store  - Story store implementing getProjectRoot
 */
export function registerAgentNotesTools(
  server: McpServer,
  store: IStoryStore,
): void {
  server.registerTool(
    'get_agent_notes',
    {
      description:
        'Read the persistent agent working notes for a story. Notes ' +
        'are stored in .agent-notes.md at the project root and survive ' +
        'across sessions. Call this at the start of each session to ' +
        'resume objectives and context. Returns null content if no ' +
        'notes file exists yet.',
      inputSchema: {
        story: z.string().describe('Story name'),
      },
    },
    async ({ story }) => {
      const root = store.getProjectRoot?.(story) ?? null;
      if (root === null) return err(storyNotFoundMsg(story, store));

      const filePath = notesPath(root);
      if (!fs.existsSync(filePath)) {
        return ok({ content: null, lastModified: null, charCount: 0 });
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const mtime = fs.statSync(filePath).mtime.toISOString();
      return ok({
        content,
        lastModified: mtime,
        charCount: content.length,
      });
    },
  );

  server.registerTool(
    'update_agent_notes',
    {
      description:
        'Write or replace the agent working notes for a story. Notes ' +
        'are stored in .agent-notes.md in the project root and persist ' +
        'across sessions. Replaces the entire file on each call. ' +
        'Keep under ~500 words to avoid bloating future context. ' +
        'Suggested structure:\n' +
        '## Current Objective\n' +
        '## Completed\n' +
        '## Open Questions\n' +
        '## Key Decisions',
      inputSchema: {
        story: z.string().describe('Story name'),
        content: z.string().describe(
          'Full markdown content to write. Replaces existing notes.',
        ),
      },
    },
    async ({ story, content }) => {
      const root = store.getProjectRoot?.(story) ?? null;
      if (root === null) return err(storyNotFoundMsg(story, store));

      fs.writeFileSync(notesPath(root), content, 'utf-8');
      return ok({ updated: true, charCount: content.length });
    },
  );
}
