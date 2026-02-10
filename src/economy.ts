import { HexData, TerrainHex, TerrainType, ResourceMap, FlowSummary, InputDiagnostic, InfrastructureEdge, InfraEdgeConstructionSite, FlowPair } from './types';
import { BUILDINGS, ZONE_TYPES, ZONE_OUTPUT_BONUS, ZONE_INPUT_REDUCTION, INFRA_STEP_COSTS, HUB_RADIUS, MARKET_CONFIG } from './constants';
import { hexKey, getEdgeKey, getNeighbors, getHexesInRadius, countHexConnections, setEdgeType, HEX_DIRECTIONS } from './hexUtils';

type GetTerrainsFn = (q: number, r: number) => TerrainType[];
type TerrainAssociations = Record<string, TerrainType[]>;

// Precomputed distance map: source hex key -> (dest hex key -> path cost)
type DistanceMap = Map<string, Map<string, number>>;

// Binary min-heap for Dijkstra
interface HeapNode { key: string; q: number; r: number; cost: number }
class MinHeap {
  private data: HeapNode[] = [];
  get length() { return this.data.length; }
  push(node: HeapNode) {
    this.data.push(node);
    this._bubbleUp(this.data.length - 1);
  }
  pop(): HeapNode {
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) { this.data[0] = last; this._sinkDown(0); }
    return top;
  }
  private _bubbleUp(i: number) {
    const d = this.data;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p].cost <= d[i].cost) break;
      [d[p], d[i]] = [d[i], d[p]];
      i = p;
    }
  }
  private _sinkDown(i: number) {
    const d = this.data, n = d.length;
    while (true) {
      let min = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && d[l].cost < d[min].cost) min = l;
      if (r < n && d[r].cost < d[min].cost) min = r;
      if (min === i) break;
      [d[min], d[i]] = [d[i], d[min]];
      i = min;
    }
  }
}

function precomputeDistances(
  sourceKeys: string[],
  grid: Record<string, HexData>,
  infraEdges: Record<string, InfrastructureEdge>,
  maxCost: number = 10,
  waterPortKeys?: Set<string>,
  stepCostOverrides?: Partial<Record<string, number>>,
  hubZones?: { hubKey: string; hexKeys: Set<string> }[],
  category: 'transport' | 'power' = 'transport'
): DistanceMap {
  // Precompute hex-to-hub-zone lookup for free transit (spoke → hub)
  const hexToHubZones = new Map<string, { hubKey: string; hexKeys: Set<string> }[]>();
  // Precompute hub-center-to-zones lookup for free transit (hub → spokes)
  const hubCenterZones = new Map<string, { hubKey: string; hexKeys: Set<string> }[]>();
  if (hubZones) {
    for (const zone of hubZones) {
      for (const hk of zone.hexKeys) {
        if (!hexToHubZones.has(hk)) hexToHubZones.set(hk, []);
        hexToHubZones.get(hk)!.push(zone);
      }
      if (!hubCenterZones.has(zone.hubKey)) hubCenterZones.set(zone.hubKey, []);
      hubCenterZones.get(zone.hubKey)!.push(zone);
    }
  }
  const result: DistanceMap = new Map();
  for (const startKey of sourceKeys) {
    const startHex = grid[startKey];
    if (!startHex) continue;
    const distances = new Map<string, number>();
    distances.set(startKey, 0);
    const queue = new MinHeap();
    queue.push({ key: startKey, q: startHex.q, r: startHex.r, cost: 0 });
    while (queue.length > 0) {
      const current = queue.pop();
      if (current.cost > (distances.get(current.key) ?? Infinity)) continue;
      // Normal hex neighbors (inlined to avoid allocation)
      for (const d of HEX_DIRECTIONS) {
        const nq = current.q + d.dq, nr = current.r + d.dr;
        const nKey = hexKey(nq, nr);
        if (!grid[nKey]) continue;
        const ek = getEdgeKey(current.q, current.r, nq, nr);
        const edge = infraEdges[ek];
        const edgeType = edge ? (category === 'power' ? edge.power : edge.transport) : undefined;
        const stepCost = edgeType
          ? (stepCostOverrides?.[edgeType] ?? INFRA_STEP_COSTS[edgeType])
          : 1.0;
        const newCost = current.cost + stepCost;
        if (newCost <= maxCost && newCost < (distances.get(nKey) ?? Infinity)) {
          distances.set(nKey, newCost);
          queue.push({ key: nKey, q: nq, r: nr, cost: newCost });
        }
      }
      // Free port-to-port transit: water ports can reach all other water ports at 0 cost
      if (waterPortKeys && waterPortKeys.has(current.key)) {
        for (const portKey of waterPortKeys) {
          if (portKey === current.key) continue;
          const portHex = grid[portKey];
          if (!portHex) continue;
          if (current.cost < (distances.get(portKey) ?? Infinity)) {
            distances.set(portKey, current.cost);
            queue.push({ key: portKey, q: portHex.q, r: portHex.r, cost: current.cost });
          }
        }
      }
      // Hub zone star topology: spoke → hub (small cost per hop)
      const hubsForHex = hexToHubZones.get(current.key);
      if (hubsForHex) {
        for (const zone of hubsForHex) {
          const hubHex = grid[zone.hubKey];
          if (!hubHex || zone.hubKey === current.key) continue;
          const hopCost = current.cost + HUB_HOP_COST;
          if (hopCost <= maxCost && hopCost < (distances.get(zone.hubKey) ?? Infinity)) {
            distances.set(zone.hubKey, hopCost);
            queue.push({ key: zone.hubKey, q: hubHex.q, r: hubHex.r, cost: hopCost });
          }
        }
      }
      // Hub zone star topology: hub → spokes (small cost per hop)
      const centerZones = hubCenterZones.get(current.key);
      if (centerZones) {
        for (const zone of centerZones) {
          for (const destKey of zone.hexKeys) {
            if (destKey === current.key) continue;
            const destHex = grid[destKey];
            if (!destHex) continue;
            const hopCost = current.cost + HUB_HOP_COST;
            if (hopCost <= maxCost && hopCost < (distances.get(destKey) ?? Infinity)) {
              distances.set(destKey, hopCost);
              queue.push({ key: destKey, q: destHex.q, r: destHex.r, cost: hopCost });
            }
          }
        }
      }
    }
    result.set(startKey, distances);
  }
  return result;
}

interface ProducerState {
  hex: HexData;
  key: string;
  buildingId: string;
  potential: Record<string, number>; 
  realized: Record<string, number>;
  remaining: Record<string, number>;
  clusterBonus: number;
  clusterSize: number;
  zoneOutputBonus: number;
  zoneInputReduction: number;
  superclusterSize: number;
}

interface ConsumerState {
  hex: HexData;
  key: string;
  buildingId: string;
  prioritized: boolean;
  demand: Record<string, number>;
  received: Record<string, number>;
  distanceLoss: Record<string, number>;
}

interface AllocPair {
  producer: ProducerState;
  consumer: ConsumerState;
  pathCost: number;
  transferEff: number;
}

function emptyFlowSummary(): FlowSummary {
  return { potential: {}, potentialDemand: {}, realized: {}, consumed: {}, exportConsumed: {}, lostToDistance: {}, lostToShortage: {} };
}

function addToMap(map: ResourceMap, key: string, amount: number) {
  map[key] = (map[key] || 0) + amount;
}

const CONVERGENCE_ITERATIONS = 3;
const BASE_POPULATION = 0.1;
const CONSTRUCTION_RESERVE = 0.1; // reserve 10% of production for construction sites
const MIN_PRODUCTION_FLOOR = 0.1; // buildings always produce at least 10% to prevent deadlocks
const HUB_HOP_COST = 0.05; // small cost per hop within hub zones

function computeClusters(grid: Record<string, HexData>): Map<string, { size: number; bonus: number }> {
  const result = new Map<string, { size: number; bonus: number }>();
  const HUB_BUILDINGS = new Set(Object.keys(HUB_RADIUS));

  // Collect all non-hub building types present on the map
  const buildingTypes = new Set<string>();
  for (const [, hex] of Object.entries(grid)) {
    if (hex.buildingId && !HUB_BUILDINGS.has(hex.buildingId)) {
      buildingTypes.add(hex.buildingId);
    }
  }

  // Build upgrade compatibility: for each type, collect all higher-tier upgrades
  // n+1 tier counts as bonus-providing to n tier, but not the reverse
  const upgradeCompatible = new Map<string, Set<string>>();
  for (const buildingType of buildingTypes) {
    const compatible = new Set<string>();
    let current = buildingType;
    while (BUILDINGS[current]?.upgradesTo) {
      const next = BUILDINGS[current].upgradesTo!;
      compatible.add(next);
      current = next;
    }
    upgradeCompatible.set(buildingType, compatible);
  }

  // For each building type, compute clusters including hub buildings as wildcards
  for (const buildingType of buildingTypes) {
    const compatible = upgradeCompatible.get(buildingType)!;
    const visited = new Set<string>();
    const clusters: string[][] = [];

    for (const [key, hex] of Object.entries(grid)) {
      if (visited.has(key) || hex.buildingId !== buildingType) continue;
      const cluster: string[] = [];
      const queue = [key];
      visited.add(key);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        cluster.push(cur);
        const curHex = grid[cur];
        for (const n of getNeighbors(curHex.q, curHex.r)) {
          const nk = hexKey(n.q, n.r);
          if (visited.has(nk)) continue;
          const nHex = grid[nk];
          if (!nHex?.buildingId) continue;
          if (nHex.buildingId === buildingType || HUB_BUILDINGS.has(nHex.buildingId) || compatible.has(nHex.buildingId)) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }
      clusters.push(cluster);
    }

    for (const cluster of clusters) {
      const clusterSize = cluster.length;
      if (clusterSize <= 1) {
        const prev = result.get(cluster[0]);
        if (!prev || prev.size < clusterSize) result.set(cluster[0], { size: 1, bonus: 0 });
        continue;
      }
      const clusterSet = new Set(cluster);
      for (const buildingKey of cluster) {
        const distances = new Map<string, number>();
        distances.set(buildingKey, 0);
        const bfsQueue = [buildingKey];
        let score = 0;
        while (bfsQueue.length > 0) {
          const cur = bfsQueue.shift()!;
          const curDist = distances.get(cur)!;
          const curHex = grid[cur];
          for (const n of getNeighbors(curHex.q, curHex.r)) {
            const nk = hexKey(n.q, n.r);
            if (distances.has(nk) || !clusterSet.has(nk)) continue;
            const nDist = curDist + 1;
            distances.set(nk, nDist);
            score += Math.pow(0.5, nDist - 1);
            bfsQueue.push(nk);
          }
        }
        const bonus = score >= 5 ? 1.0 : score >= 3 ? 0.5 : score >= 2 ? 0.25 : score >= 1 ? 0.1 : 0;
        // n+1 buildings contribute to the cluster but don't receive the bonus
        const bHex = grid[buildingKey];
        if (bHex?.buildingId && compatible.has(bHex.buildingId)) continue;
        // Hub buildings can be in multiple clusters; keep the best bonus
        const prev = result.get(buildingKey);
        if (!prev || bonus > prev.bonus) {
          result.set(buildingKey, { size: clusterSize, bonus });
        }
      }
    }
  }

  // Ensure all buildings (including standalone hubs) have entries
  for (const [key, hex] of Object.entries(grid)) {
    if (hex.buildingId && !result.has(key)) {
      result.set(key, { size: 1, bonus: 0 });
    }
  }
  return result;
}

function computeSuperclusters(grid: Record<string, HexData>): Map<string, { bonus: number; uniCount: number; size: number }> {
  const result = new Map<string, { bonus: number; uniCount: number; size: number }>();
  const HUB_BUILDINGS = new Set(Object.keys(HUB_RADIUS));

  // Build reverse lookup: buildingId → zone type
  const buildingToZone = new Map<string, string>();
  for (const [zt, info] of Object.entries(ZONE_TYPES)) {
    for (const bid of info.buildings) buildingToZone.set(bid, zt);
  }

  // For each zone type, BFS connected components
  const zoneTypes = Object.keys(ZONE_TYPES);
  for (const zt of zoneTypes) {
    const visited = new Set<string>();

    for (const [key, hex] of Object.entries(grid)) {
      if (visited.has(key) || !hex.buildingId || hex.constructionSite || hex.paused) continue;
      // Must belong to this zone type, or be a wildcard (university/hub)
      const isWildcard = hex.buildingId === 'university' || HUB_BUILDINGS.has(hex.buildingId);
      if (!isWildcard && buildingToZone.get(hex.buildingId) !== zt) continue;

      const cluster: string[] = [];
      const queue = [key];
      visited.add(key);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        cluster.push(cur);
        const curHex = grid[cur];
        for (const n of getNeighbors(curHex.q, curHex.r)) {
          const nk = hexKey(n.q, n.r);
          if (visited.has(nk)) continue;
          const nHex = grid[nk];
          if (!nHex?.buildingId || nHex.constructionSite || nHex.paused) continue;
          const nIsWildcard = nHex.buildingId === 'university' || HUB_BUILDINGS.has(nHex.buildingId);
          if (!nIsWildcard && buildingToZone.get(nHex.buildingId) !== zt) continue;
          visited.add(nk);
          queue.push(nk);
        }
      }

      // Count non-wildcard buildings and distinct types
      const typesInCluster = new Set<string>();
      let nonWildcardCount = 0;
      for (const k of cluster) {
        const h = grid[k];
        const isWC = h.buildingId === 'university' || HUB_BUILDINGS.has(h.buildingId!);
        if (!isWC) {
          nonWildcardCount++;
          typesInCluster.add(h.buildingId!);
        }
      }

      // Count universities
      let uniCount = 0;
      for (const k of cluster) {
        if (grid[k].buildingId === 'university') uniCount++;
      }

      // Bonus requires ≥21 non-wildcard of ≥2 types; scales linearly to 42
      const qualifies = nonWildcardCount >= 21 && typesInCluster.size >= 2;
      const bonus = qualifies ? Math.min(1.0, (nonWildcardCount - 21) / (42 - 21)) : 0;

      // Record size for all buildings (even sub-threshold) for UI progress
      for (const buildingKey of cluster) {
        const prev = result.get(buildingKey);
        if (!prev || nonWildcardCount > prev.size) {
          result.set(buildingKey, { bonus: prev ? Math.max(prev.bonus, bonus) : bonus, uniCount, size: nonWildcardCount });
        }
      }
    }
  }

  return result;
}

const INFRA_EXPORT_EFFICIENCY: Record<string, number> = {
  road: 0.5,
  rail: 0.7,
  canal: 1.0,
};

const ALL_EXPORTABLE_RESOURCES: string[] = [
  'food', 'wood', 'stone', 'iron_ore', 'coal',
  'iron_ingot', 'tools', 'concrete', 'steel', 'machinery', 'goods', 'electricity',
];

function getExportEfficiency(startKey: string, grid: Record<string, HexData>, infraEdges: Record<string, InfrastructureEdge>, getTerrains: GetTerrainsFn): number {
  const startHex = grid[startKey];
  if (!startHex) return 0;
  const terrainCache = new Map<string, TerrainType[]>();
  function getCachedTerrains(q: number, r: number): TerrainType[] {
    const k = hexKey(q, r);
    const cached = terrainCache.get(k);
    if (cached) return cached;
    const t = getTerrains(q, r);
    terrainCache.set(k, t);
    return t;
  }
  function isAtMapEdge(q: number, r: number): boolean {
    for (const n of getNeighbors(q, r)) {
      const nk = hexKey(n.q, n.r);
      if (!grid[nk]) return true;
      if (getCachedTerrains(n.q, n.r).length === 0) return true;
    }
    return false;
  }
  function getStepEfficiency(fromQ: number, fromR: number, toQ: number, toR: number): number | null {
    const ek = getEdgeKey(fromQ, fromR, toQ, toR);
    const edge = infraEdges[ek];
    let best: number | null = null;
    if (edge?.transport) best = INFRA_EXPORT_EFFICIENCY[edge.transport];
    const destTerrains = getCachedTerrains(toQ, toR);
    if (destTerrains.includes('water')) best = Math.max(best ?? 0, 1.0);
    return best;
  }
  if (isAtMapEdge(startHex.q, startHex.r)) return 1.0;
  const bestSeen = new Map<string, number>();
  const queue: [string, number][] = [];
  for (const n of getNeighbors(startHex.q, startHex.r)) {
    const nk = hexKey(n.q, n.r);
    if (!grid[nk]) continue;
    const eff = getStepEfficiency(startHex.q, startHex.r, n.q, n.r);
    if (eff === null) continue;
    bestSeen.set(nk, eff);
    queue.push([nk, eff]);
  }
  let bestEfficiency = 0;
  while (queue.length > 0) {
    const [cur, minEff] = queue.shift()!;
    const curHex = grid[cur];
    if (!curHex) continue;
    if (isAtMapEdge(curHex.q, curHex.r)) {
      bestEfficiency = Math.max(bestEfficiency, minEff);
      continue;
    }
    for (const n of getNeighbors(curHex.q, curHex.r)) {
      const nk = hexKey(n.q, n.r);
      if (!grid[nk]) continue;
      const stepEff = getStepEfficiency(curHex.q, curHex.r, n.q, n.r);
      if (stepEff === null) continue;
      const pathEff = Math.min(minEff, stepEff);
      const prev = bestSeen.get(nk) ?? 0;
      if (pathEff > prev) {
        bestSeen.set(nk, pathEff);
        queue.push([nk, pathEff]);
      }
    }
  }
  return bestEfficiency;
}

/** Find the best export path from an export building to the map edge. Returns hex path or null. */
export function getExportPath(
  startKey: string,
  grid: Record<string, HexData>,
  infraEdges: Record<string, InfrastructureEdge>,
  getTerrains: GetTerrainsFn | TerrainAssociations,
): { q: number; r: number }[] | null {
  const startHex = grid[startKey];
  if (!startHex) return null;
  const getTerrainsFn: GetTerrainsFn = typeof getTerrains === 'function'
    ? getTerrains
    : (q: number, r: number) => (getTerrains as TerrainAssociations)[hexKey(q, r)] || [];
  const terrainCache = new Map<string, TerrainType[]>();
  function getCachedTerrains(q: number, r: number): TerrainType[] {
    const k = hexKey(q, r);
    const cached = terrainCache.get(k);
    if (cached) return cached;
    const t = getTerrainsFn(q, r);
    terrainCache.set(k, t);
    return t;
  }
  function isAtMapEdge(q: number, r: number): boolean {
    for (const n of getNeighbors(q, r)) {
      const nk = hexKey(n.q, n.r);
      if (!grid[nk]) return true;
      if (getCachedTerrains(n.q, n.r).length === 0) return true;
    }
    return false;
  }
  function getStepEfficiency(fromQ: number, fromR: number, toQ: number, toR: number): number | null {
    const ek = getEdgeKey(fromQ, fromR, toQ, toR);
    const edge = infraEdges[ek];
    let best: number | null = null;
    if (edge?.transport) best = INFRA_EXPORT_EFFICIENCY[edge.transport];
    const destTerrains = getCachedTerrains(toQ, toR);
    if (destTerrains.includes('water')) best = Math.max(best ?? 0, 1.0);
    return best;
  }
  if (isAtMapEdge(startHex.q, startHex.r)) return [{ q: startHex.q, r: startHex.r }];

  // BFS tracking parent pointers for best-efficiency path reconstruction
  const bestSeen = new Map<string, number>();
  const parent = new Map<string, string>();
  const queue: [string, number][] = [];
  for (const n of getNeighbors(startHex.q, startHex.r)) {
    const nk = hexKey(n.q, n.r);
    if (!grid[nk]) continue;
    const eff = getStepEfficiency(startHex.q, startHex.r, n.q, n.r);
    if (eff === null) continue;
    bestSeen.set(nk, eff);
    parent.set(nk, startKey);
    queue.push([nk, eff]);
  }
  let bestEfficiency = 0;
  let bestEndKey: string | null = null;
  while (queue.length > 0) {
    const [cur, minEff] = queue.shift()!;
    const curHex = grid[cur];
    if (!curHex) continue;
    // Skip stale entries (we already found a better path to this node)
    if (minEff < (bestSeen.get(cur) ?? 0)) continue;
    if (isAtMapEdge(curHex.q, curHex.r)) {
      if (minEff > bestEfficiency) {
        bestEfficiency = minEff;
        bestEndKey = cur;
      }
      continue;
    }
    for (const n of getNeighbors(curHex.q, curHex.r)) {
      const nk = hexKey(n.q, n.r);
      if (!grid[nk]) continue;
      const stepEff = getStepEfficiency(curHex.q, curHex.r, n.q, n.r);
      if (stepEff === null) continue;
      const pathEff = Math.min(minEff, stepEff);
      const prev = bestSeen.get(nk) ?? 0;
      if (pathEff > prev) {
        bestSeen.set(nk, pathEff);
        parent.set(nk, cur);
        queue.push([nk, pathEff]);
      }
    }
  }
  if (!bestEndKey) return null;
  // Reconstruct path (visited set prevents cycles in parent chain)
  const path: { q: number; r: number }[] = [];
  let cur: string | undefined = bestEndKey;
  const visited = new Set<string>();
  while (cur && !visited.has(cur)) {
    visited.add(cur);
    const hex = grid[cur];
    if (hex) path.push({ q: hex.q, r: hex.r });
    cur = parent.get(cur);
  }
  path.reverse();
  return path;
}

function allocatePass(
  resource: string,
  producers: ProducerState[],
  consumers: (ConsumerState | { hex: HexData; key: string; demand: Record<string, number>; received: Record<string, number>; distanceLoss: Record<string, number>; prioritized: boolean })[],
  distMap: DistanceMap,
  portDistMap?: DistanceMap,
  flowPairs?: FlowPair[]
) {
  const consumerList = consumers;
  const pairs: AllocPair[] = [];
  for (const p of producers) {
    const remaining = p.remaining[resource] || 0;
    if (remaining <= 0) continue;
    const pDists = p.key === '__base__' ? null : distMap.get(p.key);
    for (const c of consumerList) {
      const needed = (c.demand[resource] || 0) - (c.received[resource] || 0);
      if (needed <= 0) continue;
      if (p.key === c.key) continue;

      // Use canal-enabled distances when consumer is a port/depot
      const portDists = portDistMap?.get(c.key);
      const pathCost = portDists
        ? (p.key === '__base__' ? 0 : (portDists.get(p.key) ?? Infinity))
        : (pDists ? (pDists.get(c.key) ?? Infinity) : 0);
      if (pathCost === Infinity) continue;
      const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
      if (transferEff <= 0) continue;
      pairs.push({ producer: p, consumer: c as ConsumerState, pathCost, transferEff });
    }
  }
  
  pairs.sort((a, b) => {
    const ap = a.consumer.prioritized ? 0 : 1;
    const bp = b.consumer.prioritized ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.pathCost - b.pathCost;
  });

  for (const { producer, consumer, pathCost, transferEff } of pairs) {
    const remaining = producer.remaining[resource] || 0;
    const needed = (consumer.demand[resource] || 0) - (consumer.received[resource] || 0);
    if (remaining <= 0 || needed <= 0) continue;

    const rawNeeded = transferEff > 0 ? needed / transferEff : needed;
    const canSend = Math.min(remaining, rawNeeded);
    const delivered = canSend * transferEff;

    consumer.received[resource] = (consumer.received[resource] || 0) + delivered;
    consumer.distanceLoss[resource] = (consumer.distanceLoss[resource] || 0) + (canSend - delivered);
    producer.remaining[resource] -= canSend;

    if (flowPairs && delivered > 0.01 && producer.key !== '__base__') {
      flowPairs.push({ sourceKey: producer.key, destKey: consumer.key, resource, amount: delivered, pathCost });
    }
  }
}

/** Aggregate flow pairs by (source, dest, resource), summing amounts. */
function aggregateFlowPairs(pairs: FlowPair[]): FlowPair[] {
  const map = new Map<string, FlowPair>();
  for (const p of pairs) {
    if (p.amount < 0.01) continue;
    const key = `${p.sourceKey}|${p.destKey}|${p.resource}`;
    const existing = map.get(key);
    if (existing) {
      existing.amount += p.amount;
      existing.pathCost = Math.max(existing.pathCost, p.pathCost);
    } else {
      map.set(key, { ...p });
    }
  }
  return Array.from(map.values());
}

export function findPath(
  sourceKey: string,
  destKey: string,
  grid: Record<string, HexData>,
  infraEdges: Record<string, InfrastructureEdge>,
  waterPortKeys?: Set<string>,
  stepCostOverrides?: Partial<Record<string, number>>,
  hubZones?: { hubKey: string; hexKeys: Set<string> }[],
  category: 'transport' | 'power' = 'transport',
  maxCost: number = 10
): { q: number; r: number }[] | null {
  const sourceHex = grid[sourceKey];
  const destHex = grid[destKey];
  if (!sourceHex || !destHex) return null;
  if (sourceKey === destKey) return [{ q: sourceHex.q, r: sourceHex.r }];

  // Precompute hub zone lookups
  const hexToHubZones = new Map<string, { hubKey: string; hexKeys: Set<string> }[]>();
  const hubCenterZones = new Map<string, { hubKey: string; hexKeys: Set<string> }[]>();
  if (hubZones) {
    for (const zone of hubZones) {
      for (const hk of zone.hexKeys) {
        if (!hexToHubZones.has(hk)) hexToHubZones.set(hk, []);
        hexToHubZones.get(hk)!.push(zone);
      }
      if (!hubCenterZones.has(zone.hubKey)) hubCenterZones.set(zone.hubKey, []);
      hubCenterZones.get(zone.hubKey)!.push(zone);
    }
  }

  const distances = new Map<string, number>();
  const parent = new Map<string, string>();
  distances.set(sourceKey, 0);
  const queue = new MinHeap();
  queue.push({ key: sourceKey, q: sourceHex.q, r: sourceHex.r, cost: 0 });

  while (queue.length > 0) {
    const current = queue.pop();

    if (current.key === destKey) break; // Early termination

    if (current.cost > (distances.get(current.key) ?? Infinity)) continue;

    // Normal hex neighbors
    for (const d of HEX_DIRECTIONS) {
      const nq = current.q + d.dq, nr = current.r + d.dr;
      const nKey = hexKey(nq, nr);
      if (!grid[nKey]) continue;
      const ek = getEdgeKey(current.q, current.r, nq, nr);
      const edge = infraEdges[ek];
      const edgeType = edge ? (category === 'power' ? edge.power : edge.transport) : undefined;
      const stepCost = edgeType
        ? (stepCostOverrides?.[edgeType] ?? INFRA_STEP_COSTS[edgeType])
        : 1.0;
      const newCost = current.cost + stepCost;
      if (newCost <= maxCost && newCost < (distances.get(nKey) ?? Infinity)) {
        distances.set(nKey, newCost);
        parent.set(nKey, current.key);
        queue.push({ key: nKey, q: nq, r: nr, cost: newCost });
      }
    }

    // Free port-to-port transit
    if (waterPortKeys && waterPortKeys.has(current.key)) {
      for (const portKey of waterPortKeys) {
        if (portKey === current.key) continue;
        const portHex = grid[portKey];
        if (!portHex) continue;
        if (current.cost < (distances.get(portKey) ?? Infinity)) {
          distances.set(portKey, current.cost);
          parent.set(portKey, current.key);
          queue.push({ key: portKey, q: portHex.q, r: portHex.r, cost: current.cost });
        }
      }
    }

    // Hub zone: spoke → hub
    const hubsForHex = hexToHubZones.get(current.key);
    if (hubsForHex) {
      for (const zone of hubsForHex) {
        const hubHex = grid[zone.hubKey];
        if (!hubHex || zone.hubKey === current.key) continue;
        const hopCost = current.cost + HUB_HOP_COST;
        if (hopCost <= maxCost && hopCost < (distances.get(zone.hubKey) ?? Infinity)) {
          distances.set(zone.hubKey, hopCost);
          parent.set(zone.hubKey, current.key);
          queue.push({ key: zone.hubKey, q: hubHex.q, r: hubHex.r, cost: hopCost });
        }
      }
    }

    // Hub zone: hub → spokes
    const centerZones = hubCenterZones.get(current.key);
    if (centerZones) {
      for (const zone of centerZones) {
        for (const dKey of zone.hexKeys) {
          if (dKey === current.key) continue;
          const dHex = grid[dKey];
          if (!dHex) continue;
          const hopCost = current.cost + HUB_HOP_COST;
          if (hopCost <= maxCost && hopCost < (distances.get(dKey) ?? Infinity)) {
            distances.set(dKey, hopCost);
            parent.set(dKey, current.key);
            queue.push({ key: dKey, q: dHex.q, r: dHex.r, cost: hopCost });
          }
        }
      }
    }
  }

  if (!distances.has(destKey)) return null;

  // Reconstruct path
  const path: { q: number; r: number }[] = [];
  let cur = destKey;
  while (cur) {
    const hex = grid[cur];
    if (hex) path.push({ q: hex.q, r: hex.r });
    const p = parent.get(cur);
    if (!p) break;
    cur = p;
  }
  path.reverse();
  return path;
}

export function simulateTick(
  grid: Record<string, HexData>,
  _terrainGrid: Record<string, TerrainHex>,
  terrainsOrFn: GetTerrainsFn | TerrainAssociations,
  infraEdges: Record<string, InfrastructureEdge>,
  infraConstructionSites: InfraEdgeConstructionSite[],
): { grid: Record<string, HexData>; flowSummary: FlowSummary; exportRate: ResourceMap; infraEdges: Record<string, InfrastructureEdge>; infraConstructionSites: InfraEdgeConstructionSite[]; flowPairs: FlowPair[] } {
  const getTerrains: GetTerrainsFn = typeof terrainsOrFn === 'function'
    ? terrainsOrFn
    : (q: number, r: number) => terrainsOrFn[hexKey(q, r)] || [];
  const nextGrid: Record<string, HexData> = {};
  for (const key of Object.keys(grid)) nextGrid[key] = { ...grid[key] };
  const allFlowPairs: FlowPair[] = [];
  const nextInfraEdges = { ...infraEdges };

  const clusters = computeClusters(grid);
  const superclusters = computeSuperclusters(grid);

  const operatingBuildings: { hex: HexData; key: string; buildingId: string }[] = [];
  const constructionSites: { hex: HexData; key: string }[] = [];
  for (const [key, hex] of Object.entries(grid)) {
    if (hex.constructionSite) {
      constructionSites.push({ hex, key });
      if (hex.constructionSite.isUpgrade && hex.constructionSite.previousBuildingId) {
        operatingBuildings.push({ hex, key, buildingId: hex.constructionSite.previousBuildingId });
      }
    } else if (hex.buildingId && !hex.paused) operatingBuildings.push({ hex, key, buildingId: hex.buildingId });
  }

  const producers: ProducerState[] = [{
    hex: { q: 0, r: 0 }, key: '__base__', buildingId: '__base__',
    potential: { population: BASE_POPULATION }, realized: {}, remaining: { population: BASE_POPULATION },
    clusterBonus: 0, clusterSize: 0, zoneOutputBonus: 0, zoneInputReduction: 0, superclusterSize: 0
  }];

  const processors: ConsumerState[] = [];
  const exporters: ConsumerState[] = [];

  for (const { hex, key, buildingId } of operatingBuildings) {
    const building = BUILDINGS[buildingId];
    const potential: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.outputs)) potential[res] = amount as number;
    const cluster = clusters.get(key);
    const clusterBonus = cluster?.bonus ?? 0;
    const clusterSize = cluster?.size ?? 1;
    if (clusterBonus > 0) {
      for (const [res, amount] of Object.entries(building.outputs)) potential[res] = (potential[res] || 0) + (amount as number) * clusterBonus;
    }
    const sc = superclusters.get(key);
    const scMultiplier = sc?.bonus ?? 0;
    const scUniCount = Math.min(sc?.uniCount ?? 0, 4);
    const superclusterSize = sc?.size ?? 0;
    const zoneOutputBonus = scMultiplier > 0 ? (ZONE_OUTPUT_BONUS + scUniCount * 0.10) * scMultiplier : 0;
    const zoneInputReduction = scMultiplier > 0 ? Math.min((ZONE_INPUT_REDUCTION + scUniCount * 0.05) * scMultiplier, 0.25) : 0;
    if (zoneOutputBonus > 0) {
      for (const [res, amount] of Object.entries(building.outputs)) potential[res] = (potential[res] || 0) + (amount as number) * zoneOutputBonus;
    }
    producers.push({ hex, key, buildingId, potential, realized: {}, remaining: { ...potential }, clusterBonus, clusterSize, zoneOutputBonus, zoneInputReduction, superclusterSize });

    const demand: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.inputs)) demand[res] = (amount as number) * (1 - zoneInputReduction);
    if (Object.keys(demand).length > 0) {
      const state = { hex, key, buildingId, prioritized: !!hex.prioritized, demand, received: {}, distanceLoss: {} };
      if (buildingId === 'export_port') exporters.push(state);
      else processors.push(state);
    }
  }

  // No need to split again, use processors and exporters arrays directly
  const allProcessorRes = new Set<string>();
  for (const c of processors) for (const res of Object.keys(c.demand)) allProcessorRes.add(res);

  // Collect water port keys: export_port buildings on water terrain or with a canal edge
  const waterPortKeys = new Set<string>();
  for (const [key, hex] of Object.entries(grid)) {
    if (hex.buildingId === 'export_port' && !hex.constructionSite) {
      const terrains = getTerrains(hex.q, hex.r);
      const hasCanal = countHexConnections(hex.q, hex.r, infraEdges, 'canal') > 0;
      if (terrains.includes('water') || hasCanal) waterPortKeys.add(key);
    }
  }

  // Compute hub zones from operating hub buildings for free flow within radius.
  // Each hex belongs only to the closest hub (by hex distance) to prevent
  // stacking benefits from overlapping hub radii.
  const hubBuildings: { key: string; q: number; r: number; radius: number }[] = [];
  for (const { key, buildingId, hex } of operatingBuildings) {
    const radius = HUB_RADIUS[buildingId];
    if (radius === undefined) continue;
    hubBuildings.push({ key, q: hex.q, r: hex.r, radius });
  }
  // For each hex covered by any hub, assign it to the nearest hub only
  const hubHexSets = new Map<string, Set<string>>();
  for (const hub of hubBuildings) hubHexSets.set(hub.key, new Set<string>());
  if (hubBuildings.length > 0) {
    // Collect all candidate hexes from all hubs
    const hexCandidates = new Map<string, { q: number; r: number; bestHub: string; bestDist: number }>();
    for (const hub of hubBuildings) {
      for (const h of getHexesInRadius(hub.q, hub.r, hub.radius)) {
        const k = hexKey(h.q, h.r);
        if (!grid[k]) continue;
        const dist = Math.max(Math.abs(h.q - hub.q), Math.abs(h.r - hub.r), Math.abs((h.q + h.r) - (hub.q + hub.r)));
        const existing = hexCandidates.get(k);
        if (!existing || dist < existing.bestDist || (dist === existing.bestDist && hub.key < existing.bestHub)) {
          hexCandidates.set(k, { q: h.q, r: h.r, bestHub: hub.key, bestDist: dist });
        }
      }
    }
    for (const [hk, info] of hexCandidates) {
      hubHexSets.get(info.bestHub)!.add(hk);
    }
  }
  const hubZones: { hubKey: string; hexKeys: Set<string> }[] = [];
  for (const hub of hubBuildings) {
    hubZones.push({ hubKey: hub.key, hexKeys: hubHexSets.get(hub.key)! });
  }

  // Precompute all-pairs distances once (SSSP from each producer)
  const producerKeys = producers.filter(p => p.key !== '__base__').map(p => p.key);
  const distMap = precomputeDistances(producerKeys, grid, infraEdges, 10, waterPortKeys, undefined, hubZones);

  // Canal-enabled distances from ports/depots/stations (undirected: dist port→hex = hex→port)
  const portDepotKeys = producers
    .filter(p => p.buildingId === 'export_port' || p.buildingId === 'trade_depot' || p.buildingId === 'station')
    .map(p => p.key);
  const portDistMap = portDepotKeys.length > 0
    ? precomputeDistances(portDepotKeys, grid, infraEdges, 10, waterPortKeys, { canal: 0 }, hubZones)
    : new Map<string, Map<string, number>>();

  // Electricity distance map: only from producers that actually output electricity
  const elecProducerKeys = producers
    .filter(p => p.key !== '__base__' && (p.potential['electricity'] || 0) > 0)
    .map(p => p.key);
  const elecDistMap = elecProducerKeys.length > 0
    ? precomputeDistances(elecProducerKeys, grid, infraEdges, 10, waterPortKeys, { power_line: 0.2, hv_line: 0 }, hubZones, 'power')
    : new Map<string, Map<string, number>>();

  // Build lookup maps for processors/exporters by key
  const processorByKey = new Map<string, ConsumerState>();
  for (const c of processors) processorByKey.set(c.key, c);
  const exporterByKey = new Map<string, ConsumerState>();
  for (const c of exporters) exporterByKey.set(c.key, c);

  // Collect resources needed by construction sites for targeted reserve
  const constructionResources = new Set<string>();
  for (const { hex } of constructionSites) {
    for (const [res, total] of Object.entries(hex.constructionSite!.totalCost)) {
      if ((hex.constructionSite!.delivered[res] || 0) < total) constructionResources.add(res);
    }
  }
  for (const site of infraConstructionSites) {
    for (const [res, total] of Object.entries(site.totalCost)) {
      if ((site.delivered[res] || 0) < total) constructionResources.add(res);
    }
  }
  const hasConstructionSites = constructionResources.size > 0;

  // === 1. Convergence Loop (Processors Only) ===
  const efficiencyByKey = new Map<string, number>();
  for (let iter = 0; iter < CONVERGENCE_ITERATIONS; iter++) {
    for (const c of processors) { c.received = {}; c.distanceLoss = {}; }
    for (const p of producers) {
      if (p.key === '__base__') p.remaining = { population: BASE_POPULATION };
      else {
        const eff = efficiencyByKey.get(p.key) ?? 1;
        for (const res of Object.keys(p.potential)) {
          p.remaining[res] = p.potential[res] * eff * (constructionResources.has(res) ? 1 - CONSTRUCTION_RESERVE : 1);
        }
      }
    }
    for (const res of allProcessorRes) {
      allocatePass(res, producers, processors, res === 'electricity' ? elecDistMap : distMap);
    }
    for (const producer of producers) {
      if (producer.key === '__base__') continue;
      const consumer = processorByKey.get(producer.key);
      let inputEfficiency = 1.0;
      if (consumer) {
        for (const res of Object.keys(consumer.demand)) {
          const satisfaction = (consumer.demand[res] || 0) > 0 ? Math.min(1, (consumer.received[res] || 0) / consumer.demand[res]) : 1;
          if (satisfaction < inputEfficiency) inputEfficiency = satisfaction;
        }
      }
      efficiencyByKey.set(producer.key, Math.max(inputEfficiency, MIN_PRODUCTION_FLOOR));
    }
  }

  // === 2. Establish Realized Production ===
  for (const p of producers) {
    if (p.key === '__base__') { p.realized = { population: BASE_POPULATION }; p.remaining = { population: BASE_POPULATION }; }
    else {
      const eff = efficiencyByKey.get(p.key) ?? 1;
      p.realized = {}; p.remaining = {};
      for (const [res, amt] of Object.entries(p.potential)) { p.realized[res] = amt * eff; p.remaining[res] = amt * eff * (constructionResources.has(res) ? 1 - CONSTRUCTION_RESERVE : 1); }
    }
  }

  // === 3. Allocation Pass: Processors (Priority 1) ===
  for (const c of processors) { c.received = {}; c.distanceLoss = {}; }
  for (const res of allProcessorRes) allocatePass(res, producers, processors, res === 'electricity' ? elecDistMap : distMap, undefined, allFlowPairs);

  // Release the construction reserve back into producer remaining before construction pass
  if (hasConstructionSites) {
    for (const p of producers) {
      if (p.key === '__base__') continue;
      const eff = efficiencyByKey.get(p.key) ?? 1;
      for (const res of Object.keys(p.potential)) {
        if (constructionResources.has(res)) {
          p.remaining[res] = (p.remaining[res] || 0) + p.potential[res] * eff * CONSTRUCTION_RESERVE;
        }
      }
    }
  }

  const summary = emptyFlowSummary();

  // === 4. Allocation Pass: Construction (Priority 2) ===
  const constructionDemands: (ConsumerState & { siteKey: string })[] = [];
  for (const { hex, key } of constructionSites) {
    const demand: Record<string, number> = {};
    for (const [res, total] of Object.entries(hex.constructionSite!.totalCost)) {
      demand[res] = total - (hex.constructionSite!.delivered[res] || 0);
    }
    constructionDemands.push({ hex, key, buildingId: 'site', prioritized: !!hex.prioritized, demand, received: {}, distanceLoss: {}, siteKey: key });
  }
  // Infra construction sites
  const infraDemands: (ConsumerState & { edgeKey: string })[] = [];
  for (const site of infraConstructionSites) {
    const demand: Record<string, number> = {};
    for (const [res, total] of Object.entries(site.totalCost)) {
      demand[res] = total - (site.delivered[res] || 0);
    }
    const hexAKey = hexKey(site.hexA.q, site.hexA.r);
    const hexA = grid[hexAKey] || { q: site.hexA.q, r: site.hexA.r };
    infraDemands.push({ hex: hexA as HexData, key: hexAKey, buildingId: 'infra', prioritized: false, demand, received: {}, distanceLoss: {}, edgeKey: site.edgeKey });
  }

  const allConstructionConsumers = [...constructionDemands, ...infraDemands];
  const allConstRes = new Set<string>();
  for (const c of allConstructionConsumers) for (const res of Object.keys(c.demand)) allConstRes.add(res);
  for (const res of allConstRes) allocatePass(res, producers, allConstructionConsumers, distMap);

  // === 5. Allocation Pass: Export Ports (Priority 3) ===
  const allExportRes = new Set<string>();
  for (const c of exporters) for (const res of Object.keys(c.demand)) allExportRes.add(res);
  for (const res of allExportRes) allocatePass(res, producers, exporters, res === 'electricity' ? elecDistMap : distMap, portDistMap, allFlowPairs);

  // Cache export efficiency BFS results (called for each hub building, potentially twice)
  const exportEffCache = new Map<string, number>();
  function getCachedExportEfficiency(key: string): number {
    const cached = exportEffCache.get(key);
    if (cached !== undefined) return cached;
    const eff = getExportEfficiency(key, grid, infraEdges, getTerrains);
    exportEffCache.set(key, eff);
    return eff;
  }

  addToMap(summary.potential, 'population', BASE_POPULATION);
  addToMap(summary.realized, 'population', BASE_POPULATION);
  const exportRate: ResourceMap = {};

  for (const producer of producers) {
    if (producer.key === '__base__') continue;
    const building = BUILDINGS[producer.buildingId];
    const processor = processorByKey.get(producer.key);
    const exporter = exporterByKey.get(producer.key);
    const inputEfficiency = efficiencyByKey.get(producer.key) ?? 1;

    // Potential demand for ledger
    for (const [res, amt] of Object.entries(building.inputs)) addToMap(summary.potentialDemand, res, amt * (1 - producer.zoneInputReduction));

    // Summary of production
    for (const [res, amt] of Object.entries(producer.realized)) {
      addToMap(summary.potential, res, producer.potential[res]);
      addToMap(summary.realized, res, amt);
    }

    const buildingExports: ResourceMap = {};
    let buildingExportEff = 0;
    if (producer.buildingId === 'export_port' || producer.buildingId === 'trade_depot' || producer.buildingId === 'station') {
      buildingExportEff = getCachedExportEfficiency(producer.key);
    }

    // Diagnostics and Consumption for Processors
    const inputDiagnostics: InputDiagnostic[] = [];
    const consumed: ResourceMap = {};
    if (processor) {
      for (const res of Object.keys(building.inputs)) {
        const received = processor.received[res] || 0;
        const distLoss = processor.distanceLoss[res] || 0;
        const required = processor.demand[res] || 0;
        const satisfaction = required > 0 ? Math.min(1, received / required) : 1;
        const shortage = Math.max(0, required - received - distLoss);
        inputDiagnostics.push({ resource: res, required, available: received, distanceLoss: distLoss, inputShortage: shortage, satisfaction });
        consumed[res] = received;
        addToMap(summary.consumed, res, received);
        addToMap(summary.lostToDistance, res, distLoss);
        addToMap(summary.lostToShortage, res, shortage);
      }
    }

    // Consumption for Exporter Ports
    if (exporter) {
      for (const res of Object.keys(building.inputs)) {
        const received = exporter.received[res] || 0;
        const distLoss = exporter.distanceLoss[res] || 0;
        consumed[res] = received;
        addToMap(summary.consumed, res, received);
        addToMap(summary.exportConsumed, res, received);
        addToMap(summary.lostToDistance, res, distLoss);
        if (buildingExportEff > 0 && res === 'goods') {
          const exported = received * buildingExportEff;
          addToMap(exportRate, 'goods', exported);
          buildingExports['goods'] = exported;
        }
      }
    }

    nextGrid[producer.key].flowState = {
      potential: producer.potential, realized: producer.realized, consumed, inputDiagnostics,
      efficiency: producer.buildingId === 'export_port' ? 1 : inputEfficiency, // port efficiency handled by consumed goods
      clusterBonus: producer.clusterBonus, clusterSize: producer.clusterSize,
      zoneOutputBonus: producer.zoneOutputBonus, zoneInputReduction: producer.zoneInputReduction,
      superclusterSize: producer.superclusterSize,
      exports: buildingExports, exportEfficiency: buildingExportEff
    };
  }

  // === Trade Depot Surplus Absorption ===
  // All depots/stations share surplus proportionally based on transfer efficiency
  const depots: { producer: ProducerState; exportEff: number }[] = [];
  for (const depot of producers) {
    if (depot.key === '__base__' || (depot.buildingId !== 'trade_depot' && depot.buildingId !== 'station')) continue;
    const depotExportEff = getCachedExportEfficiency(depot.key);
    if (depotExportEff <= 0) continue;
    depots.push({ producer: depot, exportEff: depotExportEff });
  }
  const depotExportsMap = new Map<string, ResourceMap>();
  for (const d of depots) depotExportsMap.set(d.producer.key, {});

  for (const res of ALL_EXPORTABLE_RESOURCES) {
    // For each producer with remaining resources, compute transfer efficiency to each depot
    const claims: { producerKey: string; depotKey: string; transferEff: number; available: number; depotExportEff: number }[] = [];
    for (const p of producers) {
      if (p.key === '__base__' || (p.remaining[res] || 0) <= 0) continue;
      const available = p.remaining[res] || 0;
      for (const d of depots) {
        const depotDists = portDistMap.get(d.producer.key);
        const fallbackDist = res === 'electricity'
          ? (elecDistMap.get(p.key)?.get(d.producer.key) ?? Infinity)
          : (distMap.get(p.key)?.get(d.producer.key) ?? Infinity);
        const pathCost = depotDists ? Math.min(depotDists.get(p.key) ?? Infinity, fallbackDist) : fallbackDist;
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
        if (transferEff <= 0) continue;
        claims.push({ producerKey: p.key, depotKey: d.producer.key, transferEff, available, depotExportEff: d.exportEff });
      }
    }
    // Group claims by producer to split surplus proportionally
    const byProducer = new Map<string, typeof claims>();
    for (const c of claims) {
      if (!byProducer.has(c.producerKey)) byProducer.set(c.producerKey, []);
      byProducer.get(c.producerKey)!.push(c);
    }
    for (const [pKey, pClaims] of byProducer) {
      const p = producers.find(x => x.key === pKey)!;
      const available = p.remaining[res] || 0;
      if (available <= 0) continue;
      const totalWeight = pClaims.reduce((s, c) => s + c.transferEff, 0);
      for (const c of pClaims) {
        const share = available * (c.transferEff / totalWeight);
        const received = share * c.transferEff;
        const exported = received * c.depotExportEff;
        if (exported > 0) {
          addToMap(exportRate, res, exported);
          const dExports = depotExportsMap.get(c.depotKey)!;
          dExports[res] = (dExports[res] || 0) + exported;
        }
      }
      addToMap(summary.consumed, res, available);
      addToMap(summary.exportConsumed, res, available);
      p.remaining[res] = 0;
    }
  }
  for (const d of depots) {
    const flowState = nextGrid[d.producer.key].flowState;
    if (flowState) {
      nextGrid[d.producer.key].flowState = { ...flowState, exports: depotExportsMap.get(d.producer.key)!, exportEfficiency: d.exportEff };
    }
  }

  // Update Construction Sites
  for (const d of constructionDemands) {
    const site = grid[d.siteKey].constructionSite!;
    const newDelivered = { ...site.delivered };
    for (const [res, amt] of Object.entries(d.received)) newDelivered[res] = (newDelivered[res] || 0) + amt;
    const allComplete = Object.entries(site.totalCost).every(([res, needed]) => (newDelivered[res] || 0) >= needed - 0.01);
    if (allComplete) {
      nextGrid[d.siteKey].buildingId = site.targetBuildingId;
      nextGrid[d.siteKey].constructionSite = undefined;
      nextGrid[d.siteKey].flowState = undefined;
    } else {
      nextGrid[d.siteKey].constructionSite = { ...site, delivered: newDelivered };
    }
    for (const [res, amt] of Object.entries(d.received)) addToMap(summary.consumed, res, amt);
    for (const [res, amt] of Object.entries(d.distanceLoss)) addToMap(summary.lostToDistance, res, amt);
  }

  const nextInfraConstructionSites: InfraEdgeConstructionSite[] = [];
  for (const d of infraDemands) {
    const site = infraConstructionSites.find(s => s.edgeKey === d.edgeKey)!;
    const newDelivered = { ...site.delivered };
    for (const [res, amt] of Object.entries(d.received)) newDelivered[res] = (newDelivered[res] || 0) + amt;
    const allComplete = Object.entries(site.totalCost).every(([res, needed]) => (newDelivered[res] || 0) >= needed - 0.01);
    if (allComplete) { nextInfraEdges[d.edgeKey] = setEdgeType(nextInfraEdges[d.edgeKey], site.targetType); }
    else { nextInfraConstructionSites.push({ ...site, delivered: newDelivered }); }
    for (const [res, amt] of Object.entries(d.received)) addToMap(summary.consumed, res, amt);
    for (const [res, amt] of Object.entries(d.distanceLoss)) addToMap(summary.lostToDistance, res, amt);
  }

    return { grid: nextGrid, flowSummary: summary, exportRate, infraEdges: nextInfraEdges, infraConstructionSites: nextInfraConstructionSites, flowPairs: aggregateFlowPairs(allFlowPairs) };

  }

export function computeMarketPrices(totalExports: ResourceMap): ResourceMap {
  const prices: ResourceMap = {};
  for (const [res, config] of Object.entries(MARKET_CONFIG)) {
    const exported = totalExports[res] || 0;
    prices[res] = config.base_value / (1 + exported / config.saturation);
  }
  return prices;
}

export function computeTradeValue(exportRate: ResourceMap, prices: ResourceMap): number {
  let value = 0;
  for (const res of Object.keys(exportRate)) {
    const rate = exportRate[res] || 0;
    const price = prices[res] || 0;
    value += rate * price;
  }
  return value;
}
