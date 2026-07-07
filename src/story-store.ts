/**
 * In-memory story store backed by the Twine HTML library folder.
 *
 * Responsibilities:
 *   - Watch the library folder with chokidar
 *   - Parse story HTML on demand via extwee
 *   - Cache parsed story metadata (not full passage objects)
 *   - Provide CRUD helpers used by tool handlers
 */

import fs from 'fs';
import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  parseTwine2HTML,
  generateIFID,
  Story,
  Passage,
} from 'extwee';
import { parseLinks } from './util/parse-links.js';
import type {
  StoryMeta,
  StoryFull,
  PassageFull,
  StoreEntry,
  LinkGraph,
} from './types.js';

/** Count words in a string. */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Convert an extwee Story to StoryMeta. */
function toMeta(story: Story, filePath: string, mtime: Date): StoryMeta {
  const passages = story.passages as Passage[];
  const wordCount = passages.reduce(
    (sum, p) => sum + countWords((p as Passage).text),
    0,
  );
  return {
    name: story.name,
    ifid: story.IFID,
    format: story.format,
    formatVersion: story.formatVersion,
    startPassage: story.start,
    passageCount: passages.length,
    wordCount,
    filePath,
    lastModified: mtime.toISOString(),
  };
}

/** Convert an extwee Story to StoryFull (includes all passage text). */
export function toFull(story: Story, filePath: string, mtime: Date): StoryFull {
  const meta = toMeta(story, filePath, mtime);
  const passages: PassageFull[] = (story.passages as Passage[]).map((p) => {
    const text = p.text ?? '';
    const words = countWords(text);
    const links = parseLinks(text);
    return {
      name: p.name,
      tags: p.tags as string[],
      wordCount: words,
      position: (p.metadata as Record<string, string>)?.position,
      size: (p.metadata as Record<string, string>)?.size,
      preview: text.slice(0, 80),
      text,
      links,
    };
  });
  return {
    ...meta,
    passages,
    tagColors: story.tagColors as Record<string, string>,
    storyJavaScript: story.storyJavaScript ?? '',
    storyStylesheet: story.storyStylesheet ?? '',
  };
}

/** Build a link graph from a StoryFull. */
export function buildLinkGraph(story: StoryFull): LinkGraph {
  const graph: LinkGraph = {};
  const names = new Set(story.passages.map((p) => p.name));
  for (const p of story.passages) {
    graph[p.name] = p.links.filter((l) => names.has(l));
  }
  return graph;
}

/** Replace <tw-storydata> block in raw HTML with updated story data. */
function spliceTwStoryData(rawHtml: string, newBlock: string): string {
  return rawHtml.replace(
    /<tw-storydata[\s\S]*?<\/tw-storydata>/,
    newBlock,
  );
}

/** Minimal HTML wrapper for new stories created by the MCP server. */
function minimalHtml(story: Story): string {
  const storyData = story.toTwine2HTML();
  return (
    '<!DOCTYPE html>\n<html>\n' +
    '<head><meta charset="utf-8">' +
    `<title>${story.name}</title></head>\n` +
    `<body>\n${storyData}\n</body>\n</html>`
  );
}

export class StoryStore {
  /** Map from story name → cache entry. */
  private cache = new Map<string, StoreEntry>();
  private watcher: FSWatcher | null = null;
  readonly libraryPath: string;

  constructor(libraryPath: string) {
    this.libraryPath = libraryPath;
  }

  /** Load and cache all .html files from the library. */
  async init(): Promise<void> {
    const files = fs
      .readdirSync(this.libraryPath)
      .filter((f) => f.endsWith('.html'));
    for (const file of files) {
      this.loadFile(path.join(this.libraryPath, file));
    }
    this.startWatcher();
  }

  /** Parse and cache a single library file. */
  private loadFile(filePath: string): void {
    try {
      const rawHtml = fs.readFileSync(filePath, 'utf-8');
      const mtime = fs.statSync(filePath).mtime;
      const story = parseTwine2HTML(rawHtml) as Story;
      if (!story.name) return;
      const meta = toMeta(story, filePath, mtime);
      this.cache.set(story.name, { meta, rawHtml, lastModified: mtime });
    } catch {
      // Skip unparseable files silently
    }
  }

  /** Remove a story from cache by file path. */
  private evictByPath(filePath: string): void {
    for (const [name, entry] of this.cache.entries()) {
      if (entry.meta.filePath === filePath) {
        this.cache.delete(name);
        break;
      }
    }
  }

  private startWatcher(): void {
    this.watcher = chokidar.watch(`${this.libraryPath}/*.html`, {
      persistent: true,
      ignoreInitial: true,
    });
    this.watcher
      .on('add', (p) => this.loadFile(p))
      .on('change', (p) => {
        this.evictByPath(p);
        this.loadFile(p);
      })
      .on('unlink', (p) => this.evictByPath(p));
  }

  /** Return all story metadata entries. */
  listStories(): StoryMeta[] {
    return [...this.cache.values()].map((e) => e.meta);
  }

  /** Return the raw HTML and story for a given name, or null. */
  getRaw(name: string): { rawHtml: string; mtime: Date } | null {
    const entry = this.cache.get(name);
    if (!entry) return null;
    return { rawHtml: entry.rawHtml, mtime: entry.lastModified };
  }

  /** Return the full parsed StoryFull object for a given name. */
  getStoryFull(name: string): StoryFull | null {
    const entry = this.cache.get(name);
    if (!entry) return null;
    try {
      const story = parseTwine2HTML(entry.rawHtml) as Story;
      return toFull(story, entry.meta.filePath, entry.lastModified);
    } catch {
      return null;
    }
  }

  /** Return the extwee Story object for mutation. */
  getStoryObject(name: string): Story | null {
    const entry = this.cache.get(name);
    if (!entry) return null;
    try {
      return parseTwine2HTML(entry.rawHtml) as Story;
    } catch {
      return null;
    }
  }

  /**
   * Persist a modified Story back to the library file.
   * Splices new <tw-storydata> into the original HTML.
   */
  saveStory(story: Story): void {
    const entry = this.cache.get(story.name);
    const storyData = story.toTwine2HTML();

    let html: string;
    if (entry && /<tw-storydata/.test(entry.rawHtml)) {
      html = spliceTwStoryData(entry.rawHtml, storyData);
    } else {
      html = minimalHtml(story);
    }

    const filePath =
      entry?.meta.filePath ??
      path.join(this.libraryPath, `${story.name}.html`);

    fs.writeFileSync(filePath, html, 'utf-8');
    const mtime = fs.statSync(filePath).mtime;
    const meta = toMeta(story, filePath, mtime);
    this.cache.set(story.name, { meta, rawHtml: html, lastModified: mtime });
  }

  /**
   * Create a brand-new story file.
   *
   * @param name - Story name
   * @param format - Story format name
   * @param formatVersion - Story format version
   * @returns The saved StoryMeta
   */
  createStory(
    name: string,
    format = 'Harlowe',
    formatVersion = '3.3.9',
  ): StoryMeta {
    const story = new Story(name);
    story.IFID = generateIFID();
    story.format = format;
    story.formatVersion = formatVersion;
    story.start = 'Start';
    const startPassage = new Passage(
      'Start',
      'Your story begins here.',
      [],
      { position: '600,400', size: '100,100' },
    );
    story.addPassage(startPassage);
    this.saveStory(story);
    return this.cache.get(name)!.meta;
  }

  /**
   * Delete a story file. Returns false if not found.
   *
   * @param name - Story name to delete
   */
  deleteStory(name: string): boolean {
    const entry = this.cache.get(name);
    if (!entry) return false;
    try {
      fs.unlinkSync(entry.meta.filePath);
    } catch {
      // Already gone
    }
    this.cache.delete(name);
    return true;
  }

  /** Stop file watching. */
  async close(): Promise<void> {
    await this.watcher?.close();
  }
}
