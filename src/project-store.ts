/**
 * ProjectStore — IStoryStore backed by a Twee project directory.
 *
 * Instead of watching a Twine library HTML folder, this store:
 *   - Scans src/**\/*.twee (and .tw) on init
 *   - Merges all passages into one in-memory Story
 *   - Tracks which passage lives in which source file
 *   - Writes edits back to the correct .twee file
 *
 * This is the primary store for the project-mode pivot.
 */

import fs from 'fs';
import path from 'path';
import { Story, Passage, parseTwee } from 'extwee';
import { parseLinks } from './util/parse-links.js';
import type {
  IStoryStore,
  StoryMeta,
  StoryFull,
  PassageFull,
  FileEntry,
} from './types.js';

/** Count words in a string. */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Convert a Passage to PassageFull. */
function toPassageFull(p: Passage): PassageFull {
  const text = p.text ?? '';
  return {
    name: p.name,
    tags: (p.tags as string[]) ?? [],
    wordCount: countWords(text),
    position: (p.metadata as Record<string, string>)?.['position'],
    size: (p.metadata as Record<string, string>)?.['size'],
    preview: text.slice(0, 80),
    text,
    links: parseLinks(text),
  };
}

/** Build StoryMeta from a Story and project root. */
function toMeta(story: Story, projectRoot: string): StoryMeta {
  const passages = story.passages as Passage[];
  const wordCount = passages.reduce(
    (s, p) => s + countWords(p.text ?? ''),
    0,
  );
  return {
    name: story.name || path.basename(projectRoot),
    ifid: story.IFID ?? '',
    format: story.format ?? 'Harlowe',
    formatVersion: story.formatVersion ?? '',
    startPassage: story.start ?? 'Start',
    passageCount: passages.length,
    wordCount,
    filePath: projectRoot,
    lastModified: new Date().toISOString(),
  };
}

/**
 * Serialize a list of Passage objects to Twee 3 file content.
 * Uses Passage.toTwee() which produces the canonical :: header + text.
 *
 * @param passages - Ordered passage list to serialize
 * @returns Twee 3 file content string
 */
function writeTweeContent(passages: Passage[]): string {
  return passages.map((p) => p.toTwee()).join('\n\n') + '\n';
}

/**
 * Serialize StoryTitle + StoryData headers from in-memory Story fields.
 * extwee absorbs these passages on parse, so saveStory must rewrite them
 * explicitly when story metadata (start, format, etc.) changes.
 *
 * @param story - Story with metadata fields to persist
 * @returns Twee 3 content for StoryTitle and StoryData passages
 */
function buildMetadataTwee(story: Story): string {
  const metadata: Record<string, unknown> = {};
  if (story.IFID) metadata.ifid = story.IFID;
  if (story.format) metadata.format = story.format;
  if (story.formatVersion) {
    metadata['format-version'] = story.formatVersion;
  }
  if (story.zoom) metadata.zoom = story.zoom;
  if (story.start) metadata.start = story.start;
  const tagColors = story.tagColors as Record<string, string> | undefined;
  if (tagColors && Object.keys(tagColors).length > 0) {
    metadata['tag-colors'] = tagColors;
  }

  let out = '';
  if (story.name) {
    out += `:: StoryTitle\n${story.name}\n\n`;
  }
  out += `:: StoryData\n${JSON.stringify(metadata, null, 2)}\n`;
  return out;
}

export class ProjectStore implements IStoryStore {
  readonly projectRoot: string;
  readonly srcDir: string;

  private story: Story = new Story();
  /** Maps passage name → absolute .twee file path. */
  private passageFileMap = new Map<string, string>();
  /**
   * Source file for story.storyStylesheet / story.storyJavaScript.
   * extwee absorbs [stylesheet]/[script]-tagged passages into these
   * Story-level fields (they never appear in story.passages), so we
   * track their origin file separately to round-trip edits back to disk.
   */
  private styleFile: string | undefined;
  private scriptFile: string | undefined;
  /** Source file containing :: StoryData / :: StoryTitle metadata. */
  private metadataFile: string | undefined;
  /** Absolute .twee path → mtime (ms) from the last loadProject(). */
  private sourceSnapshot = new Map<string, number>();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.srcDir = path.join(projectRoot, 'src');
  }

  /** Scan src/ and build the merged in-memory story (async wrapper). */
  async init(): Promise<void> {
    this.loadProject();
  }

  /** Synchronously scan src/ and build the merged in-memory story. */
  initSync(): void {
    this.loadProject();
  }

  /** Re-scan the project directory and rebuild in-memory state. */
  private loadProject(): void {
    if (!fs.existsSync(this.srcDir)) return;

    const tweeFiles = this.findTweeFiles();
    const master = new Story(path.basename(this.projectRoot));
    const fileMap = new Map<string, string>();
    const addedNames = new Set<string>();
    let styleFile: string | undefined;
    let scriptFile: string | undefined;
    let metadataFile: string | undefined;

    // Parse each .twee file and merge passages
    for (const filePath of tweeFiles) {
      let fileStory: Story;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        fileStory = parseTwee(content) as Story;
      } catch {
        continue;
      }

      // Use metadata from the first file that has an IFID
      if (!master.IFID && fileStory.IFID) {
        master.IFID = fileStory.IFID;
        master.format = fileStory.format;
        master.formatVersion = fileStory.formatVersion;
        master.start = fileStory.start;
        if (fileStory.name) master.name = fileStory.name;
        metadataFile = filePath;
      }

      // extwee absorbs [stylesheet]/[script]-tagged passages into
      // fileStory.storyStylesheet/storyJavaScript during parseTwee()
      // (they are never present in fileStory.passages). Carry that
      // content over to the merged story, or it is silently lost.
      if (fileStory.storyStylesheet) {
        master.storyStylesheet += fileStory.storyStylesheet;
        styleFile ??= filePath;
      }
      if (fileStory.storyJavaScript) {
        master.storyJavaScript += fileStory.storyJavaScript;
        scriptFile ??= filePath;
      }

      for (const p of fileStory.passages as Passage[]) {
        if (addedNames.has(p.name)) continue;
        addedNames.add(p.name);
        master.addPassage(p);
        fileMap.set(p.name, filePath);
      }
    }

    this.story = master;
    this.passageFileMap = fileMap;
    this.styleFile = styleFile;
    this.scriptFile = scriptFile;
    this.metadataFile = metadataFile;
    this.captureSourceSnapshot();
  }

  /** Record mtimes of all source .twee files after a full parse. */
  private captureSourceSnapshot(): void {
    const snap = new Map<string, number>();
    if (!fs.existsSync(this.srcDir)) {
      this.sourceSnapshot = snap;
      return;
    }
    for (const filePath of this.findTweeFiles()) {
      try {
        snap.set(filePath, fs.statSync(filePath).mtimeMs);
      } catch {
        // Unreadable file — leave it out; isStale() will notice.
      }
    }
    this.sourceSnapshot = snap;
  }

  /**
   * True when src/ .twee files changed on disk since the last load.
   * Cheap directory listing + mtime check only — no Twee parsing.
   */
  isStale(): boolean {
    if (!fs.existsSync(this.srcDir)) {
      return this.sourceSnapshot.size > 0;
    }
    const current = this.findTweeFiles();
    if (current.length !== this.sourceSnapshot.size) return true;
    for (const filePath of current) {
      const prev = this.sourceSnapshot.get(filePath);
      if (prev === undefined) return true;
      try {
        if (fs.statSync(filePath).mtimeMs !== prev) return true;
      } catch {
        return true;
      }
    }
    for (const filePath of this.sourceSnapshot.keys()) {
      if (!fs.existsSync(filePath)) return true;
    }
    return false;
  }

  /** Glob for *.twee and *.tw files under src/. */
  private findTweeFiles(): string[] {
    try {
      const all = fs.readdirSync(this.srcDir, { recursive: true }) as string[];
      return all
        .filter((f) => f.endsWith('.twee') || f.endsWith('.tw'))
        .map((f) => path.join(this.srcDir, f));
    } catch {
      return [];
    }
  }

  // ── IStoryStore implementation ──────────────────────────────────────────────

  listStories(): StoryMeta[] {
    return [toMeta(this.story, this.projectRoot)];
  }

  getStoryFull(name: string): StoryFull | null {
    if (!this.matchesStory(name)) return null;
    const meta = toMeta(this.story, this.projectRoot);
    const passages = (this.story.passages as Passage[]).map(toPassageFull);
    return {
      ...meta,
      passages,
      tagColors: (this.story.tagColors as Record<string, string>) ?? {},
      storyJavaScript: this.story.storyJavaScript ?? '',
      storyStylesheet: this.story.storyStylesheet ?? '',
    };
  }

  getStoryObject(name: string): Story | null {
    if (!this.matchesStory(name)) return null;
    return this.story;
  }

  /**
   * Persist a modified Story back to the source .twee files.
   * Each passage is written to its mapped file (or passages.twee for new ones).
   *
   * @param story - Modified Story object from a tool handler
   */
  saveStory(story: Story): void {
    const defaultFile = path.join(this.srcDir, 'passages.twee');
    const byFile = new Map<string, Passage[]>();
    const prevStyleFile = this.styleFile;
    const prevScriptFile = this.scriptFile;

    const addToFile = (file: string, p: Passage): void => {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push(p);
    };

    for (const p of story.passages as Passage[]) {
      const file = this.passageFileMap.get(p.name) ?? defaultFile;
      addToFile(file, p);
      if (!this.passageFileMap.has(p.name)) {
        this.passageFileMap.set(p.name, file);
      }
    }

    // story.storyStylesheet/storyJavaScript never live in story.passages
    // (extwee absorbs [stylesheet]/[script]-tagged passages on parse),
    // so round-trip them as tagged passages in their origin file here.
    if (story.storyStylesheet) {
      const file =
        this.styleFile ?? path.join(this.srcDir, 'Story Stylesheet.twee');
      this.styleFile = file;
      addToFile(
        file,
        new Passage('Story Stylesheet', story.storyStylesheet,
          ['stylesheet'], {}),
      );
    }
    if (story.storyJavaScript) {
      const file =
        this.scriptFile ?? path.join(this.srcDir, 'Story JavaScript.twee');
      this.scriptFile = file;
      addToFile(
        file,
        new Passage('Story JavaScript', story.storyJavaScript,
          ['script'], {}),
      );
    }

    const metadataFile =
      this.metadataFile ?? path.join(this.srcDir, 'StoryData.twee');
    const shouldWriteMetadata =
      Boolean(this.metadataFile) ||
      Boolean(story.IFID) ||
      Boolean(story.start);

    // Handle deleted passages/content: rebuild all previously-tracked files
    const allFiles = new Set([
      ...byFile.keys(),
      ...[...this.passageFileMap.values()],
      ...(prevStyleFile ? [prevStyleFile] : []),
      ...(prevScriptFile ? [prevScriptFile] : []),
      ...(shouldWriteMetadata ? [metadataFile] : []),
    ]);
    for (const filePath of allFiles) {
      if (shouldWriteMetadata && filePath === metadataFile) {
        continue;
      }
      const passages = byFile.get(filePath) ?? [];
      if (passages.length === 0) {
        // All passages were removed from this file — clear it
        if (fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, '', 'utf-8');
        }
        continue;
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, writeTweeContent(passages), 'utf-8');
    }

    if (shouldWriteMetadata) {
      const passages = byFile.get(metadataFile) ?? [];
      let content = buildMetadataTwee(story);
      if (passages.length > 0) {
        content += '\n' + writeTweeContent(passages);
      }
      fs.mkdirSync(path.dirname(metadataFile), { recursive: true });
      fs.writeFileSync(metadataFile, content, 'utf-8');
      this.metadataFile = metadataFile;
    }

    this.story = story;
    this.captureSourceSnapshot();
  }

  createStory(
    _name: string,
    _format?: string,
    _formatVersion?: string,
  ): StoryMeta {
    throw new Error(
      'Use create_project to create a new Twee project, ' +
      'or create_passage to add passages to the current project.',
    );
  }

  deleteStory(_name: string): boolean {
    throw new Error(
      'Project deletion is not supported via MCP. ' +
      'Remove the project directory manually.',
    );
  }

  // ── Project-specific methods ────────────────────────────────────────────────

  getPassageFile(name: string): string | undefined {
    return this.passageFileMap.get(name);
  }

  setPassageFile(name: string, filePath: string): void {
    this.passageFileMap.set(name, filePath);
  }

  getProjectRoot(name: string): string | null {
    return this.matchesStory(name) ? this.projectRoot : null;
  }

  /**
   * List all source .twee files with passage and word counts.
   *
   * @returns FileEntry array sorted by path
   */
  listFiles(): FileEntry[] {
    const byFile = new Map<string, PassageFull[]>();
    const full = this.getStoryFull(this.story.name ?? '');
    if (!full) return [];

    for (const p of full.passages) {
      const filePath = this.passageFileMap.get(p.name);
      if (!filePath) continue;
      if (!byFile.has(filePath)) byFile.set(filePath, []);
      byFile.get(filePath)!.push(p);
    }

    return [...byFile.entries()]
      .map(([filePath, passages]) => ({
        filePath,
        relativePath: path.relative(this.projectRoot, filePath),
        passageCount: passages.length,
        wordCount: passages.reduce((s, p) => s + p.wordCount, 0),
      }))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  /** Reload the project from disk (call after external file changes). */
  reload(): void {
    this.loadProject();
  }

  async close(): Promise<void> {
    // No file watcher to close in project mode
  }

  /** True if name matches the project story (or is empty/wildcard). */
  private matchesStory(name: string): boolean {
    if (!name) return true;
    const storyName = this.story.name || path.basename(this.projectRoot);
    return name === storyName;
  }
}
