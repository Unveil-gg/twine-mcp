/**
 * MCP `roots` capability integration.
 *
 * If the connected client advertises support for `roots`, ask it for
 * its current folders on initialize and whenever it notifies us that
 * its roots changed, merging them into the WorkspaceStore's
 * client-advertised root set.
 */

import { fileURLToPath } from 'url';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { RootsListChangedNotificationSchema } from
  '@modelcontextprotocol/sdk/types.js';
import type { WorkspaceStore } from '../workspace-store.js';

/**
 * Convert a `file://` root URI (as advertised by an MCP client) to a
 * local filesystem path. Returns null for non-file URIs.
 *
 * @param uri - Root URI from a client's roots/list response
 */
function rootUriToPath(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/**
 * Ask the connected client for its current roots (if it supports the
 * `roots` capability) and merge them into the workspace's effective
 * root set.
 *
 * @param rawServer - Underlying low-level Server (McpServer.server)
 * @param store     - WorkspaceStore to update
 */
async function refreshClientRoots(
  rawServer: Server,
  store: WorkspaceStore,
): Promise<void> {
  if (!rawServer.getClientCapabilities()?.roots) return;
  try {
    const result = await rawServer.listRoots();
    const paths = (result.roots ?? [])
      .map((r) => rootUriToPath(r.uri))
      .filter((p): p is string => p !== null);
    store.setClientRoots(paths);
    process.stderr.write(
      `[twine-mcp] client roots: ${paths.length ? paths.join(', ') : '(none)'}\n`,
    );
  } catch (e) {
    process.stderr.write(
      `[twine-mcp] failed to list client roots: ${String(e)}\n`,
    );
  }
}

/**
 * Wire up the `roots` capability on a server: fetch client roots once
 * initialization completes, and again on every
 * notifications/roots/list_changed. Safe to call even if the client
 * never advertises `roots` support — refreshClientRoots() no-ops.
 *
 * @param rawServer - Underlying low-level Server (McpServer.server)
 * @param store     - WorkspaceStore to keep in sync with client roots
 */
export function setupRootsCapability(
  rawServer: Server,
  store: WorkspaceStore,
): void {
  rawServer.oninitialized = () => {
    void refreshClientRoots(rawServer, store);
  };
  rawServer.setNotificationHandler(
    RootsListChangedNotificationSchema,
    () => refreshClientRoots(rawServer, store),
  );
}
