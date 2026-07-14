/**
 * MCP `roots` capability integration.
 *
 * If the connected client advertises support for `roots`, ask it for
 * its current folders on initialize and whenever it notifies us that
 * its roots changed, merging them into the WorkspaceStore's
 * client-advertised root set. Also records whether the capability was
 * advertised and whether the request itself succeeded, since some
 * clients advertise `roots` but don't actually implement `roots/list`.
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
 * root set. Records clientRootsSupported/clientRootsError on the
 * store either way, so get_config can distinguish "client doesn't
 * support roots" from "client says it supports roots but the request
 * failed" (a known limitation in some MCP clients, e.g. Cursor's
 * `roots/list` currently returns "Method not found" despite
 * advertising the capability) from "client supports roots and has
 * none open."
 *
 * @param rawServer - Underlying low-level Server (McpServer.server)
 * @param store     - WorkspaceStore to update
 */
async function refreshClientRoots(
  rawServer: Server,
  store: WorkspaceStore,
): Promise<void> {
  const supported = Boolean(rawServer.getClientCapabilities()?.roots);
  store.setClientRootsSupported(supported);
  if (!supported) {
    process.stderr.write(
      '[twine-mcp] client did not advertise the roots capability\n',
    );
    return;
  }
  try {
    const result = await rawServer.listRoots();
    const paths = (result.roots ?? [])
      .map((r) => rootUriToPath(r.uri))
      .filter((p): p is string => p !== null);
    store.setClientRootsError(null);
    store.setClientRoots(paths);
    process.stderr.write(
      `[twine-mcp] client roots: ${paths.length ? paths.join(', ') : '(none)'}\n`,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    store.setClientRootsError(message);
    process.stderr.write(
      '[twine-mcp] client advertises roots support but roots/list ' +
      `failed: ${message}\n`,
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
