/**
 * Format-aware patterns for scanning variable set/read operations,
 * and for locating the stylesheet passage by format.
 *
 * Each format entry contains:
 *   setPattern  - regex to find variable assignments
 *   readPattern - regex to find variable reads
 *   extractName - function to extract variable name from a match
 */

export interface FormatHints {
  /** Regex to find variable set/assignment statements. */
  setPattern: RegExp;
  /** Regex to find variable references/reads. */
  readPattern: RegExp;
  /** Extract canonical variable name from a regex match. */
  extractName: (match: RegExpMatchArray) => string;
}

/** Map of story format name (lowercase) → pattern hints. */
export const FORMAT_HINTS: Record<string, FormatHints> = {
  /** SugarCube 2: <<set $var to value>>, <<run $var>>, $var in text. */
  sugarcube: {
    setPattern: /<<set\s+(\$[\w.]+)\s+to\b/gi,
    readPattern: /\$[\w]+/g,
    extractName: (m) => m[1] ?? m[0],
  },
  /** Harlowe: (set: $var to value), (put: value into $var). */
  harlowe: {
    setPattern:
      /\(\s*(?:set|put|move)\s*:\s*(\$[\w]+)\s*(?:to|=)/gi,
    readPattern: /\$[\w]+/g,
    extractName: (m) => m[1] ?? m[0],
  },
  /** Chapbook: vars section lines "varName: value". */
  chapbook: {
    setPattern: /^([\w.]+)\s*:/gm,
    readPattern: /\{([\w.]+)\}/g,
    extractName: (m) => m[1] ?? m[0],
  },
};

/**
 * Returns hints for a story format, falling back to SugarCube patterns.
 *
 * @param formatName - Story format name (e.g. "Harlowe", "SugarCube")
 * @returns FormatHints for the format
 */
export function getFormatHints(formatName: string): FormatHints {
  const key = formatName.toLowerCase().replace(/\s+\d.*$/, '').trim();
  return FORMAT_HINTS[key] ?? FORMAT_HINTS['sugarcube'];
}

/**
 * Describes how a story format stores its stylesheet passage.
 * SugarCube uses a fixed name; all other formats use a tag.
 */
export interface StylesheetPassageInfo {
  /** Canonical passage name to create when no stylesheet exists. */
  name: string;
  /**
   * Tag the passage must carry, or null if lookup is by name only
   * (SugarCube's StoryStyle).
   */
  tag: string | null;
}

/** Per-format stylesheet passage conventions. */
const STYLESHEET_PASSAGE: Record<string, StylesheetPassageInfo> = {
  sugarcube: { name: 'StoryStyle', tag: null },
  harlowe: { name: 'Story Stylesheet', tag: 'stylesheet' },
  chapbook: { name: 'Story Stylesheet', tag: 'stylesheet' },
  snowman: { name: 'Story Stylesheet', tag: 'stylesheet' },
};

/**
 * Returns the stylesheet passage convention for a format, defaulting
 * to tag-based lookup for unknown formats.
 *
 * @param formatName - Story format name (e.g. "Harlowe", "SugarCube")
 * @returns StylesheetPassageInfo describing how to find/create the passage
 */
export function getStylesheetPassage(
  formatName: string,
): StylesheetPassageInfo {
  const key = formatName.toLowerCase().replace(/\s+\d.*$/, '').trim();
  return (
    STYLESHEET_PASSAGE[key] ?? { name: 'Story Stylesheet', tag: 'stylesheet' }
  );
}

/** Static syntax guides keyed by format name (lowercase). */
export const FORMAT_SYNTAX_GUIDES: Record<string, string> = {
  harlowe: `## Harlowe Syntax Reference
- Variables: $name (story-persistent), _name (temp)
- Set: (set: $var to value)
- If: (if: condition)[content](else:)[content]
- Links: [[target]] | [[display->target]] | [[target<-display]]
- Display: (display: "PassageName") | (print: value)
- Navigation: (go-to: "PassageName") | (link: "text")["PassageName"]
- Arrays: (a: 1, 2, 3) | (ds: ...) | (dm: ...)
- Loop: (for: each _item via $array)[...]
- Custom macro: (set: $fn to (macro: _arg)[(output: ...)])`,

  sugarcube: `## SugarCube 2 Syntax Reference
- Variables: $name (story), _name (temp)
- Set: <<set $var to value>> | <<set $var += 1>>
- If: <<if condition>>..<<elseif c>>..<<else>>>..<</if>>
- Links: [[target]] | [[display|target]] | [[display->target]]
- Display: <<include "PassageName">> | <<= $var>> | <<print $var>>
- Navigation: <<goto "PassageName">>
- Loops: <<for _i to 0; _i lt 10; _i++>>...<</for>>
- Widgets: <<widget "name">>...<</widget>>
- Script: <<script>>...<</ script>>`,

  chapbook: `## Chapbook Syntax Reference
- Vars section (top of passage, separated by --):
    health: 100
    name: "Hero"
    --
- Inserts: {variableName} | {back link} | {embed passage: "Name"}
- Modifiers: [if condition] | [unless condition] | [after 2s]
- Links: [[target]] | [[display->target]]
- JavaScript: [JavaScript]...code...[continued]
- Embed: {embed passage: "PassageName"}`,

  snowman: `## Snowman Syntax Reference
- Links: [[target]] | [[display->target]]
- JavaScript: <% code %> (executed) | <%= expr %> (output)
- Variables: stored on window.story.state object
- Helpers: story.passage(name), story.render(name)
- jQuery and Underscore.js available`,
};

/**
 * Returns the syntax guide string for a format.
 *
 * @param formatName - Story format name
 * @returns Syntax guide string or generic fallback
 */
export function getSyntaxGuide(formatName: string): string {
  const key = formatName.toLowerCase().replace(/\s+\d.*$/, '').trim();
  return (
    FORMAT_SYNTAX_GUIDES[key] ??
    `No detailed syntax guide available for "${formatName}". ` +
    `Supported formats: Harlowe, SugarCube, Chapbook, Snowman.`
  );
}
