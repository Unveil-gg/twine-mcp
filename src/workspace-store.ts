/**
 * WorkspaceStore — discovers Twee game projects across one or more
 * workspace roots and routes IStoryStore calls to the correct
 * per-game ProjectStore.
 *
 * Roots come from two additive sources, unioned into an "effective"
 * set (see rescan()):
 *   - configuredRoots: from config.ts (config file / env vars)
 *   - clientRoots: advertised by the MCP client via the `roots`
 *     capability (see setClientRoots(), wired up in server.ts)
 *
 * For each effective root, discovery scans three areas (unchanged
 * from the single-root design):
 *   1. The root itself (if it contains src/*.twee)
 *   2. Direct subdirectories of the root
 *   3. Sibling directories (children of the root's parent)
 *
 * list_stories() is cheap — it returns a lightweight index without
 * loading full passage data. Other methods lazy-load a ProjectStore
 * the first time a specific story is accessed.
 *
 * rescan() is cheap (directory listings only) and is called on every
 * setClientRoots() update and by callers of list_stories/get_config,
 * so newly created projects show up without a server restart.
 */

import path from 'path';
import { Story } from 'extwee';
import { ProjectStore } from './project-store.js';
import { dedupeRoots } from './config.js';
import {
  discoverProjects,
  lightMeta,
  readStoryName,
} from './util/project-discovery.js';
import type {
  IStoryStore,
  StoryMeta,
  StoryFull,
  FileEntry,
} from './types.js';

// Re-exported for backwards compatibility with existing imports
// (e.g. tools/project.ts's create_project directory check).
export {
  discoverProjects,
  isProject,
  hasExistingTweeProject,
} from './util/project-discovery.js';

export class WorkspaceStore implements IStoryStore {
  private configuredRoots: string[];
  private clientRoots: string[] = [];
  private effectiveRoots: string[] = [];
  private rootsSupported = false;
  private rootsError: string | null = null;

  /** projectRoot → ProjectStore (lazy-loaded). */
  private readonly projects = new Map<string, ProjectStore>();
  /** story name → all project roots currently using that name. */
  private readonly index = new Map<string, string[]>();

  constructor(configuredRoots: string[]) {
    this.configuredRoots = dedupeRoots(configuredRoots);
  }

  /** Discover all game projects and build the lightweight name index. */
  async init(): Promise<void> {
    this.rescan();
  }

  /** Roots from config file / env vars, as passed to the constructor. */
  get configuredWorkspaceRoots(): string[] {
    return this.configuredRoots;
  }

  /** Roots most recently advertised by the connected MCP client. */
  get clientWorkspaceRoots(): string[] {
    return this.clientRoots;
  }

  /** union(configuredWorkspaceRoots, clientWorkspaceRoots), deduped. */
  get effectiveWorkspaceRoots(): string[] {
    return this.effectiveRoots;
  }

  /**
   * True if the client advertised the `roots` capability at initialize.
   * Does not guarantee roots/list works — some clients (e.g. Cursor, as
   * of this writing) advertise support but error on the call; see
   * clientRootsError for that case.
   */
  get clientRootsSupported(): boolean {
    return this.rootsSupported;
  }

  /** Error from the most recent failed roots/list call, or null. */
  get clientRootsError(): string | null {
    return this.rootsError;
  }

  /** Record whether the client advertised `roots` at initialize. */
  setClientRootsSupported(supported: boolean): void {
    this.rootsSupported = supported;
  }

  /** Record (or clear, via null) the latest roots/list failure. */
  setClientRootsError(message: string | null): void {
    this.rootsError = message;
  }

  /**
   * Replace the client-advertised root set (from `roots/list`, or its
   * `notifications/roots/list_changed` refresh) and rescan. Configured
   * roots are never removed by this call — client roots are additive.
   *
   * @param roots - Absolute filesystem paths advertised by the client
   */
  setClientRoots(roots: string[]): void {
    this.clientRoots = dedupeRoots(roots);
    this.rescan();
  }

  /**
   * Permanently add a directory to the configured root set and rescan.
   * Used right after create_project/import_from_twine so the new
   * project is discoverable immediately, even if its directory isn't
   * already covered by a configured or client-advertised root.
   *
   * @param dir - Absolute directory path to track going forward
   */
  adoptRoot(dir: string): void {
    this.configuredRoots = dedupeRoots([...this.configuredRoots, dir]);
    this.rescan();
  }

  /**
   * Recompute the effective root set and rescan every root's
   * filesystem for game projects. Only does cheap directory listings
   * (no Twee parsing), so it is safe to call frequently — e.g. before
   * every list_stories/get_config response — to pick up projects
   * created since the last scan without a server restart.
   */
  rescan(): void {
    this.effectiveRoots = dedupeRoots(
      [...this.configuredRoots, ...this.clientRoots],
    );

    const newIndex = new Map<string, string[]>();
    const discoveredRoots = new Set<string>();
    for (const root of this.effectiveRoots) {
      for (const projectRoot of discoverProjects(root)) {
        if (discoveredRoots.has(projectRoot)) continue;
        discoveredRoots.add(projectRoot);
        const name = readStoryName(projectRoot) ?? path.basename(projectRoot);
        const roots = newIndex.get(name) ?? [];
        roots.push(projectRoot);
        newIndex.set(name, roots);
      }
    }
    this.index.clear();
    for (const [name, roots] of newIndex) this.index.set(name, roots);

    // Drop cached ProjectStores for projects that disappeared.
    for (const root of [...this.projects.keys()]) {
      if (!discoveredRoots.has(root)) this.projects.delete(root);
    }
  }

  /**
   * Resolve the single project root for a story name.
   *
   * @param name - Story name from listStories()
   * @param rootHint - Optional project root to disambiguate collisions
   * @returns Absolute project root, or null if the name is unknown
   * @throws Error if the name matches more than one project root and
   *   rootHint does not resolve the collision
   */
  private resolveRoot(name: string, rootHint?: string): string | null {
    const roots = this.index.get(name);
    if (!roots || roots.length === 0) return null;
    if (roots.length === 1) return roots[0];

    if (rootHint) {
      const hintAbs = path.resolve(rootHint);
      const match = roots.find((r) => path.resolve(r) === hintAbs);
      if (match) return match;
      throw new Error(
        `root "${rootHint}" does not match any project named "${name}". ` +
        `Candidates: ${roots.join(', ')}`,
      );
    }
    throw new Error(
      `Story name "${name}" is ambiguous: it exists in ${roots.length} ` +
      `different project roots (${roots.join(', ')}). Rename one of the ` +
      'projects, or pass a "root" parameter matching the intended path.',
    );
  }

  /**
   * Return the ProjectStore for a given story name, loading it if needed.
   * Returns null if the name is not in the discovered index.
   *
   * @param name - Story name from listStories()
   * @param rootHint - Optional project root to disambiguate collisions
   */
  getProjectStore(name: string, rootHint?: string): ProjectStore | null {
    const root = this.resolveRoot(name, rootHint);
    if (!root) return null;
    if (!this.projects.has(root)) {
      const ps = new ProjectStore(root);
      ps.initSync();
      this.projects.set(root, ps);
    }
    return this.projects.get(root)!;
  }

  // ── IStoryStore ─────────────────────────────────────────────────────────────

  /**
   * Return lightweight metadata for all discovered projects across
   * every effective root. Projects with a name collision across roots
   * appear as separate entries (same `name`, different `filePath`),
   * so collisions are visible instead of silently merged.
   */
  listStories(): StoryMeta[] {
    const out: StoryMeta[] = [];
    for (const [name, roots] of this.index) {
      for (const root of roots) {
        const ps = this.projects.get(root);
        out.push(ps?.listStories()[0] ?? lightMeta(name, root));
      }
    }
    return out;
  }

  getStoryFull(name: string): StoryFull | null {
    return this.getProjectStore(name)?.getStoryFull(name) ?? null;
  }

  getStoryObject(name: string): Story | null {
    return this.getProjectStore(name)?.getStoryObject(name) ?? null;
  }

  saveStory(story: Story): void {
    this.getProjectStore(story.name)?.saveStory(story);
  }

  createStory(
    _name: string,
    _format?: string,
    _formatVersion?: string,
  ): StoryMeta {
    throw new Error(
      'Use create_project to scaffold a new game directory inside one ' +
      'of your workspace roots (see list_workspace_roots).',
    );
  }

  deleteStory(_name: string): boolean {
    throw new Error(
      'Project deletion is not supported via MCP. ' +
      'Remove the directory manually.',
    );
  }

  getPassageFile(passageName: string): string | undefined {
    for (const ps of this.projects.values()) {
      const f = ps.getPassageFile(passageName);
      if (f !== undefined) return f;
    }
    return undefined;
  }

  setPassageFile(passageName: string, filePath: string): void {
    for (const ps of this.projects.values()) {
      if (ps.getPassageFile(passageName) !== undefined) {
        ps.setPassageFile(passageName, filePath);
        return;
      }
    }
  }

  getProjectRoot(name: string): string | null {
    return this.getProjectStore(name)?.projectRoot ?? null;
  }

  listFiles(): FileEntry[] {
    return [];
  }

  async close(): Promise<void> {
    for (const ps of this.projects.values()) {
      await ps.close();
    }
  }
}
