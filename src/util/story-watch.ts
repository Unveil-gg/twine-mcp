/**
 * Watch project src/ directories and report story-file changes.
 * Recursive watching is used on Windows and macOS. Other platforms
 * watch src/ and its immediate subdirectories.
 */

import fs from 'fs';
import path from 'path';

const DEBOUNCE_MS = 250;
const STORY_FILE = /\.(twee|tw|css|js)$/i;

/** Handle returned by watchStorySources. */
export interface StoryWatch {
  close(): void;
}

/**
 * True when a watch event may be a story source file.
 * A null filename is treated as relevant because some platforms omit it.
 *
 * @param filename - Path reported by fs.watch, or null
 * @returns Whether the server should reload
 */
export function isStorySource(filename: string | null): boolean {
  if (!filename) return true;
  return STORY_FILE.test(filename);
}

/**
 * Watch each project's src directory.
 *
 * @param projectRoots - Absolute project roots
 * @param onChange - Called with the project root after a short debounce
 * @returns Close handle
 */
export function watchStorySources(
  projectRoots: string[],
  onChange: (projectRoot: string) => void,
): StoryWatch {
  const watchers: fs.FSWatcher[] = [];
  const timers = new Map<string, NodeJS.Timeout>();
  const recursive = process.platform === 'win32'
    || process.platform === 'darwin';

  const schedule = (projectRoot: string): void => {
    const prev = timers.get(projectRoot);
    if (prev) clearTimeout(prev);
    timers.set(projectRoot, setTimeout(() => {
      timers.delete(projectRoot);
      onChange(projectRoot);
    }, DEBOUNCE_MS));
  };

  for (const root of projectRoots) {
    const src = path.join(root, 'src');
    if (!fs.existsSync(src)) continue;
    const deep = recursive && watchDir(
      src, true, () => schedule(root), watchers,
    );
    if (!deep) {
      watchDir(src, false, () => schedule(root), watchers);
      watchChildren(src, () => schedule(root), watchers);
    }
  }

  return {
    close() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const watcher of watchers) watcher.close();
      watchers.length = 0;
    },
  };
}

/**
 * Watch one directory.
 *
 * @returns False when fs.watch throws (caller should fall back)
 */
function watchDir(
  dir: string,
  recursive: boolean,
  onEvent: () => void,
  bucket: fs.FSWatcher[],
): boolean {
  try {
    const watcher = fs.watch(dir, { recursive }, (_event, filename) => {
      const name = typeof filename === 'string' ? filename : null;
      if (!isStorySource(name)) return;
      onEvent();
    });
    watcher.on('error', () => { /* directory may disappear */ });
    bucket.push(watcher);
    return true;
  } catch {
    return false;
  }
}

/** One-level fallback: immediate subdirectories of src/. */
function watchChildren(
  src: string,
  onEvent: () => void,
  bucket: fs.FSWatcher[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    watchDir(path.join(src, entry.name), false, onEvent, bucket);
  }
}
