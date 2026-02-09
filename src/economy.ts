import { HexData, TerrainHex, TerrainType, ResourceMap, FlowSummary, BuildingFlowState, InputDiagnostic, InfrastructureType, InfrastructureEdge, InfraEdgeConstructionSite, BonusZone, ZoneType } from './types';
import { BUILDINGS, ZONE_TYPES, ZONE_OUTPUT_BONUS, ZONE_INPUT_REDUCTION } from './constants';
import { hexKey, getEdgeKey, getNeighbors, getHexesInRadius } from './hexUtils';

type PathCostFn = (start: HexData, end: HexData, grid: Record<string, HexData>) => number;
type GetTerrainsFn = (q: number, r: number) => TerrainType[];

interface ProducerState {
  hex: HexData;
  key: string;
  buildingId: string;
  potential: Record<string, number>; // max output at 100% efficiency
  remaining: Record<string, number>; // remaining capacity this iteration
  clusterBonus: number;
  clusterSize: number;
  zoneOutputBonus: number;
  zoneInputReduction: number;
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
  return { potential: {}, realized: {}, consumed: {}, lostToDistance: {}, lostToShortage: {} };
}

function addToMap(map: ResourceMap, key: string, amount: number) {
  map[key] = (map[key] || 0) + amount;
}

const CONVERGENCE_ITERATIONS = 5;
const BASE_POPULATION = 0.1;
const CONSTRUCTION_RESERVE = 0.1; // reserve 10% of production for construction sites
const MIN_PRODUCTION_FLOOR = 0.1; // buildings always produce at least 10% to prevent deadlocks

const INFRA_STEP_COSTS: Record<InfrastructureType, number> = {
  road: 0.5,
  rail: 0.2,
  canal: 0.15,
};

function computeClusters(grid: Record<string, HexData>): Map<string, { size: number; bonus: number }> {
  const visited = new Set<string>();
  const result = new Map<string, { size: number; bonus: number }>();

  // First pass: find all contiguous clusters of same-type buildings
  const clusters: string[][] = [];
  for (const [key, hex] of Object.entries(grid)) {
    if (visited.has(key) || !hex.buildingId) continue;
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
        if (nHex?.buildingId === hex.buildingId) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }
    clusters.push(cluster);
  }

  // Second pass: for each building, BFS within its cluster to compute
  // distance-decayed adjacency score. Immediate neighbors contribute 1.0,
  // distance 2 contributes 0.5, distance 3 contributes 0.25, etc.
  for (const cluster of clusters) {
    const clusterSize = cluster.length;
    if (clusterSize <= 1) {
      result.set(cluster[0], { size: 1, bonus: 0 });
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
          score += Math.pow(0.5, nDist - 1); // dist 1: 1.0, dist 2: 0.5, dist 3: 0.25...
          bfsQueue.push(nk);
        }
      }

      const bonus = score >= 5 ? 1.0 : score >= 3 ? 0.5 : score >= 2 ? 0.25 : score >= 1 ? 0.1 : 0;
      result.set(buildingKey, { size: clusterSize, bonus });
    }
  }

  return result;
}

const INFRA_EXPORT_EFFICIENCY: Record<InfrastructureType, number> = {
  road: 0.5,
  rail: 0.7,
  canal: 1.0,
};

const ALL_EXPORTABLE_RESOURCES: string[] = [
  'food', 'wood', 'stone', 'iron_ore', 'coal',
  'iron_ingot', 'tools', 'concrete', 'steel', 'machinery', 'goods',
];

function getExportEfficiency(startKey: string, grid: Record<string, HexData>, infraEdges: Record<string, InfrastructureEdge>, getTerrains: GetTerrainsFn): number {
  // BFS along infrastructure edges + water to the map edge.
  // Water terrain acts as free canal (1.0 efficiency).
  // Track weakest link per path. Return best efficiency across all paths.
  // "Map edge" = a hex with terrain whose neighbor has no terrain (beyond the map).
  const startHex = grid[startKey];
  if (!startHex) return 0;

  // Cache terrain lookups
  const terrainCache = new Map<string, TerrainType[]>();
  function getCachedTerrains(q: number, r: number): TerrainType[] {
    const k = hexKey(q, r);
    if (terrainCache.has(k)) return terrainCache.get(k)!;
    const t = getTerrains(q, r);
    terrainCache.set(k, t);
    return t;
  }

  // A hex is at the map edge if it has terrain but a neighbor doesn't
  function isAtMapEdge(q: number, r: number): boolean {
    for (const n of getNeighbors(q, r)) {
      const nk = hexKey(n.q, n.r);
      if (!grid[nk]) return true;
      if (getCachedTerrains(n.q, n.r).length === 0) return true;
    }
    return false;
  }

  // Get step efficiency for traversing from one hex to a neighbor
  function getStepEfficiency(fromQ: number, fromR: number, toQ: number, toR: number): number | null {
    // Check for infrastructure edge between these two hexes
    const ek = getEdgeKey(fromQ, fromR, toQ, toR);
    const edge = infraEdges[ek];
    let best: number | null = null;
    if (edge) best = INFRA_EXPORT_EFFICIENCY[edge.type];
    // Water terrain on destination acts as free canal (1.0)
    const destTerrains = getCachedTerrains(toQ, toR);
    if (destTerrains.includes('water')) best = Math.max(best ?? 0, 1.0);
    return best;
  }

  // If start hex is already at the map edge, direct export
  if (isAtMapEdge(startHex.q, startHex.r)) return 1.0;

  // BFS: queue entries are [hexKey, minEfficiencyAlongPath]
  const bestSeen = new Map<string, number>();
  const queue: [string, number][] = [];

  // Seed with traversable neighbors (infra edge or water)
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

    // Check if this hex is at the map edge
    if (isAtMapEdge(curHex.q, curHex.r)) {
      bestEfficiency = Math.max(bestEfficiency, minEff);
      continue; // found a path, keep looking for better ones
    }

    // Follow traversable connections (infra edges or water)
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

export function simulateTick(
  grid: Record<string, HexData>,
  terrainGrid: Record<string, TerrainHex>,
  getPathCost: PathCostFn,
  getTerrains: GetTerrainsFn,
  zones: BonusZone[],
  infraEdges: Record<string, InfrastructureEdge>,
  infraConstructionSites: InfraEdgeConstructionSite[],
): { grid: Record<string, HexData>; flowSummary: FlowSummary; exportRate: ResourceMap; infraEdges: Record<string, InfrastructureEdge>; infraConstructionSites: InfraEdgeConstructionSite[] } {
  const nextGrid: Record<string, HexData> = {};
  for (const key of Object.keys(grid)) {
    nextGrid[key] = { ...grid[key] };
  }

  // Compute clusters
  const clusters = computeClusters(grid);

  // Build zone membership: hex key → ZoneType
  const zoneByHex = new Map<string, ZoneType>();
  for (const zone of zones) {
    for (const h of getHexesInRadius(zone.centerQ, zone.centerR, 3)) {
      const k = hexKey(h.q, h.r);
      if (!zoneByHex.has(k)) {
        zoneByHex.set(k, zone.type);
      }
    }
  }

  function getBuildingZoneBonus(key: string, buildingId: string): { outputBonus: number; inputReduction: number } {
    const zt = zoneByHex.get(key);
    if (!zt) return { outputBonus: 0, inputReduction: 0 };
    const zoneDef = ZONE_TYPES[zt];
    if (zoneDef.buildings.includes(buildingId)) {
      return { outputBonus: ZONE_OUTPUT_BONUS, inputReduction: ZONE_INPUT_REDUCTION };
    }
    return { outputBonus: 0, inputReduction: 0 };
  }

  // Collect all operating buildings
  const operatingBuildings: { hex: HexData; key: string; buildingId: string }[] = [];
  const constructionSites: { hex: HexData; key: string }[] = [];

  for (const [key, hex] of Object.entries(grid)) {
    if (hex.constructionSite) {
      constructionSites.push({ hex, key });
      if (hex.constructionSite.isUpgrade && hex.constructionSite.previousBuildingId) {
        operatingBuildings.push({ hex, key, buildingId: hex.constructionSite.previousBuildingId });
      }
    } else if (hex.buildingId) {
      operatingBuildings.push({ hex, key, buildingId: hex.buildingId });
    }
  }

  // === Set up producers and consumers ===
  const baseProducer: ProducerState = {
    hex: { q: 0, r: 0 },
    key: '__base__',
    buildingId: '__base__',
    potential: { population: BASE_POPULATION },
    remaining: { population: BASE_POPULATION },
    clusterBonus: 0,
    clusterSize: 0,
    zoneOutputBonus: 0,
    zoneInputReduction: 0,
  };

  const producers: ProducerState[] = [baseProducer];
  const consumers: ConsumerState[] = [];

  // Sort: population buildings first, then others
  const popBuildings = operatingBuildings.filter(b => BUILDINGS[b.buildingId].outputs['population']);
  const otherBuildings = operatingBuildings.filter(b => !BUILDINGS[b.buildingId].outputs['population']);
  const sortedBuildings = [...popBuildings, ...otherBuildings];

  for (const { hex, key, buildingId } of sortedBuildings) {
    const building = BUILDINGS[buildingId];

    // Calculate potential output (at 100% efficiency)
    const potential: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.outputs)) {
      potential[res] = amount as number;
    }

    // Cluster bonus
    const cluster = clusters.get(key);
    const clusterBonus = cluster?.bonus ?? 0;
    const clusterSize = cluster?.size ?? 1;
    if (clusterBonus > 0) {
      for (const [res, amount] of Object.entries(building.outputs)) {
        potential[res] = (potential[res] || 0) + (amount as number) * clusterBonus;
      }
    }

    // Zone bonus
    const { outputBonus: zoneOutputBonus, inputReduction: zoneInputReduction } = getBuildingZoneBonus(key, buildingId);
    if (zoneOutputBonus > 0) {
      for (const [res, amount] of Object.entries(building.outputs)) {
        potential[res] = (potential[res] || 0) + (amount as number) * zoneOutputBonus;
      }
    }

    // Start with remaining = full potential (will be refined by iteration)
    const remaining: Record<string, number> = { ...potential };

    producers.push({ hex, key, buildingId, potential, remaining, clusterBonus, clusterSize, zoneOutputBonus, zoneInputReduction });

    // Consumer state — apply zone input reduction
    const demand: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.inputs)) {
      demand[res] = (amount as number) * (1 - zoneInputReduction);
    }

    if (Object.keys(demand).length > 0) {
      consumers.push({ hex, key, buildingId, prioritized: !!hex.prioritized, demand, received: {}, distanceLoss: {} });
    }
  }

  // Export ports are also consumers (they demand goods, tools, population)
  // They're already included above if they have inputs — which they do

  // === Pre-compute allocation pairs (these don't change between iterations) ===
  const producersByRes: Record<string, ProducerState[]> = {};
  for (const p of producers) {
    for (const res of Object.keys(p.potential)) {
      if (!producersByRes[res]) producersByRes[res] = [];
      producersByRes[res].push(p);
    }
  }

  const allConsumerResources = new Set<string>();
  for (const c of consumers) {
    for (const res of Object.keys(c.demand)) {
      allConsumerResources.add(res);
    }
  }

  // Resources demanded by construction sites count as demand too
  const demandedResources = new Set(allConsumerResources);
  for (const { hex } of constructionSites) {
    for (const res of Object.keys(hex.constructionSite!.totalCost)) {
      const delivered = hex.constructionSite!.delivered[res] || 0;
      if (delivered < hex.constructionSite!.totalCost[res]) {
        demandedResources.add(res);
      }
    }
  }
  // Infra edge construction sites also create demand
  for (const site of infraConstructionSites) {
    for (const res of Object.keys(site.totalCost)) {
      const delivered = site.delivered[res] || 0;
      if (delivered < site.totalCost[res]) {
        demandedResources.add(res);
      }
    }
  }

  // Export ports and trade depots create demand even though they have no outputs
  for (const { buildingId } of operatingBuildings) {
    if (buildingId === 'export_port' || buildingId === 'trade_depot') {
      for (const res of Object.keys(BUILDINGS[buildingId].inputs)) {
        demandedResources.add(res);
      }
    }
  }
  // Trade depots can absorb any exportable resource
  for (const { buildingId } of operatingBuildings) {
    if (buildingId === 'trade_depot') {
      for (const res of ALL_EXPORTABLE_RESOURCES) {
        demandedResources.add(res);
      }
    }
  }

  const pathCostCache = new Map<string, number>();
  function getCachedPathCost(a: HexData, b: HexData): number {
    const cacheKey = `${a.q},${a.r}->${b.q},${b.r}`;
    if (pathCostCache.has(cacheKey)) return pathCostCache.get(cacheKey)!;
    const cost = getPathCost(a, b, grid);
    pathCostCache.set(cacheKey, cost);
    return cost;
  }

  // Pre-compute sorted pairs per resource
  const pairsPerResource: Record<string, AllocPair[]> = {};
  for (const res of allConsumerResources) {
    const resProducers = producersByRes[res] || [];
    const resConsumers = consumers.filter(c => c.demand[res] && c.demand[res] > 0);
    const pairs: AllocPair[] = [];
    for (const p of resProducers) {
      for (const c of resConsumers) {
        if (p.key === c.key) continue;
        const isBase = p.key === '__base__';
        const pathCost = isBase ? 0 : getCachedPathCost(p.hex, c.hex);
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
        if (transferEff <= 0) continue;
        pairs.push({ producer: p, consumer: c, pathCost, transferEff });
      }
    }
    // Prioritized consumers first, then by distance
    pairs.sort((a, b) => {
      const ap = a.consumer.prioritized ? 0 : 1;
      const bp = b.consumer.prioritized ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.pathCost - b.pathCost;
    });
    pairsPerResource[res] = pairs;
  }

  // Map consumers by key for efficiency lookup
  const consumerByKey = new Map<string, ConsumerState>();
  for (const c of consumers) {
    consumerByKey.set(c.key, c);
  }

  // === Iterate allocation to convergence ===
  const efficiencyByKey = new Map<string, number>();
  const hasConstructionSites = constructionSites.length > 0 || infraConstructionSites.length > 0;
  const operatingFraction = hasConstructionSites ? 1 - CONSTRUCTION_RESERVE : 1;

  for (let iter = 0; iter < CONVERGENCE_ITERATIONS; iter++) {
    // Reset consumer state
    for (const c of consumers) {
      c.received = {};
      c.distanceLoss = {};
    }

    // Reset producer remaining based on current efficiency estimates
    // When construction sites exist, reserve a fraction for them
    for (const p of producers) {
      if (p.key === '__base__') {
        p.remaining = { population: BASE_POPULATION };
        continue;
      }
      const eff = efficiencyByKey.get(p.key) ?? 1;
      for (const res of Object.keys(p.potential)) {
        p.remaining[res] = p.potential[res] * eff * operatingFraction;
      }
    }

    // Greedy allocation per resource
    for (const res of allConsumerResources) {
      const pairs = pairsPerResource[res];
      if (!pairs) continue;

      const stillNeeds = new Map<ConsumerState, number>();
      for (const c of consumers) {
        if (c.demand[res] && c.demand[res] > 0) {
          stillNeeds.set(c, c.demand[res]);
        }
      }

      for (const { producer, consumer, transferEff } of pairs) {
        const remaining = producer.remaining[res] || 0;
        const needed = stillNeeds.get(consumer) || 0;
        if (remaining <= 0 || needed <= 0) continue;

        // Send enough raw to deliver `needed` after decay
        const rawNeeded = transferEff > 0 ? needed / transferEff : needed;
        const canSend = Math.min(remaining, rawNeeded);
        const delivered = canSend * transferEff;

        consumer.received[res] = (consumer.received[res] || 0) + delivered;
        consumer.distanceLoss[res] = (consumer.distanceLoss[res] || 0) + (canSend - delivered);
        producer.remaining[res] -= canSend;
        stillNeeds.set(consumer, needed - delivered);
      }
    }

    // Compute efficiencies from allocation results
    for (const producer of producers) {
      if (producer.key === '__base__') continue;

      // Don't produce if none of this building's outputs are demanded
      // Export ports and trade depots have no outputs but should still run
      const hasOutputDemand = Object.keys(producer.potential).some(res => demandedResources.has(res));
      const isExporter = producer.buildingId === 'export_port' || producer.buildingId === 'trade_depot';
      if (!hasOutputDemand && !isExporter) {
        efficiencyByKey.set(producer.key, 0);
        continue;
      }

      const consumer = consumerByKey.get(producer.key);

      let inputEfficiency = 1.0;
      if (consumer) {
        for (const res of Object.keys(consumer.demand)) {
          const required = consumer.demand[res] || 0;
          const received = consumer.received[res] || 0;
          const satisfaction = required > 0 ? Math.min(1, received / required) : 1;
          if (satisfaction < inputEfficiency) inputEfficiency = satisfaction;
        }
      }

      efficiencyByKey.set(producer.key, Math.max(inputEfficiency, MIN_PRODUCTION_FLOOR));
    }
  }

  // === After convergence: compute final summary and flowState ===
  const summary = emptyFlowSummary();
  addToMap(summary.potential, 'population', BASE_POPULATION);
  addToMap(summary.realized, 'population', BASE_POPULATION);

  // Export tracking
  const exportRate: ResourceMap = {};

  for (const producer of producers) {
    if (producer.key === '__base__') continue;

    const building = BUILDINGS[producer.buildingId];
    const consumer = consumerByKey.get(producer.key);
    const inputEfficiency = efficiencyByKey.get(producer.key) ?? 1;

    // Build diagnostics — use consumer demand (already zone-reduced) for required
    const inputDiagnostics: InputDiagnostic[] = [];
    if (consumer) {
      for (const res of Object.keys(building.inputs)) {
        const required = consumer.demand[res] || 0;
        const received = consumer.received[res] || 0;
        const distLoss = consumer.distanceLoss[res] || 0;
        const satisfaction = required > 0 ? Math.min(1, received / required) : 1;
        const shortage = Math.max(0, required - received - distLoss);
        inputDiagnostics.push({ resource: res, required, available: received, distanceLoss: distLoss, inputShortage: shortage, satisfaction });
      }
    }

    // Potential and realized output
    const potential: ResourceMap = {};
    const realized: ResourceMap = {};
    const consumed: ResourceMap = {};

    for (const [res, potAmount] of Object.entries(producer.potential)) {
      potential[res] = potAmount;
      addToMap(summary.potential, res, potAmount);
      const realAmount = potAmount * inputEfficiency;
      realized[res] = realAmount;
      addToMap(summary.realized, res, realAmount);
    }

    if (consumer) {
      for (const res of Object.keys(building.inputs)) {
        const consumedAmount = (consumer.demand[res] || 0) * inputEfficiency;
        consumed[res] = consumedAmount;
        addToMap(summary.consumed, res, consumedAmount);
      }
    }

    for (const diag of inputDiagnostics) {
      addToMap(summary.lostToDistance, diag.resource, diag.distanceLoss);
      addToMap(summary.lostToShortage, diag.resource, diag.inputShortage);
    }

    // Export port / trade depot: compute export efficiency for all exporters
    let buildingExportEff = 0;
    const buildingExports: ResourceMap = {};
    if (producer.buildingId === 'export_port' || producer.buildingId === 'trade_depot') {
      buildingExportEff = getExportEfficiency(producer.key, grid, infraEdges, getTerrains);
    }
    // Export port: track exports based on consumed goods * export efficiency
    if (producer.buildingId === 'export_port' && consumer) {
      if (buildingExportEff > 0 && inputEfficiency > 0) {
        const goodsConsumed = consumed['goods'] || 0;
        if (goodsConsumed > 0) {
          const exported = goodsConsumed * buildingExportEff;
          addToMap(exportRate, 'goods', exported);
          buildingExports['goods'] = exported;
        }
      }
    }

    const flowState: BuildingFlowState = {
      potential, realized, consumed, inputDiagnostics, efficiency: inputEfficiency,
      clusterBonus: producer.clusterBonus,
      clusterSize: producer.clusterSize,
      zoneOutputBonus: producer.zoneOutputBonus,
      zoneInputReduction: producer.zoneInputReduction,
      exports: buildingExports,
      exportEfficiency: buildingExportEff,
    };
    nextGrid[producer.key] = { ...nextGrid[producer.key], flowState };
  }

  // === PASS 3: Feed construction sites ===
  // Construction sites get: leftover from operating allocation + reserved fraction + recycled excess
  const siteProducerRemaining: Map<ProducerState, Record<string, number>> = new Map();
  for (const p of producers) {
    if (p.key === '__base__') {
      siteProducerRemaining.set(p, { ...p.remaining });
      continue;
    }
    const eff = efficiencyByKey.get(p.key) ?? 1;
    const rem: Record<string, number> = {};
    for (const res of Object.keys(p.potential)) {
      const reserved = hasConstructionSites ? p.potential[res] * eff * CONSTRUCTION_RESERVE : 0;
      rem[res] = Math.max(0, p.remaining[res] || 0) + reserved;
    }
    siteProducerRemaining.set(p, rem);
  }

  // Compute recycled capacity: resources allocated to consumers but not actually consumed
  // (e.g. a workshop at 60% efficiency received full stone but only consumed 60%)
  const recycledSources: { hex: HexData; remaining: Record<string, number> }[] = [];
  for (const c of consumers) {
    const eff = efficiencyByKey.get(c.key) ?? 1;
    const excess: Record<string, number> = {};
    let hasExcess = false;

    for (const res of Object.keys(c.received)) {
      const received = c.received[res] || 0;
      if (received <= 0.001) continue;

      const consumedAmt = (c.demand[res] || 0) * eff;
      const e = received - consumedAmt;
      if (e > 0.001) {
        excess[res] = e;
        hasExcess = true;
      }
    }

    if (hasExcess) {
      recycledSources.push({ hex: c.hex, remaining: excess });
    }
  }

  for (const { hex, key } of constructionSites) {
    const site = hex.constructionSite!;
    const newDelivered = { ...site.delivered };

    for (const [res, totalNeeded] of Object.entries(site.totalCost)) {
      const alreadyDelivered = newDelivered[res] || 0;
      const stillNeeded = totalNeeded - alreadyDelivered;
      if (stillNeeded <= 0) continue;

      const pairs: { remaining: Record<string, number>; pathCost: number; transferEff: number }[] = [];
      // Real producers
      for (const p of (producersByRes[res] || [])) {
        const rem = siteProducerRemaining.get(p);
        if (!rem || (rem[res] || 0) <= 0) continue;
        const isBase = p.key === '__base__';
        const pathCost = isBase ? 0 : getCachedPathCost(p.hex, hex);
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
        if (transferEff <= 0) continue;
        pairs.push({ remaining: rem, pathCost, transferEff });
      }
      // Recycled sources from over-allocated consumers
      for (const rs of recycledSources) {
        if ((rs.remaining[res] || 0) <= 0) continue;
        const pathCost = getCachedPathCost(rs.hex, hex);
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
        if (transferEff <= 0) continue;
        pairs.push({ remaining: rs.remaining, pathCost, transferEff });
      }
      pairs.sort((a, b) => a.pathCost - b.pathCost);

      let received = 0;
      for (const { remaining: rem, transferEff } of pairs) {
        const available = rem[res] || 0;
        if (available <= 0 || received >= stillNeeded) break;
        const deficit = stillNeeded - received;
        const rawNeeded = transferEff > 0 ? deficit / transferEff : deficit;
        const canSend = Math.min(available, rawNeeded);
        const delivered = canSend * transferEff;
        received += delivered;
        rem[res] -= canSend;
      }

      newDelivered[res] = alreadyDelivered + received;
    }

    const allComplete = Object.entries(site.totalCost).every(
      ([res, needed]) => (newDelivered[res] || 0) >= needed - 0.01
    );

    if (allComplete) {
      nextGrid[key] = {
        ...nextGrid[key],
        buildingId: site.targetBuildingId,
        constructionSite: undefined,
        flowState: undefined,
      };
    } else {
      nextGrid[key] = {
        ...nextGrid[key],
        constructionSite: { ...site, delivered: newDelivered },
      };
    }
  }

  // === PASS 3b: Feed infra edge construction sites ===
  const nextInfraEdges = { ...infraEdges };
  const nextInfraConstructionSites: InfraEdgeConstructionSite[] = [];
  for (const site of infraConstructionSites) {
    const newDelivered = { ...site.delivered };
    // Use hexA as delivery target
    const deliveryHex = grid[hexKey(site.hexA.q, site.hexA.r)];

    for (const [res, totalNeeded] of Object.entries(site.totalCost)) {
      const alreadyDelivered = newDelivered[res] || 0;
      const stillNeeded = totalNeeded - alreadyDelivered;
      if (stillNeeded <= 0) continue;

      const pairs: { remaining: Record<string, number>; pathCost: number; transferEff: number }[] = [];
      for (const p of (producersByRes[res] || [])) {
        const rem = siteProducerRemaining.get(p);
        if (!rem || (rem[res] || 0) <= 0) continue;
        const isBase = p.key === '__base__';
        const pathCost = isBase ? 0 : (deliveryHex ? getCachedPathCost(p.hex, deliveryHex) : Infinity);
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
        if (transferEff <= 0) continue;
        pairs.push({ remaining: rem, pathCost, transferEff });
      }
      for (const rs of recycledSources) {
        if ((rs.remaining[res] || 0) <= 0) continue;
        if (!deliveryHex) continue;
        const pathCost = getCachedPathCost(rs.hex, deliveryHex);
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
        if (transferEff <= 0) continue;
        pairs.push({ remaining: rs.remaining, pathCost, transferEff });
      }
      pairs.sort((a, b) => a.pathCost - b.pathCost);

      let received = 0;
      for (const { remaining: rem, transferEff } of pairs) {
        const available = rem[res] || 0;
        if (available <= 0 || received >= stillNeeded) break;
        const deficit = stillNeeded - received;
        const rawNeeded = transferEff > 0 ? deficit / transferEff : deficit;
        const canSend = Math.min(available, rawNeeded);
        const delivered = canSend * transferEff;
        received += delivered;
        rem[res] -= canSend;
      }

      newDelivered[res] = alreadyDelivered + received;
    }

    const allComplete = Object.entries(site.totalCost).every(
      ([res, needed]) => (newDelivered[res] || 0) >= needed - 0.01
    );

    if (allComplete) {
      nextInfraEdges[site.edgeKey] = { type: site.targetType };
    } else {
      nextInfraConstructionSites.push({ ...site, delivered: newDelivered });
    }
  }

  // === PASS 4: Trade Depot surplus absorption ===
  // Operating trade depots with map-edge access absorb remaining surplus and export it
  for (const producer of producers) {
    if (producer.key === '__base__' || producer.buildingId !== 'trade_depot') continue;
    const eff = efficiencyByKey.get(producer.key) ?? 0;
    if (eff <= 0) continue;

    const depotExportEff = getExportEfficiency(producer.key, grid, infraEdges, getTerrains);
    if (depotExportEff <= 0) continue;

    const depotExports: ResourceMap = {};

    for (const res of ALL_EXPORTABLE_RESOURCES) {
      // Collect from siteProducerRemaining (already depleted by Pass 3)
      const resPairs: { remaining: Record<string, number>; pathCost: number; transferEff: number }[] = [];
      for (const p of (producersByRes[res] || [])) {
        const rem = siteProducerRemaining.get(p);
        if (!rem || (rem[res] || 0) <= 0) continue;
        const isBase = p.key === '__base__';
        const pathCost = isBase ? 0 : getCachedPathCost(p.hex, producer.hex);
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
        if (transferEff <= 0) continue;
        resPairs.push({ remaining: rem, pathCost, transferEff });
      }
      // Also pull from recycled sources
      for (const rs of recycledSources) {
        if ((rs.remaining[res] || 0) <= 0) continue;
        const pathCost = getCachedPathCost(rs.hex, producer.hex);
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.15);
        if (transferEff <= 0) continue;
        resPairs.push({ remaining: rs.remaining, pathCost, transferEff });
      }
      resPairs.sort((a, b) => a.pathCost - b.pathCost);

      let totalReceived = 0;
      for (const { remaining: rem, transferEff } of resPairs) {
        const available = rem[res] || 0;
        if (available <= 0) continue;
        const delivered = available * transferEff;
        totalReceived += delivered;
        rem[res] = 0;
      }

      if (totalReceived > 0) {
        const exported = totalReceived * depotExportEff;
        addToMap(exportRate, res, exported);
        depotExports[res] = exported;
      }
    }

    // Update flowState for this trade depot
    const existingFlowState = nextGrid[producer.key]?.flowState;
    if (existingFlowState) {
      nextGrid[producer.key] = {
        ...nextGrid[producer.key],
        flowState: { ...existingFlowState, exports: depotExports, exportEfficiency: depotExportEff },
      };
    }
  }

  return { grid: nextGrid, flowSummary: summary, exportRate, infraEdges: nextInfraEdges, infraConstructionSites: nextInfraConstructionSites };
}
