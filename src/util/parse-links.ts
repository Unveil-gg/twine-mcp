/**
 * Parses Twine wiki-style passage links from passage text.
 * Ported from twinejs/src/util/parse-links.ts (MIT license).
 *
 * Supported formats:
 *   [[target]]
 *   [[display->target]]
 *   [[target<-display]]
 *   [[display|target]]
 *   [[target][setter]] (setter bracket ignored)
 */

/** Extract raw [[link]] tags from text. */
const extractLinkTags = (text: string): string[] =>
  text.match(/\[\[.*?\]\]/g) ?? [];

/** Keep only non-URL links (internal passage references). */
const isInternalLink = (link: string) =>
  !/^\w+:\/\/\/?\w/i.test(link);

/** Split by separator, return field at index (negative = from end). */
const getField = (
  s: string,
  sep: string,
  index: number,
): string | undefined => {
  const parts = s.split(sep);
  if (parts.length === 1) return undefined;
  return index < 0 ? parts[parts.length + index] : parts[index];
};

/** Strip outer [[ and ]]. */
const unwrap = (tag: string) => tag.slice(2, -2);

/** Remove setter [[ ]] block if present. */
const removeSetter = (s: string) => getField(s, '][', 0) ?? s;

/**
 * Resolve the link target from the inner tag content.
 * Priority: ->, <-, |, plain name.
 */
const resolveTarget = (content: string): string =>
  getField(content, '->', -1) ??
  getField(content, '<-', 0) ??
  getField(content, '|', -1) ??
  content;

/**
 * Returns unique internal links found in passage source text.
 *
 * @param text - Raw passage text
 * @param internalOnly - When true, skip http:// links
 * @returns Deduplicated array of linked passage names
 */
export function parseLinks(text: string, internalOnly = true): string[] {
  const targets = extractLinkTags(text)
    .map(unwrap)
    .map(removeSetter)
    .map(resolveTarget)
    .filter((t) => t.length > 0);

  const unique = [...new Set(targets)];
  return internalOnly ? unique.filter(isInternalLink) : unique;
}
