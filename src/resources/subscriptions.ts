/**
 * Resource subscription registry and notifications/resources/updated.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/** URIs that change when a story's source files change. */
export function storyResourceUris(storyName: string): string[] {
  const enc = encodeURIComponent(storyName);
  return [
    'twine://stories',
    `twine://stories/${enc}/manifest`,
    `twine://stories/${enc}/graph`,
    `twine://stories/${enc}/summary`,
    `twine://story/${enc}`,
    `twine://story/${enc}/graph`,
    `twine://story/${enc}/summary`,
  ];
}

/** Client subscriptions to resource URIs. */
export class ResourceSubscriptions {
  private readonly uris = new Set<string>();

  /** Start sending updates for a URI. */
  subscribe(uri: string): void {
    this.uris.add(uri);
  }

  /** Stop sending updates for a URI. */
  unsubscribe(uri: string): void {
    this.uris.delete(uri);
  }

  /**
   * Subscribed URIs affected by a change to this story.
   *
   * @param storyName - Story whose sources changed
   * @returns URIs the client asked to watch
   */
  matching(storyName: string): string[] {
    const wanted = new Set(storyResourceUris(storyName));
    return [...this.uris].filter((uri) => wanted.has(uri));
  }
}

/** Minimal server surface used to emit resource updates. */
export interface ResourceNotifier {
  sendResourceUpdated(params: { uri: string }): Promise<void>;
}

/**
 * Notify the client that subscribed story resources changed.
 *
 * @param raw - Low-level MCP server
 * @param subs - Active subscriptions
 * @param storyName - Story that changed
 */
export async function notifyStoryUpdated(
  raw: ResourceNotifier,
  subs: ResourceSubscriptions,
  storyName: string,
): Promise<void> {
  for (const uri of subs.matching(storyName)) {
    await raw.sendResourceUpdated({ uri });
  }
}

/**
 * Advertise resources.subscribe and handle subscribe/unsubscribe.
 * Call before the server connects.
 *
 * @param server - High-level MCP server
 * @returns Subscription registry
 */
export function registerResourceSubscriptions(
  server: McpServer,
): ResourceSubscriptions {
  const subs = new ResourceSubscriptions();
  server.server.registerCapabilities({
    resources: { subscribe: true },
  });
  server.server.setRequestHandler(
    SubscribeRequestSchema,
    async (request) => {
      subs.subscribe(request.params.uri);
      return {};
    },
  );
  server.server.setRequestHandler(
    UnsubscribeRequestSchema,
    async (request) => {
      subs.unsubscribe(request.params.uri);
      return {};
    },
  );
  return subs;
}
