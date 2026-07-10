/** Shared TypeScript types for twine-mcp. */

import type { Story } from 'extwee';

/** Lightweight passage representation for list/compact responses. */
export interface PassageMeta {
  name: string;
  tags: string[];
  wordCount: number;
  position?: string;
  size?: string;
  /** First 80 characters of passage text for orientation. */
  preview?: string;
}

/** Full passage representation including raw source text. */
export interface PassageFull extends PassageMeta {
  text: string;
  links: string[];
}

/** Story metadata (no passages). */
export interface StoryMeta {
  name: string;
  ifid: string;
  format: string;
  formatVersion: string;
  startPassage: string;
  passageCount: number;
  wordCount: number;
  filePath: string;
  lastModified: string;
}

/** Full story including passages. */
export interface StoryFull extends StoryMeta {
  passages: PassageFull[];
  tagColors: Record<string, string>;
  storyJavaScript: string;
  storyStylesheet: string;
}

/** Adjacency list graph: passage name → array of linked passage names. */
export type LinkGraph = Record<string, string[]>;

/** A broken link record. */
export interface BrokenLink {
  from: string;
  target: string;
}

/** Analysis report for a story. */
export interface AnalysisReport {
  storyName: string;
  passageCount: number;
  wordCount: number;
  avgWordsPerPassage: number;
  branchPoints: number;
  branchingFactor: number;
  brokenLinks: BrokenLink[];
  deadEnds: string[];
  orphans: string[];
  unreachable: string[];
  cycles: string[][];
  tagUsage: Record<string, number>;
  estimatedReadingMinutes: number;
}

/** Variable usage record (format-aware). */
export interface VarUsage {
  variable: string;
  setIn: string[];
  readIn: string[];
}

/** A node in the narrative flow traversal. */
export interface FlowNode {
  name: string;
  depth: number;
  text: string;
  links: string[];
  tags: string[];
}

/** Ending passage with one upstream path. */
export interface EndingNode {
  name: string;
  text: string;
  tags: string[];
  path: string[];
}

/**
 * Common store interface implemented by WorkspaceStore (and ProjectStore
 * internally). All MCP tool handlers accept IStoryStore.
 */
export interface IStoryStore {
  listStories(): StoryMeta[];
  getStoryFull(name: string): StoryFull | null;
  getStoryObject(name: string): Story | null;
  saveStory(story: Story): void;
  createStory(
    name: string,
    format?: string,
    formatVersion?: string,
  ): StoryMeta;
  deleteStory(name: string): boolean;
  /** Source .twee file for a passage (passage name → absolute path). */
  getPassageFile?(name: string): string | undefined;
  /** Update the passage-to-file mapping. */
  setPassageFile?(name: string, filePath: string): void;
  /** List source files with passage stats. */
  listFiles?(): FileEntry[];
  close?(): Promise<void>;
}

/** Source file entry returned by list_files in project mode. */
export interface FileEntry {
  filePath: string;
  relativePath: string;
  passageCount: number;
  wordCount: number;
}

/** A single validation result item from validate_story. */
export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
  passage?: string;
}

/** Branch point with sub-branch summary. */
export interface BranchPoint {
  name: string;
  depth: number;
  choices: Array<{
    target: string;
    reachableCount: number;
  }>;
}
