/**
 * Resolves the Twine story library path from environment variables,
 * Electron app-prefs.json, or the OS default.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** Electron userData directories per platform. */
const ELECTRON_USER_DATA: Record<string, string> = {
  win32: path.join(
    os.homedir(),
    'AppData',
    'Roaming',
    'Twine',
  ),
  darwin: path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Twine',
  ),
  linux: path.join(os.homedir(), '.config', 'Twine'),
};

/** Default story library path per platform. */
const DEFAULT_LIBRARY: Record<string, string> = {
  win32: path.join(os.homedir(), 'Documents', 'Twine', 'Stories'),
  darwin: path.join(os.homedir(), 'Documents', 'Twine', 'Stories'),
  linux: path.join(os.homedir(), 'Documents', 'Twine', 'Stories'),
};

interface AppPrefs {
  storyLibraryFolderPath?: string;
}

/**
 * Reads Electron app-prefs.json and returns storyLibraryFolderPath if set.
 *
 * @returns Path string or null if not found
 */
function readElectronPrefs(): string | null {
  const userData = ELECTRON_USER_DATA[process.platform];
  if (!userData) return null;
  const prefsPath = path.join(userData, 'app-prefs.json');
  try {
    const raw = fs.readFileSync(prefsPath, 'utf-8');
    const prefs: AppPrefs = JSON.parse(raw);
    return prefs.storyLibraryFolderPath ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves the story library directory, checking in order:
 *   1. TWINE_LIBRARY environment variable
 *   2. Electron app-prefs.json
 *   3. OS default (~/Documents/Twine/Stories)
 *
 * @returns Absolute path to the story library folder
 */
export function resolveLibraryPath(): string {
  if (process.env['TWINE_LIBRARY']) {
    return path.resolve(process.env['TWINE_LIBRARY']);
  }
  const fromPrefs = readElectronPrefs();
  if (fromPrefs) return path.resolve(fromPrefs);
  return DEFAULT_LIBRARY[process.platform] ??
    path.join(os.homedir(), 'Documents', 'Twine', 'Stories');
}

/**
 * Ensures the library directory exists, creating it if needed.
 *
 * @param libraryPath - Absolute path to verify/create
 */
export function ensureLibraryExists(libraryPath: string): void {
  fs.mkdirSync(libraryPath, { recursive: true });
}
