/**
 * Story resources. Canonical URIs are compact. Legacy twine://story
 * URIs return the same payloads and no longer include passage text.
 */

import { McpServer, ResourceTemplate } from
  '@modelcontextprotocol/sdk/server/mcp.js';
import type { IStoryStore } from '../types.js';
import { storyNotFoundMsg } from '../util/errors.js';
import {
  buildGraphResource,
  buildManifest,
  buildSummary,
} from './payloads.js';

type StoryVar = string | string[] | undefined;

/**
 * Register story index, manifest, graph, and summary resources.
 *
 * @param server - McpServer instance
 * @param store - Story store
 */
export function registerStoryResources(
  server: McpServer,
  store: IStoryStore,
): void {
  server.registerResource(
    'stories',
    'twine://stories',
    {
      description: 'Discovered stories. Metadata only.',
      mimeType: 'application/json',
    },
    async (uri) => {
      store.rescan?.();
      return jsonResource(uri.href, store.listStories());
    },
  );

  registerTemplate(server, store, {
    name: 'story-manifest',
    template: 'twine://stories/{name}/manifest',
    description:
      'Story manifest: metadata and passage index, no passage text.',
    listKind: 'manifest',
    read: (story) => buildManifest(story),
  });
  registerTemplate(server, store, {
    name: 'story-graph',
    template: 'twine://stories/{name}/graph',
    description: 'Passage link graph as an adjacency list of names.',
    listKind: 'graph',
    read: (story) => buildGraphResource(story),
  });
  registerTemplate(server, store, {
    name: 'story-summary',
    template: 'twine://stories/{name}/summary',
    description: 'Compact narrative snapshot.',
    listKind: 'summary',
    read: (story) => buildSummary(story),
  });

  // Legacy URIs. Readable, but not listed, so resources/list stays small.
  registerTemplate(server, store, {
    name: 'story',
    template: 'twine://story/{name}',
    description: 'Alias of the story manifest.',
    read: (story) => buildManifest(story),
  });
  registerTemplate(server, store, {
    name: 'story-graph-alias',
    template: 'twine://story/{name}/graph',
    description: 'Alias of the story link graph.',
    read: (story) => buildGraphResource(story),
  });
  registerTemplate(server, store, {
    name: 'story-summary-alias',
    template: 'twine://story/{name}/summary',
    description: 'Alias of the story summary.',
    read: (story) => buildSummary(story),
  });
}

interface TemplateSpec {
  name: string;
  template: string;
  description: string;
  listKind?: 'manifest' | 'graph' | 'summary';
  read: (story: NonNullable<ReturnType<IStoryStore['getStoryFull']>>) =>
    unknown;
}

/** Register one resource template, optionally listing it per story. */
function registerTemplate(
  server: McpServer,
  store: IStoryStore,
  spec: TemplateSpec,
): void {
  const list = spec.listKind
    ? async () => ({
      resources: listStoryResources(store, spec.listKind!),
    })
    : undefined;

  server.registerResource(
    spec.name,
    new ResourceTemplate(spec.template, { list }),
    {
      description: spec.description,
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const name = decodeName(variables['name']);
      const story = store.getStoryFull(name);
      const body = story
        ? spec.read(story)
        : storyNotFoundMsg(name, store);
      return jsonResource(uri.href, body);
    },
  );
}

/** One resource entry per discovered story. */
function listStoryResources(
  store: IStoryStore,
  kind: 'manifest' | 'graph' | 'summary',
): Array<{ uri: string; name: string; mimeType: string }> {
  const seen = new Set<string>();
  const resources = [];
  for (const story of store.listStories()) {
    if (seen.has(story.name)) continue;
    seen.add(story.name);
    const enc = encodeURIComponent(story.name);
    resources.push({
      uri: `twine://stories/${enc}/${kind}`,
      name: `${story.name} ${kind}`,
      mimeType: 'application/json',
    });
  }
  return resources;
}

/** First template variable, percent-decoded. */
function decodeName(value: StoryVar): string {
  const raw = Array.isArray(value) ? value[0] : value ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** JSON resource contents without pretty-print whitespace. */
function jsonResource(uri: string, data: unknown) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(data),
    }],
  };
}
