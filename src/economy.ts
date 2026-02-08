import { HexData, TerrainHex, ResourceMap, FlowSummary, BuildingFlowState, InputDiagnostic } from './types';
import { BUILDINGS } from './constants';
import { hexKey, getNeighbors } from './hexUtils';

type PathCostFn = (start: HexData, end: HexData, grid: Record<string, HexData>) => number;

interface ProducerState {
  hex: HexData;
  key: string;
  buildingId: string;
  potential: Record<string, number>; // max output at 100% efficiency
  remaining: Record<string, number>; // remaining capacity this iteration
  adjacencyBonus: number; // 0.1 per identical neighbor
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

export function simulateTick(
  grid: Record<string, HexData>,
  terrainGrid: Record<string, TerrainHex>,
  getPathCost: PathCostFn,
): { grid: Record<string, HexData>; flowSummary: FlowSummary } {
  const nextGrid: Record<string, HexData> = {};
  for (const key of Object.keys(grid)) {
    nextGrid[key] = { ...grid[key] };
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
    adjacencyBonus: 0,
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

    // Adjacency bonus
    const neighbors = getNeighbors(hex.q, hex.r);
    let adjacencyBonus = 0;
    for (const n of neighbors) {
      const nHex = grid[hexKey(n.q, n.r)];
      if (nHex && nHex.buildingId === buildingId) adjacencyBonus += 0.1;
    }
    if (adjacencyBonus > 0) {
      for (const [res, amount] of Object.entries(building.outputs)) {
        potential[res] = (potential[res] || 0) + (amount as number) * adjacencyBonus;
      }
    }

    // Start with remaining = full potential (will be refined by iteration)
    const remaining: Record<string, number> = { ...potential };

    producers.push({ hex, key, buildingId, potential, remaining, adjacencyBonus });

    // Consumer state
    const demand: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.inputs)) {
      demand[res] = amount as number;
    }

    if (Object.keys(demand).length > 0) {
      consumers.push({ hex, key, buildingId, prioritized: !!hex.prioritized, demand, received: {}, distanceLoss: {} });
    }
  }

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
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.1);
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
  const hasConstructionSites = constructionSites.length > 0;
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
      const hasOutputDemand = Object.keys(producer.potential).some(res => demandedResources.has(res));
      if (!hasOutputDemand) {
        efficiencyByKey.set(producer.key, 0);
        continue;
      }

      const building = BUILDINGS[producer.buildingId];
      const consumer = consumerByKey.get(producer.key);

      let inputEfficiency = 1.0;
      if (consumer) {
        for (const [res, amount] of Object.entries(building.inputs)) {
          const required = amount as number;
          const received = consumer.received[res] || 0;
          const satisfaction = required > 0 ? Math.min(1, received / required) : 1;
          if (satisfaction < inputEfficiency) inputEfficiency = satisfaction;
        }
      }

      efficiencyByKey.set(producer.key, inputEfficiency);
    }
  }

  // === After convergence: compute final summary and flowState ===
  const summary = emptyFlowSummary();
  addToMap(summary.potential, 'population', BASE_POPULATION);
  addToMap(summary.realized, 'population', BASE_POPULATION);

  for (const producer of producers) {
    if (producer.key === '__base__') continue;

    const building = BUILDINGS[producer.buildingId];
    const consumer = consumerByKey.get(producer.key);
    const inputEfficiency = efficiencyByKey.get(producer.key) ?? 1;

    // Build diagnostics
    const inputDiagnostics: InputDiagnostic[] = [];
    if (consumer) {
      for (const [res, amount] of Object.entries(building.inputs)) {
        const required = amount as number;
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
      for (const [res, amount] of Object.entries(building.inputs)) {
        const consumedAmount = (amount as number) * inputEfficiency;
        consumed[res] = consumedAmount;
        addToMap(summary.consumed, res, consumedAmount);
      }
    }

    for (const diag of inputDiagnostics) {
      addToMap(summary.lostToDistance, diag.resource, diag.distanceLoss);
      addToMap(summary.lostToShortage, diag.resource, diag.inputShortage);
    }

    const flowState: BuildingFlowState = {
      potential, realized, consumed, inputDiagnostics, efficiency: inputEfficiency,
      adjacencyBonus: producer.adjacencyBonus,
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

      const consumed = (c.demand[res] || 0) * eff;
      const e = received - consumed;
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
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.1);
        if (transferEff <= 0) continue;
        pairs.push({ remaining: rem, pathCost, transferEff });
      }
      // Recycled sources from over-allocated consumers
      for (const rs of recycledSources) {
        if ((rs.remaining[res] || 0) <= 0) continue;
        const pathCost = getCachedPathCost(rs.hex, hex);
        if (pathCost === Infinity) continue;
        const transferEff = pathCost <= 1 ? 1.0 : Math.max(0, 1.0 - (pathCost - 1) * 0.1);
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

  return { grid: nextGrid, flowSummary: summary };
}
