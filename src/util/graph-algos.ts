/**
 * Graph algorithms operating on passage link graphs.
 * All functions take an adjacency list: Record<name, name[]>.
 */

import type { LinkGraph } from '../types.js';

/**
 * BFS from a start node. Returns visited set in traversal order.
 *
 * @param graph - Adjacency list
 * @param start - Starting node name
 * @param maxNodes - Optional cap on visited count
 * @returns Ordered array of visited node names
 */
export function bfsVisited(
  graph: LinkGraph,
  start: string,
  maxNodes = Infinity,
): string[] {
  const visited: string[] = [];
  const seen = new Set<string>();
  const queue = [start];
  seen.add(start);

  while (queue.length > 0 && visited.length < maxNodes) {
    const node = queue.shift()!;
    visited.push(node);
    for (const neighbor of graph[node] ?? []) {
      if (!seen.has(neighbor) && graph[neighbor] !== undefined) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
}

/**
 * DFS from a start node returning passages in traversal order.
 * Respects max_depth and max_passages guards.
 *
 * @param graph - Adjacency list
 * @param start - Starting node name
 * @param maxDepth - Maximum traversal depth
 * @param maxPassages - Maximum passages to visit
 * @returns Array of {name, depth} in DFS order
 */
export function dfsOrdered(
  graph: LinkGraph,
  start: string,
  maxDepth = Infinity,
  maxPassages = Infinity,
): Array<{ name: string; depth: number }> {
  const result: Array<{ name: string; depth: number }> = [];
  const seen = new Set<string>();
  const stack: Array<{ name: string; depth: number }> = [
    { name: start, depth: 0 },
  ];

  while (stack.length > 0 && result.length < maxPassages) {
    const { name, depth } = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push({ name, depth });

    if (depth < maxDepth) {
      const children = [...(graph[name] ?? [])].reverse();
      for (const child of children) {
        if (!seen.has(child) && graph[child] !== undefined) {
          stack.push({ name: child, depth: depth + 1 });
        }
      }
    }
  }
  return result;
}

/**
 * Finds all passages reachable from the given start node.
 *
 * @param graph - Adjacency list
 * @param start - Starting node name
 * @returns Set of reachable passage names
 */
export function reachableFrom(
  graph: LinkGraph,
  start: string,
): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const neighbor of graph[node] ?? []) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  return visited;
}

/**
 * Shortest path between two nodes via BFS.
 *
 * @param graph - Adjacency list
 * @param from - Source node
 * @param to - Target node
 * @returns Ordered path of node names, or null if unreachable
 */
export function shortestPath(
  graph: LinkGraph,
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const queue = [from];
  prev.set(from, '');

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const neighbor of graph[node] ?? []) {
      if (prev.has(neighbor)) continue;
      prev.set(neighbor, node);
      if (neighbor === to) {
        const path: string[] = [];
        let cur: string = to;
        while (cur !== '') {
          path.unshift(cur);
          cur = prev.get(cur)!;
        }
        return path;
      }
      queue.push(neighbor);
    }
  }
  return null;
}

/**
 * Detects cycles using DFS with a recursion stack.
 * Returns arrays of node names forming each unique cycle found.
 *
 * @param graph - Adjacency list
 * @returns Array of cycle paths (each cycle is a node name array)
 */
export function findCycles(graph: LinkGraph): string[][] {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const stackPath: string[] = [];
  const cycles: string[][] = [];

  function dfs(node: string): void {
    if (stack.has(node)) {
      const cycleStart = stackPath.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push(stackPath.slice(cycleStart));
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    stackPath.push(node);

    for (const neighbor of graph[node] ?? []) {
      if (graph[neighbor] !== undefined) dfs(neighbor);
    }

    stack.delete(node);
    stackPath.pop();
  }

  for (const node of Object.keys(graph)) {
    dfs(node);
  }
  return cycles;
}

/**
 * Computes all upstream paths (reverse BFS) to a given target node.
 * Builds reverse graph then BFS. Returns at most maxPaths paths.
 *
 * @param graph - Forward adjacency list
 * @param target - Node to find upstream paths for
 * @param maxPaths - Max paths to return
 * @returns Array of path arrays, each ending at target
 */
export function upstreamPaths(
  graph: LinkGraph,
  target: string,
  maxPaths = 5,
): string[][] {
  const reverse: LinkGraph = {};
  for (const [node, neighbors] of Object.entries(graph)) {
    for (const neighbor of neighbors) {
      if (!reverse[neighbor]) reverse[neighbor] = [];
      reverse[neighbor].push(node);
    }
  }

  const results: string[][] = [];
  const queue: string[][] = [[target]];

  while (queue.length > 0 && results.length < maxPaths) {
    const path = queue.shift()!;
    const head = path[0];
    const parents = reverse[head] ?? [];
    if (parents.length === 0) {
      results.push(path);
      continue;
    }
    for (const parent of parents) {
      if (!path.includes(parent)) {
        queue.push([parent, ...path]);
      }
    }
  }
  return results;
}
