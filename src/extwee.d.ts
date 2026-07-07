/**
 * Type declaration shim for extwee.
 * extwee ships types at types/index.d.ts but doesn't expose them
 * in its package.json exports field, so NodeNext resolution fails.
 * This shim re-exports the real types.
 */

declare module 'extwee' {
  /** Parse Twee 3 source text into a Story object. */
  export function parseTwee(source: string): Story;

  /** Parse a Twine 2 published/library HTML string into a Story object. */
  export function parseTwine2HTML(source: string): Story;

  /** Parse a JSON string into a Story object. */
  export function parseJSON(source: string): Story;

  /** Compile a Story + StoryFormat into a playable HTML string. */
  export function compileTwine2HTML(story: Story, format: StoryFormat): string;

  /** Generate a new v4 UUID IFID (uppercase). */
  export function generateIFID(): string;

  export class Story {
    name: string;
    IFID: string;
    start: string;
    format: string;
    formatVersion: string;
    zoom: number;
    creator: string;
    creatorVersion: string;
    metadata: Record<string, unknown>;
    tagColors: Record<string, string>;
    storyJavaScript: string;
    storyStylesheet: string;
    passages: Passage[];

    constructor(name?: string);

    addPassage(passage: Passage): number;
    removePassageByName(name: string): number;
    getPassageByName(name: string): Passage | undefined;
    getPassagesByTag(tag: string): Passage[];
    size(): number;

    toTwee(): string;
    toJSON(): string;
    toTwine2HTML(): string;
    toTwine1HTML(): string;
  }

  export class Passage {
    name: string;
    tags: string[];
    metadata: Record<string, unknown>;
    text: string;

    constructor(
      name?: string,
      text?: string,
      tags?: string[],
      metadata?: Record<string, unknown>,
    );

    toTwee(): string;
    toJSON(): string;
    toTwine2HTML(): string;
  }

  export class StoryFormat {
    name: string;
    version: string;
    source: string;
    proofing: boolean;
    author: string;
    description: string;
    url: string;
  }
}
