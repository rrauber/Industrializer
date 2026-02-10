import { simulateTick, findPath, getExportPath } from './economy';
import { getEdgeKey, hexKey } from './hexUtils';
import type { FlowPair } from './types';

function computeSegCosts(
  path: { q: number; r: number }[],
  infraEdges: Record<string, any>,
): number[] {
  const segCosts: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const ek = getEdgeKey(path[i].q, path[i].r, path[i + 1].q, path[i + 1].r);
    const edge = infraEdges[ek];
    let cost = 0.8; // no infra (hub zone / adjacency) — slow
    if (edge) {
      if (edge.transport === 'rail') cost = 0.12;
      else if (edge.transport === 'canal') cost = 0.2;
      else if (edge.transport === 'road') cost = 0.45;
    }
    segCosts.push(cost);
  }
  return segCosts;
}

self.onmessage = (e: MessageEvent) => {
  try {
    const { grid, terrainGrid, terrainAssociations, infraEdges, infraConstructionSites } = e.data;

    const result = simulateTick(grid, terrainGrid, terrainAssociations, infraEdges, infraConstructionSites);

    // Weighted random sample of flow pairs (sqrt-weighted by amount)
    const MAX_ROUTES = 300;
    const allPairs = result.flowPairs;
    const routeData: { fp: FlowPair; path: { q: number; r: number }[]; segCosts: number[] }[] = [];
    let sampled: FlowPair[];
    if (allPairs.length <= MAX_ROUTES) {
      sampled = allPairs;
    } else {
      const weights = allPairs.map(fp => Math.sqrt(fp.amount));
      const totalWeight = weights.reduce((s, w) => s + w, 0);
      const picked = new Set<number>();
      sampled = [];
      while (sampled.length < MAX_ROUTES && picked.size < allPairs.length) {
        let r = Math.random() * totalWeight;
        for (let i = 0; i < allPairs.length; i++) {
          if (picked.has(i)) continue;
          r -= weights[i];
          if (r <= 0) {
            picked.add(i);
            sampled.push(allPairs[i]);
            break;
          }
        }
      }
    }
    for (const fp of sampled) {
      const path = findPath(fp.sourceKey, fp.destKey, result.grid, result.infraEdges);
      if (path && path.length >= 2) {
        routeData.push({ fp, path, segCosts: computeSegCosts(path, result.infraEdges) });
      }
    }

    // Add export paths: from export buildings to map edge
    try {
      for (const [key, hex] of Object.entries(result.grid)) {
        if (!hex.buildingId || hex.constructionSite) continue;
        const fs = hex.flowState;
        if (!fs || !fs.exports) continue;
        const exportEntries = Object.entries(fs.exports);
        if (exportEntries.length === 0) continue;
        const totalExported = exportEntries.reduce((s, [, v]) => s + v, 0);
        if (totalExported < 0.01) continue;
        const exportPath = getExportPath(key, result.grid, result.infraEdges, terrainAssociations);
        if (exportPath && exportPath.length >= 2) {
          const destKey = hexKey(exportPath[exportPath.length - 1].q, exportPath[exportPath.length - 1].r);
          const segCosts = computeSegCosts(exportPath, result.infraEdges);
          const pathCost = exportPath.length * 0.5;
          for (const [res, amt] of exportEntries) {
            if (amt < 0.01) continue;
            routeData.push({
              fp: { sourceKey: key, destKey, resource: res, amount: amt, pathCost },
              path: exportPath,
              segCosts,
            });
          }
        }
      }
    } catch (exportErr) {
      console.warn('Export path computation failed:', exportErr);
    }

    self.postMessage({
      grid: result.grid,
      flowSummary: result.flowSummary,
      exportRate: result.exportRate,
      infraEdges: result.infraEdges,
      infraConstructionSites: result.infraConstructionSites,
      routeData,
    });
  } catch (err) {
    console.error('Worker tick failed:', err);
    // Post back minimal result so the game doesn't freeze
    self.postMessage({
      grid: e.data.grid,
      flowSummary: { potential: {}, potentialDemand: {}, realized: {}, consumed: {}, exportConsumed: {}, lostToDistance: {}, lostToShortage: {} },
      exportRate: {},
      infraEdges: e.data.infraEdges,
      infraConstructionSites: e.data.infraConstructionSites,
      routeData: [],
    });
  }
};
