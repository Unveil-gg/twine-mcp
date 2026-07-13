/**
 * WorkspaceStore — discovers multiple Twee game projects from the filesystem
 * and routes IStoryStore calls to the correct per-game ProjectStore.
 *
 * Discovery scans three areas relative to TWINE_PROJECT:
 *   1. TWINE_PROJECT itself (if it contains src/*.twee)
 *   2. Direct subdirectories of TWINE_PROJECT
 *   3. Sibling directories (children of TWINE_PROJECT's parent)
 *
 * This makes TWINE_PROJECT flexible: point it at a single game folder,
 * a workspace containing many games, or anywhere in between.
 *
 * list_stories() is cheap — it returns a lightweight index without
 * loading full passage data. Other methods lazy-load a ProjectStore
 * the first time a specific story is accessed.
 */

import fs from 'fs';
import path from 'path';
import { Story } from 'extwee';
import { ProjectStore } from './project-store.js';
import type {
  IStoryStore,
  StoryMeta,
  StoryFull,
  FileEntry,
} from './types.js';

/**
 * Returns true if a directory looks like a Twee game project
 * (has a src/ subdirectory containing at least one .twee or .tw file).
 *
 * @param dir - Absolute directory path to test
 */
function isProject(dir: string): boolean {
  const srcDir = path.join(dir, 'src');
  if (!fs.existsSync(srcDir)) return false;
  try {
    return fs.readdirSync(srcDir).some(
      (f) => f.endsWith('.twee') || f.endsWith('.tw'),
    );
  } catch {
    return false;
  }
}

/**
 * Read StoryTitle from a project's src/ files without a full parse.
 * Scans for the :: StoryTitle passage header using a lightweight regex.
 *
 * @param projectRoot - Root directory of the game project
 * @returns Story title string, or null if not found
 */
function readStoryName(projectRoot: string): string | null {
  const srcDir = path.join(projectRoot, 'src');
  try {
    const files = fs.readdirSync(srcDir).filter(
      (f) => f.endsWith('.twee') || f.endsWith('.tw'),
    );
    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf-8');
      const m = content.match(/^:: StoryTitle[^\n]*\n([^\n:][^\n]*)/m);
      if (m) return m[1].trim();
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Build a lightweight StoryMeta from directory scan alone.
 * Counts :: headers for passage count without full parsing.
 *
 * @param name - Story name to use
 * @param projectRoot - Root directory of the game project
 * @returns Lightweight StoryMeta (ifid/format fields are empty)
 */
function lightMeta(name: string, projectRoot: string): StoryMeta {
  const srcDir = path.join(projectRoot, 'src');
  let passageCount = 0;
  let lastModified = new Date(0).toISOString();
  try {
    const files = fs.readdirSync(srcDir).filter(
      (f) => f.endsWith('.twee') || f.endsWith('.tw'),
    );
    for (const file of files) {
      const filePath = path.join(srcDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      passageCount += (content.match(/^:: /gm) ?? []).length;
      const mtime = fs.statSync(filePath).mtime.toISOString();
      if (mtime > lastModified) lastModified = mtime;
    }
  } catch {
    // ignore
  }
  return {
    name,
    ifid: '',
    format: '',
    formatVersion: '',
    startPassage: '',
    passageCount,
    wordCount: 0,
    filePath: projectRoot,
    lastModified,
  };
}

/**
 * Scan a directory for immediate subdirectories that are game projects.
 *
 * @param dir - Directory to scan
 * @param found - Set to accumulate discovered absolute paths
 */
function scanDir(dir: string, found: Set<string>): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const abs = path.resolve(path.join(dir, entry.name));
      if (!found.has(abs) && isProject(abs)) found.add(abs);
    }
  } catch {
    // ignore unreadable directories
  }
}

/**
 * Discover all Twee project directories near the workspace root.
 * Checks the root itself, its children, and its sibling directories.
 *
 * @param workspaceRoot - Path from TWINE_PROJECT
 * @returns Deduplicated list of absolute project root paths
 */
export function discoverProjects(workspaceRoot: string): string[] {
  const found = new Set<string>();
  const abs = path.resolve(workspaceRoot);

  // 1. workspaceRoot itself
  if (isProject(abs)) found.add(abs);
  // 2. Children of workspaceRoot
  scanDir(abs, found);
  // 3. Siblings (children of parent directory)
  const parent = path.dirname(abs);
  if (parent !== abs) scanDir(parent, found);

  return [...found];
}

export class WorkspaceStore implements IStoryStore {
  readonly workspaceRoot: string;

  /** projectRoot → ProjectStore (lazy-loaded). */
  private readonly projects = new Map<string, ProjectStore>();
  /** story name → project root (lightweight index built at init). */
  private readonly index = new Map<string, string>();

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Discover all game projects and build a lightweight name index.
   * No full Twee parse happens here — only directory scanning.
   */
  async init(): Promise<void> {
    const roots = discoverProjects(this.workspaceRoot);
    for (const root of roots) {
      const name = readStoryName(root) ?? path.basename(root);
      this.index.set(name, root);
    }
  }

  /**
   * Return the ProjectStore for a given story name, loading it if needed.
   * Returns null if the name is not in the discovered index.
   *
   * @param name - Story name from listStories()
   */
  getProjectStore(name: string): ProjectStore | null {
    const root = this.index.get(name);
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
   * Return lightweight metadata for all discovered projects.
   * Already-loaded projects return their full metadata; others return
   * a cheap directory-scan estimate without loading passage content.
   */
  listStories(): StoryMeta[] {
    return [...this.index.entries()].map(([name, root]) => {
      const ps = this.projects.get(root);
      return ps?.listStories()[0] ?? lightMeta(name, root);
    });
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
      'Use create_project to scaffold a new game directory, ' +
      'then add it inside your TWINE_PROJECT workspace.',
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
