/**
 * Server-level utility MCP tools: ping, get_config, list_workspace_roots,
 * rescan_workspace, batch_update. Registered onto McpServer in server.ts.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WorkspaceStore } from '../workspace-store.js';
import { ok, err } from './stories.js';
import { storyNotFoundMsg } from '../util/errors.js';
import { listCachedFormats } from '../format-manager.js';
import { VERSION } from '../version.js';

/**
 * Registers server-level utility tools on the MCP server.
 *
 * @param server - McpServer instance
 * @param store  - WorkspaceStore instance
 */
export function registerUtilityTools(
  server: McpServer,
  store: WorkspaceStore,
): void {
  /** ping */
  server.registerTool(
    'ping',
    {
      description:
        'Health check. Returns server version, workspace roots, and ' +
        'the list of discovered game projects.',
      inputSchema: {},
    },
    async () => {
      store.rescan();
      const stories = store.listStories();
      return ok({
        status: 'ok',
        version: VERSION,
        workspaceRoots: store.effectiveWorkspaceRoots,
        games: stories.map((s) => ({
          name: s.name,
          passageCount: s.passageCount,
          lastModified: s.lastModified,
        })),
        cachedFormats: listCachedFormats(),
      });
    },
  );

  /** get_config */
  server.registerTool(
    'get_config',
    {
      description:
        'Return current server configuration, including the full ' +
        'effective set of workspace roots being scanned for projects.',
      inputSchema: {},
    },
    async () => {
      store.rescan();
      return ok({
        version: VERSION,
        configuredWorkspaceRoots: store.configuredWorkspaceRoots,
        clientWorkspaceRoots: store.clientWorkspaceRoots,
        effectiveWorkspaceRoots: store.effectiveWorkspaceRoots,
        platform: process.platform,
        nodeVersion: process.version,
        cachedFormats: listCachedFormats(),
      });
    },
  );

  /** list_workspace_roots */
  server.registerTool(
    'list_workspace_roots',
    {
      description:
        'List the effective workspace roots being scanned for Twine ' +
        'projects: configured roots (config file / env vars) unioned ' +
        'with any folders advertised by the MCP client.',
      inputSchema: {},
    },
    async () => {
      store.rescan();
      return ok({
        configuredWorkspaceRoots: store.configuredWorkspaceRoots,
        clientWorkspaceRoots: store.clientWorkspaceRoots,
        effectiveWorkspaceRoots: store.effectiveWorkspaceRoots,
      });
    },
  );

  /** rescan_workspace */
  server.registerTool(
    'rescan_workspace',
    {
      description:
        'Re-scan all effective workspace roots for Twine projects ' +
        'without restarting the server. Normally unnecessary — ' +
        'list_stories and get_config already rescan automatically — ' +
        'but useful right after create_project/import_from_twine.',
      inputSchema: {},
    },
    async () => {
      store.rescan();
      return ok({
        effectiveWorkspaceRoots: store.effectiveWorkspaceRoots,
        stories: store.listStories().map((s) => s.name),
      });
    },
  );

  /** batch_update — atomic multi-passage edit */
  server.registerTool(
    'batch_update',
    {
      description:
        'Apply multiple passage updates to a story in a single atomic save. ' +
        'Specify text, tags, or position for each passage.',
      inputSchema: {
        story: z.string().describe('Story name'),
        updates: z
          .array(
            z.object({
              passage: z.string().describe('Passage name'),
              text: z.string().optional(),
              tags: z.array(z.string()).optional(),
              position: z.string().optional(),
            }),
          )
          .min(1)
          .describe('List of passage updates to apply'),
      },
    },
    async ({ story, updates }) => {
      const storyObj = store.getStoryObject(story);
      if (!storyObj) return err(storyNotFoundMsg(story, store));
      const applied: string[] = [];
      const failed: string[] = [];

      for (const u of updates) {
        const p = storyObj.getPassageByName(u.passage) as
          | import('extwee').Passage | undefined;
        if (!p) { failed.push(u.passage); continue; }
        if (u.text !== undefined) p.text = u.text;
        if (u.tags !== undefined) p.tags = u.tags;
        if (u.position !== undefined) {
          const meta = (p.metadata ?? {}) as Record<string, string>;
          meta['position'] = u.position;
          p.metadata = meta;
        }
        applied.push(u.passage);
      }

      if (applied.length > 0) store.saveStory(storyObj);
      return ok({ applied, failed });
    },
  );
}
