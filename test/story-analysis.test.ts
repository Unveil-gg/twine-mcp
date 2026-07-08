import { describe, expect, it } from 'vitest';
import { findCycles, reachableFrom, shortestPath } from
  '../src/util/graph-algos.js';
import { parseLinks } from '../src/util/parse-links.js';
import type { LinkGraph } from '../src/types.js';

/** Build an adjacency list from passage name → raw passage text. */
function buildGraph(
  passages: Record<string, string>,
): LinkGraph {
  return Object.fromEntries(
    Object.entries(passages).map(([name, text]) => [
      name,
      parseLinks(text),
    ]),
  );
}

/** Passage names linked from `from` that do not exist in the graph. */
function findBrokenLinks(
  graph: LinkGraph,
  from: string,
): string[] {
  const known = new Set(Object.keys(graph));
  return (graph[from] ?? []).filter((target) => !known.has(target));
}

describe('story analysis from passage text', () => {
  const passages = {
    Start: [
      'The door creaks open.',
      '[[Enter the hall->Hall]]',
      '[[Skip to ending->Ending]]',
    ].join('\n'),
    Hall: [
      'A fork in the corridor.',
      '[[Go to kitchen->Kitchen]]',
      '[[Wander outside->Garden]]',
      '[[Check the trapdoor->Basement]]',
    ].join('\n'),
    Kitchen: 'Smells like soup. [[Return to hall->Hall]]',
    Garden: 'Birds sing. [[Reach the gate->Ending]]',
    Basement: 'Too dark to continue.',
    Ending: 'The end.',
  };

  const graph = buildGraph(passages);

  it('parses Twine links into a passage graph', () => {
    expect(graph).toEqual({
      Start: ['Hall', 'Ending'],
      Hall: ['Kitchen', 'Garden', 'Basement'],
      Kitchen: ['Hall'],
      Garden: ['Ending'],
      Basement: [],
      Ending: [],
    });
  });

  it('finds the shortest path between two passages', () => {
    expect(shortestPath(graph, 'Start', 'Ending')).toEqual([
      'Start',
      'Ending',
    ]);
    expect(shortestPath(graph, 'Start', 'Basement')).toEqual([
      'Start',
      'Hall',
      'Basement',
    ]);
    expect(shortestPath(graph, 'Basement', 'Garden')).toBeNull();
  });

  it('lists passages reachable from the start', () => {
    const reachable = reachableFrom(graph, 'Start');
    expect([...reachable].sort()).toEqual([
      'Basement',
      'Ending',
      'Garden',
      'Hall',
      'Kitchen',
      'Start',
    ]);
  });

  it('detects cycles caused by return links', () => {
    const cycles = findCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles.some((cycle) =>
      cycle.includes('Hall') && cycle.includes('Kitchen'),
    )).toBe(true);
  });

  it('flags links to passages that do not exist', () => {
    const brokenGraph = buildGraph({
      Start: '[[Nowhere->Missing Passage]]',
    });
    expect(findBrokenLinks(brokenGraph, 'Start')).toEqual([
      'Missing Passage',
    ]);
  });
});
