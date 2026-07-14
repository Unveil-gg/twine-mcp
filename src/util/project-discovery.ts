/**
 * Pure filesystem-scanning helpers for locating Twee game projects
 * under a workspace root. No state — WorkspaceStore owns the
 * in-memory index built from these functions' output.
 *
 * Discovery for a single root scans three areas:
 *   1. The root itself (if it contains src/*.twee)
 *   2. Direct subdirectories of the root
 *   3. Sibling directories (children of the root's parent)
 */

import fs from 'fs';
import path from 'path';
import type { StoryMeta } from '../types.js';

/**
 * Returns true if a directory looks like a Twee game project
 * (has a src/ subdirectory containing at least one .twee or .tw file).
 *
 * @param dir - Absolute directory path to test
 */
export function isProject(dir: string): boolean {
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
 * True if a directory already contains an existing Twee project —
 * either a src/ folder with .twee/.tw files, or a top-level
 * StoryData.twee. Used by create_project to avoid clobbering real
 * work while still allowing scaffolding into a directory that only
 * has non-project files (.git/, README.md, dotfiles, etc.).
 *
 * @param dir - Absolute directory path to test
 */
export function hasExistingTweeProject(dir: string): boolean {
  return isProject(dir) || fs.existsSync(path.join(dir, 'StoryData.twee'));
}

/**
 * Read StoryTitle from a project's src/ files without a full parse.
 * Scans for the :: StoryTitle passage header using a lightweight regex.
 *
 * @param projectRoot - Root directory of the game project
 * @returns Story title string, or null if not found
 */
export function readStoryName(projectRoot: string): string | null {
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

/** Fields cheaply recoverable from the :: StoryData passage's JSON body. */
interface StoryDataFields {
  ifid?: string;
  format?: string;
  formatVersion?: string;
  start?: string;
}

/**
 * Cheaply extract ifid/format/format-version/start from a file's ::
 * StoryData passage, without a full Twee parse. Reads only the JSON
 * body between the `:: StoryData` header and the next `:: ` header
 * (or end of file). Same source of truth as ProjectStore's toMeta(),
 * just without merging passages/links.
 *
 * @param content - Raw text of a .twee/.tw file
 * @returns Parsed StoryData fields, or null if this file has no
 *   StoryData passage or its body isn't valid JSON
 */
function extractStoryData(content: string): StoryDataFields | null {
  const header = content.match(/^:: StoryData\b[^\n]*\n/m);
  if (!header) return null;
  const bodyStart = (header.index ?? 0) + header[0].length;
  const rest = content.slice(bodyStart);
  const nextHeader = rest.search(/^:: /m);
  const body = nextHeader === -1 ? rest : rest.slice(0, nextHeader);
  try {
    const data = JSON.parse(body.trim()) as Record<string, unknown>;
    return {
      ifid: typeof data['ifid'] === 'string' ? data['ifid'] : undefined,
      format: typeof data['format'] === 'string' ? data['format'] : undefined,
      formatVersion: typeof data['format-version'] === 'string'
        ? data['format-version'] : undefined,
      start: typeof data['start'] === 'string' ? data['start'] : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Build a lightweight StoryMeta from directory scan alone. Counts ::
 * headers for passage count, and cheaply extracts ifid/format/
 * formatVersion/startPassage from the StoryData passage's JSON body
 * (regex-based, not a full Twee/passage-link parse).
 *
 * @param name - Story name to use
 * @param projectRoot - Root directory of the game project
 * @returns Lightweight StoryMeta (wordCount is always 0 — computing it
 *   requires parsing every passage's text)
 */
export function lightMeta(name: string, projectRoot: string): StoryMeta {
  const srcDir = path.join(projectRoot, 'src');
  let passageCount = 0;
  let lastModified = new Date(0).toISOString();
  let storyData: StoryDataFields | null = null;
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
      if (!storyData) storyData = extractStoryData(content);
    }
  } catch {
    // ignore
  }
  return {
    name,
    ifid: storyData?.ifid ?? '',
    format: storyData?.format ?? '',
    formatVersion: storyData?.formatVersion ?? '',
    startPassage: storyData?.start ?? '',
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
 * Discover all Twee project directories near a single workspace root.
 * Checks the root itself, its children, and its sibling directories.
 *
 * @param root - One effective workspace root
 * @returns Deduplicated list of absolute project root paths
 */
export function discoverProjects(root: string): string[] {
  const found = new Set<string>();
  const abs = path.resolve(root);

  // 1. root itself
  if (isProject(abs)) found.add(abs);
  // 2. Children of root
  scanDir(abs, found);
  // 3. Siblings (children of parent directory)
  const parent = path.dirname(abs);
  if (parent !== abs) scanDir(parent, found);

  return [...found];
}
