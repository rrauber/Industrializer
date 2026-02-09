import React, { useState, useEffect, useMemo } from 'react';
import { HexData, TerrainHex, GameState, ResourceType, TerrainType, InfrastructureType, FlowSummary, ConstructionSite, InfraEdgeConstructionSite, ZoneType, BonusZone } from './types';
import { hexKey, getEdgeKey, parseEdgeKey, pointyHexToPixel, pixelToPointyHex, getHexCorners, getNeighbors, countHexConnections, getHexesInRadius } from './hexUtils';
import { BUILDINGS, INFRASTRUCTURE_COSTS, MAX_INFRA_CONNECTIONS, TERRAIN_COLORS, ZONE_TYPES, ZONE_RADIUS, MAX_ZONES_PER_TYPE, ERA_MILESTONES } from './constants';
import { simulateTick } from './economy';
import { Zap, Info } from 'lucide-react';

const LARGE_HEX_SIZE = 50;
const HEX_SIZE = LARGE_HEX_SIZE / 2;
const TERRAIN_RADIUS = 5;
const GRID_RADIUS = 2 * TERRAIN_RADIUS + 1;

const BUILDING_OFFSET_X = 0;
const BUILDING_OFFSET_Y = -HEX_SIZE;
const BUILDING_ROT_ANGLE = 0;

function emptyFlowSummary(): FlowSummary {
  return { potential: {}, realized: {}, consumed: {}, lostToDistance: {}, lostToShortage: {} };
}

// All resource types to display
const ALL_RESOURCES: ResourceType[] = ['food', 'wood', 'stone', 'iron_ore', 'coal', 'iron_ingot', 'tools', 'concrete', 'steel', 'machinery', 'goods', 'population'];

const RESOURCE_COLORS: Record<string, string> = {
  food: '#7cb342', wood: '#33691e', stone: '#8d6e63', iron_ore: '#a1887f',
  coal: '#616161', iron_ingot: '#ef6c00', tools: '#1976d2', concrete: '#78909c',
  steel: '#455a64', machinery: '#5c6bc0', goods: '#8e24aa', population: '#ff7043',
};

const BUILDING_COLORS: Record<string, string> = {
  // Agricultural — warm green
  forager: '#8aba6a', farm: '#8aba6a',
  wood_camp: '#8aba6a', lumber_mill: '#8aba6a',
  // Mining — warm tan/amber
  stone_camp: '#c4a46a', quarry: '#c4a46a',
  surface_mine: '#c4a46a', surface_coal: '#c4a46a',
  iron_mine: '#c4a46a', coal_mine: '#c4a46a',
  // Industrial — cool slate blue
  bloomery: '#7a9ab5', smelter: '#7a9ab5',
  workshop: '#7a9ab5', tool_factory: '#7a9ab5',
  concrete_factory: '#7a9ab5', steel_mill: '#7a9ab5',
  machine_works: '#7a9ab5', manufactory: '#7a9ab5',
  // Trade — warm gold
  export_port: '#d4aa4f', trade_depot: '#d4aa4f',
  // Residential — warm peach
  settlement: '#d4937a', town: '#d4937a', city: '#d4937a',
};

const BUILDING_LABELS: Record<string, string> = {
  forager: 'FRG', wood_camp: 'WOD', stone_camp: 'STN', workshop: 'WRK',
  surface_mine: 'sFe', surface_coal: 'sCo', bloomery: 'BLM',
  farm: 'FRM', lumber_mill: 'SAW', quarry: 'QRY',
  iron_mine: 'Fe', coal_mine: 'Co',
  smelter: 'SMT', tool_factory: 'TLS',
  concrete_factory: 'CON', steel_mill: 'STL',
  machine_works: 'MCH', manufactory: 'MFG',
  export_port: 'EXP', trade_depot: 'TRD',
  settlement: 'SET', town: 'TWN', city: 'CTY',
};

interface SupplyRisk {
  resource: string;
  currentNet: number;
  additionalDemand: number;
  depth: number;
}

function analyzeSupplyRisks(
  targetInputs: Partial<Record<ResourceType, number>>,
  currentInputs: Partial<Record<ResourceType, number>> | undefined,
  flowSummary: FlowSummary,
  era: number,
): SupplyRisk[] {
  const risks: SupplyRisk[] = [];
  const checked = new Set<string>();

  const queue: { resource: string; demand: number; depth: number }[] = [];

  for (const [res, amount] of Object.entries(targetInputs)) {
    const oldAmount = currentInputs?.[res as ResourceType] || 0;
    const additional = (amount as number) - oldAmount;
    if (additional > 0.01) {
      queue.push({ resource: res, demand: additional, depth: 0 });
    }
  }

  while (queue.length > 0) {
    const { resource, demand, depth } = queue.shift()!;
    if (checked.has(resource)) continue;
    checked.add(resource);

    // Skip population — base trickle prevents true deadlocks
    if (resource === 'population') continue;

    const realized = flowSummary.realized[resource] || 0;
    const consumed = flowSummary.consumed[resource] || 0;
    const surplus = realized - consumed;

    if (surplus >= demand - 0.01) continue; // sufficient supply

    risks.push({ resource, currentNet: surplus, additionalDemand: demand, depth });

    // If this resource isn't being produced, recurse into what could produce it
    if (realized < 0.01) {
      const producers = Object.values(BUILDINGS)
        .filter(b => (b.outputs[resource as ResourceType] || 0) > 0 && b.unlockEra <= era)
        .sort((a, b) => a.unlockEra - b.unlockEra);

      if (producers.length > 0) {
        for (const [res, amount] of Object.entries(producers[0].inputs)) {
          if ((amount as number) > 0.001 && !checked.has(res)) {
            queue.push({ resource: res, demand: amount as number, depth: depth + 1 });
          }
        }
      }
    }
  }

  return risks;
}

function renderSupplyWarnings(risks: SupplyRisk[]) {
  if (risks.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {risks.map(risk => (
        <div key={risk.resource} className="text-[11px] text-amber-400 font-mono" style={{ paddingLeft: risk.depth * 10 }}>
          {risk.depth > 0 ? '\u21b3 ' : '\u26a0 '}
          <span className="capitalize">{risk.resource.replace('_', ' ')}</span>
          {': '}
          {risk.currentNet < 0.01
            ? 'not produced'
            : `surplus ${risk.currentNet.toFixed(1)}/s, need +${risk.additionalDemand.toFixed(1)}/s`}
        </div>
      ))}
    </div>
  );
}

function migrateOldSave(parsed: any): GameState {
  const grid = parsed.grid || {};
  // Ensure building grid covers full terrain extent
  for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
    const r1 = Math.max(-GRID_RADIUS, -q - GRID_RADIUS);
    const r2 = Math.min(GRID_RADIUS, -q + GRID_RADIUS);
    for (let r = r1; r <= r2; r++) {
      const key = hexKey(q, r);
      if (!grid[key]) grid[key] = { q, r };
    }
  }

  // Migrate hasRoad → infrastructure, adjacencyBonus → clusterBonus
  for (const key of Object.keys(grid)) {
    const hex = grid[key];
    if (hex.hasRoad) {
      hex.infrastructure = 'road';
      delete hex.hasRoad;
    }
    if (hex.flowState && 'adjacencyBonus' in hex.flowState) {
      hex.flowState.clusterBonus = hex.flowState.adjacencyBonus;
      hex.flowState.clusterSize = 1;
      delete hex.flowState.adjacencyBonus;
    }
    // Strip old fields
    delete hex.lastEfficiency;
    delete hex.inputEfficiencies;
  }

  // Migrate per-hex infrastructure to edge-based infrastructure
  let infraEdges: Record<string, { type: InfrastructureType }> = parsed.infraEdges || {};
  let infraConstructionSites = parsed.infraConstructionSites || [];
  if (!parsed.infraEdges) {
    // Scan all hexes for old infrastructure field and create edges
    const infraHexes = Object.entries(grid).filter(([, h]: [string, any]) => h.infrastructure);
    for (const [, hex] of infraHexes as [string, any][]) {
      for (const n of getNeighbors(hex.q, hex.r)) {
        const nk = hexKey(n.q, n.r);
        const nHex = grid[nk];
        if (nHex && (nHex as any).infrastructure) {
          const ek = getEdgeKey(hex.q, hex.r, n.q, n.r);
          if (!infraEdges[ek]) {
            // Use the slower (worse) type of the two connected hexes
            const INFRA_ORDER: Record<string, number> = { road: 2, rail: 1, canal: 0 };
            const hexType = hex.infrastructure as InfrastructureType;
            const nType = (nHex as any).infrastructure as InfrastructureType;
            const type = (INFRA_ORDER[hexType] ?? 2) >= (INFRA_ORDER[nType] ?? 2) ? hexType : nType;
            infraEdges[ek] = { type };
          }
        }
      }
    }
    // Delete infrastructure from all hexes and cancel old infra construction sites
    for (const key of Object.keys(grid)) {
      delete (grid[key] as any).infrastructure;
      if (grid[key].constructionSite && (grid[key].constructionSite as any).targetInfrastructure) {
        delete grid[key].constructionSite;
      }
    }
  }

  return {
    flowSummary: parsed.flowSummary || emptyFlowSummary(),
    grid,
    terrainGrid: parsed.terrainGrid,
    infraEdges,
    infraConstructionSites,
    era: parsed.era || 1,
    tick: parsed.tick || 0,
    showNetwork: parsed.showNetwork,
    totalExports: parsed.totalExports || {},
    exportRate: parsed.exportRate || {},
    zones: parsed.zones || [],
  };
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(() => {
    const saved = localStorage.getItem('industrializer_save');
    const resetPending = sessionStorage.getItem('industrializer_reset');

    if (saved && !resetPending) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.terrainGrid && Object.keys(parsed.terrainGrid).length > 0) {
          return migrateOldSave(parsed);
        }
      } catch (e) {
        console.error("Failed to load save", e);
      }
    }

    if (resetPending) sessionStorage.removeItem('industrializer_reset');

    const terrainGrid: Record<string, TerrainHex> = {};
    for (let q = -TERRAIN_RADIUS; q <= TERRAIN_RADIUS; q++) {
      const r1 = Math.max(-TERRAIN_RADIUS, -q - TERRAIN_RADIUS);
      const r2 = Math.min(TERRAIN_RADIUS, -q + TERRAIN_RADIUS);
      for (let r = r1; r <= r2; r++) {
        const rand = Math.random();
        let terrain: TerrainType = 'plains';
        if (rand < 0.1) terrain = 'water';
        else if (rand < 0.3) terrain = 'forest';
        else if (rand < 0.5) terrain = 'mountain';
        terrainGrid[hexKey(q, r)] = { q, r, terrain };
      }
    }

    const grid: Record<string, HexData> = {};
    for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q++) {
      const r1 = Math.max(-GRID_RADIUS, -q - GRID_RADIUS);
      const r2 = Math.min(GRID_RADIUS, -q + GRID_RADIUS);
      for (let r = r1; r <= r2; r++) {
        grid[hexKey(q, r)] = { q, r };
      }
    }

    return {
      flowSummary: emptyFlowSummary(),
      grid,
      terrainGrid,
      infraEdges: {},
      infraConstructionSites: [],
      era: 1,
      tick: 0,
      totalExports: {},
      exportRate: {},
      zones: [],
    };
  });

  useEffect(() => {
    localStorage.setItem('industrializer_save', JSON.stringify(gameState));
  }, [gameState]);

  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [hoveredHex, setHoveredHex] = useState<string | null>(null);
  const [placingZoneType, setPlacingZoneType] = useState<ZoneType | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [infraPlacementMode, setInfraPlacementMode] = useState<{
    type: InfrastructureType; fromHex: string;
  } | null>(null);

  // Zone helpers
  const getZoneHexKeys = (zone: BonusZone): Set<string> => {
    const keys = new Set<string>();
    for (const h of getHexesInRadius(zone.centerQ, zone.centerR, ZONE_RADIUS)) {
      keys.add(hexKey(h.q, h.r));
    }
    return keys;
  };

  const zonesOverlap = (cq: number, cr: number, existingZones: BonusZone[]): boolean => {
    const newHexes = new Set(getHexesInRadius(cq, cr, ZONE_RADIUS).map(h => hexKey(h.q, h.r)));
    for (const z of existingZones) {
      for (const h of getHexesInRadius(z.centerQ, z.centerR, ZONE_RADIUS)) {
        if (newHexes.has(hexKey(h.q, h.r))) return true;
      }
    }
    return false;
  };

  const placeZone = (centerQ: number, centerR: number) => {
    if (!placingZoneType) return;
    const count = gameState.zones.filter(z => z.type === placingZoneType).length;
    if (count >= MAX_ZONES_PER_TYPE) return;
    if (zonesOverlap(centerQ, centerR, gameState.zones)) return;
    const zone: BonusZone = {
      id: `${placingZoneType}_${Date.now()}`,
      type: placingZoneType,
      centerQ,
      centerR,
    };
    setGameState(prev => ({ ...prev, zones: [...prev.zones, zone] }));
    setPlacingZoneType(null);
  };

  const removeZone = (zoneId: string) => {
    setGameState(prev => ({ ...prev, zones: prev.zones.filter(z => z.id !== zoneId) }));
  };

  // Escape key cancels zone/infra placement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (placingZoneType) setPlacingZoneType(null);
        if (infraPlacementMode) setInfraPlacementMode(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [placingZoneType, infraPlacementMode]);

  const resetGame = () => {
    if (confirm('Are you sure you want to start a new game?')) {
      localStorage.removeItem('industrializer_save');
      sessionStorage.setItem('industrializer_reset', 'true');
      window.location.href = window.location.origin + window.location.pathname;
    }
  };

  const toggleNetwork = () => {
    setGameState(prev => ({ ...prev, showNetwork: !prev.showNetwork }));
  };

  const INFRA_STEP_COSTS: Record<InfrastructureType, number> = { road: 0.5, rail: 0.2, canal: 0.15 };

  const getPathCost = (start: HexData, end: HexData, grid: Record<string, HexData>, maxCost: number = 10): number => {
    const queue: { hex: HexData, cost: number }[] = [{ hex: start, cost: 0 }];
    const visited = new Set<string>();
    visited.add(hexKey(start.q, start.r));
    if (start.q === end.q && start.r === end.r) return 0;

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const { hex: current, cost } = queue.shift()!;
      if (cost > maxCost) continue;
      if (current.q === end.q && current.r === end.r) return cost;

      for (const n of getNeighbors(current.q, current.r)) {
        const nKey = hexKey(n.q, n.r);
        if (visited.has(nKey)) continue;
        const nHex = grid[nKey];
        if (!nHex) continue;
        // Edge-based infrastructure: look up the edge between current and neighbor
        const ek = getEdgeKey(current.q, current.r, n.q, n.r);
        const edge = gameState.infraEdges[ek];
        const stepCost = edge ? INFRA_STEP_COSTS[edge.type] : 1.0;
        const newCost = cost + stepCost;
        if (newCost <= maxCost) {
          visited.add(nKey);
          queue.push({ hex: nHex, cost: newCost });
        }
      }
    }
    return Infinity;
  };

  const getAssociatedTerrains = (q: number, r: number): TerrainType[] => {
    const { x: raw_x, y: raw_y } = pointyHexToPixel(q, r, HEX_SIZE);
    const base_x = raw_x * Math.cos(BUILDING_ROT_ANGLE) - raw_y * Math.sin(BUILDING_ROT_ANGLE);
    const base_y = raw_x * Math.sin(BUILDING_ROT_ANGLE) + raw_y * Math.cos(BUILDING_ROT_ANGLE);
    const x = base_x + BUILDING_OFFSET_X;
    const y = base_y + BUILDING_OFFSET_Y;
    const tHexCoord = pixelToPointyHex(x, y, LARGE_HEX_SIZE);
    const terrains = new Set<TerrainType>();

    [tHexCoord, ...getNeighbors(tHexCoord.q, tHexCoord.r)].forEach(c => {
      const terrainHex = gameState.terrainGrid[hexKey(c.q, c.r)];
      if (terrainHex) {
        const { x: tx, y: ty } = pointyHexToPixel(c.q, c.r, LARGE_HEX_SIZE);
        const dist = Math.sqrt((x - tx) ** 2 + (y - ty) ** 2);
        if (dist < LARGE_HEX_SIZE * 1.05) terrains.add(terrainHex.terrain);
      }
    });
    return Array.from(terrains);
  };

  // Tick loop using the economy engine
  useEffect(() => {
    const interval = setInterval(() => {
      setGameState(prev => {
        const { grid, flowSummary, exportRate, infraEdges, infraConstructionSites } = simulateTick(
          prev.grid, prev.terrainGrid, getPathCost, getAssociatedTerrains, prev.zones,
          prev.infraEdges, prev.infraConstructionSites
        );
        // Accumulate exports
        const totalExports = { ...prev.totalExports };
        for (const [res, amount] of Object.entries(exportRate)) {
          totalExports[res] = (totalExports[res] || 0) + amount;
        }
        // Auto-advance era based on cumulative export milestones
        let era = prev.era;
        while (era < 6 && ERA_MILESTONES[era + 1]) {
          const milestone = ERA_MILESTONES[era + 1];
          const met = Object.entries(milestone.requirements).every(
            ([res, needed]) => (totalExports[res] || 0) >= (needed as number)
          );
          if (met) era++;
          else break;
        }
        return { ...prev, grid, flowSummary, era, tick: prev.tick + 1, exportRate, totalExports, infraEdges, infraConstructionSites };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const buildBuilding = (buildingId: string) => {
    if (!selectedHex) return;
    const building = BUILDINGS[buildingId];
    const hex = gameState.grid[selectedHex];

    // Create construction site
    const totalCost: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.cost)) {
      totalCost[res] = amount as number;
    }

    // If building has no cost, place it instantly
    if (Object.keys(totalCost).length === 0) {
      setGameState(prev => ({
        ...prev,
        grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId } },
      }));
      return;
    }

    const delivered: Record<string, number> = {};
    for (const res of Object.keys(totalCost)) {
      delivered[res] = 0;
    }

    const constructionSite: ConstructionSite = {
      targetBuildingId: buildingId,
      totalCost,
      delivered,
      isUpgrade: false,
    };

    setGameState(prev => ({
      ...prev,
      grid: { ...prev.grid, [selectedHex]: { ...hex, constructionSite } },
    }));
  };

  const startInfraPlacement = (type: InfrastructureType) => {
    if (!selectedHex) return;
    setInfraPlacementMode({ type, fromHex: selectedHex });
  };

  const completeInfraPlacement = (toHexKey: string) => {
    if (!infraPlacementMode) return;
    const { type, fromHex } = infraPlacementMode;
    const fromCoords = fromHex.split(',').map(Number);
    const toCoords = toHexKey.split(',').map(Number);
    const fromQ = fromCoords[0], fromR = fromCoords[1];
    const toQ = toCoords[0], toR = toCoords[1];

    // 1. Adjacency check
    const neighbors = getNeighbors(fromQ, fromR);
    if (!neighbors.some(n => n.q === toQ && n.r === toR)) {
      setInfraPlacementMode(null);
      return;
    }

    const ek = getEdgeKey(fromQ, fromR, toQ, toR);
    const existingEdge = gameState.infraEdges[ek];

    // 2. No same-type edge already exists (allow upgrade to better type)
    if (existingEdge && existingEdge.type === type) {
      setInfraPlacementMode(null);
      return;
    }

    // 3. Both hexes < MAX_INFRA_CONNECTIONS (excluding existing edge between them if upgrading)
    const fromConns = countHexConnections(fromQ, fromR, gameState.infraEdges);
    const toConns = countHexConnections(toQ, toR, gameState.infraEdges);
    const alreadyConnected = existingEdge ? 1 : 0;
    if (fromConns - alreadyConnected >= MAX_INFRA_CONNECTIONS || toConns - alreadyConnected >= MAX_INFRA_CONNECTIONS) {
      setInfraPlacementMode(null);
      return;
    }

    // 4. Network connectivity: first segment ever OR at least one hex already in network (canals exempt)
    if (type !== 'canal') {
      const totalEdges = Object.keys(gameState.infraEdges).length;
      if (totalEdges > 0 && !alreadyConnected) {
        const fromInNetwork = countHexConnections(fromQ, fromR, gameState.infraEdges) > 0;
        const toInNetwork = countHexConnections(toQ, toR, gameState.infraEdges) > 0;
        if (!fromInNetwork && !toInNetwork) {
          setInfraPlacementMode(null);
          return;
        }
      }
    }

    // 5. No pending construction site for this edge
    if (gameState.infraConstructionSites.some(s => s.edgeKey === ek)) {
      setInfraPlacementMode(null);
      return;
    }

    const costs = INFRASTRUCTURE_COSTS[type];
    const isUpgrade = !!existingEdge;

    // Instant for road (no cost), construction site for rail/canal
    if (Object.keys(costs).length === 0) {
      setGameState(prev => ({
        ...prev,
        infraEdges: { ...prev.infraEdges, [ek]: { type } },
      }));
    } else {
      const totalCost: Record<string, number> = {};
      for (const [res, amount] of Object.entries(costs)) {
        totalCost[res] = amount as number;
      }
      const delivered: Record<string, number> = {};
      for (const res of Object.keys(totalCost)) {
        delivered[res] = 0;
      }
      const site: InfraEdgeConstructionSite = {
        edgeKey: ek,
        hexA: { q: fromQ, r: fromR },
        hexB: { q: toQ, r: toR },
        targetType: type,
        totalCost,
        delivered,
        isUpgrade,
        previousType: existingEdge?.type,
      };
      setGameState(prev => ({
        ...prev,
        infraConstructionSites: [...prev.infraConstructionSites, site],
      }));
    }

    setInfraPlacementMode(null);
  };

  const demolishInfraEdge = (edgeKey: string) => {
    setGameState(prev => {
      // Remove completed edge
      const newEdges = { ...prev.infraEdges };
      delete newEdges[edgeKey];
      // Remove any pending construction site for this edge
      const newSites = prev.infraConstructionSites.filter(s => s.edgeKey !== edgeKey);
      return { ...prev, infraEdges: newEdges, infraConstructionSites: newSites };
    });
  };

  const upgradeBuilding = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    if (!hex.buildingId) return;
    const building = BUILDINGS[hex.buildingId];
    if (!building.upgradesTo || !building.upgradeCost) return;

    const totalCost: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.upgradeCost)) {
      totalCost[res] = amount as number;
    }

    const delivered: Record<string, number> = {};
    for (const res of Object.keys(totalCost)) {
      delivered[res] = 0;
    }

    // If upgrade has no cost, do it instantly
    if (Object.keys(totalCost).length === 0) {
      setGameState(prev => ({
        ...prev,
        grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId: building.upgradesTo } },
      }));
      return;
    }

    const constructionSite: ConstructionSite = {
      targetBuildingId: building.upgradesTo,
      totalCost,
      delivered,
      isUpgrade: true,
      previousBuildingId: hex.buildingId,
    };

    setGameState(prev => ({
      ...prev,
      grid: { ...prev.grid, [selectedHex]: { ...hex, constructionSite } },
    }));
  };

  const togglePriority = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    setGameState(prev => ({
      ...prev,
      grid: { ...prev.grid, [selectedHex]: { ...hex, prioritized: !hex.prioritized } },
    }));
  };

  const demolishBuilding = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    setGameState(prev => ({
      ...prev,
      grid: {
        ...prev.grid,
        [selectedHex]: { ...hex, buildingId: undefined, constructionSite: undefined, flowState: undefined },
      },
    }));
  };

  const getConstructionProgress = (site: ConstructionSite): number => {
    let totalNeeded = 0;
    let totalDelivered = 0;
    for (const [res, amount] of Object.entries(site.totalCost)) {
      totalNeeded += amount;
      totalDelivered += Math.min(site.delivered[res] || 0, amount);
    }
    return totalNeeded > 0 ? totalDelivered / totalNeeded : 1;
  };

  // Compute contiguous same-type building clusters for visual merging
  const clusterInfo = useMemo(() => {
    const sameTypeEdges = new Set<string>();
    const labelHex = new Map<string, string>();
    const visited = new Set<string>();
    const directions = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    ];

    for (const [key, hex] of Object.entries(gameState.grid)) {
      if (!hex.buildingId || hex.constructionSite || visited.has(key)) continue;
      // BFS to find all contiguous same-type members
      const cluster: string[] = [];
      const queue = [key];
      visited.add(key);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        cluster.push(cur);
        const curHex = gameState.grid[cur];
        for (const d of directions) {
          const nq = curHex.q + d.q;
          const nr = curHex.r + d.r;
          const nk = hexKey(nq, nr);
          if (visited.has(nk)) continue;
          const nHex = gameState.grid[nk];
          if (nHex && nHex.buildingId === hex.buildingId && !nHex.constructionSite) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }

      // Mark internal edges (edge index i faces neighbor at directions[5-i])
      for (const memberKey of cluster) {
        const mHex = gameState.grid[memberKey];
        for (let i = 0; i < 6; i++) {
          const nd = directions[5 - i];
          const nq = mHex.q + nd.q;
          const nr = mHex.r + nd.r;
          const nk = hexKey(nq, nr);
          if (cluster.includes(nk)) {
            sameTypeEdges.add(`${memberKey}|${i}`);
          }
        }
      }

      // Label hex: member closest to geometric centroid
      if (cluster.length === 1) {
        labelHex.set(cluster[0], cluster[0]);
      } else {
        let cx = 0, cy = 0;
        const positions = cluster.map(k => {
          const h = gameState.grid[k];
          const pos = pointyHexToPixel(h.q, h.r, HEX_SIZE);
          cx += pos.x;
          cy += pos.y;
          return { key: k, x: pos.x, y: pos.y };
        });
        cx /= cluster.length;
        cy /= cluster.length;
        let bestKey = cluster[0];
        let bestDist = Infinity;
        for (const p of positions) {
          const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
          if (d < bestDist) { bestDist = d; bestKey = p.key; }
        }
        for (const k of cluster) {
          labelHex.set(k, bestKey);
        }
      }
    }

    return { sameTypeEdges, labelHex };
  }, [gameState.grid]);

  const terrainCorners = getHexCorners({ x: 0, y: 0 }, LARGE_HEX_SIZE, 30);
  const terrainCornersStr = terrainCorners.map(p => `${p.x},${p.y}`).join(' ');

  const renderTerrainHex = (hex: TerrainHex) => {
    const { x, y } = pointyHexToPixel(hex.q, hex.r, LARGE_HEX_SIZE);
    const color = TERRAIN_COLORS[hex.terrain];
    return (
      <g key={`t-${hex.q},${hex.r}`} transform={`translate(${x}, ${y})`}>
        <polygon points={terrainCornersStr} fill={color} opacity={0.35} />
        <polygon points={terrainCornersStr} fill="none" stroke={color} strokeWidth={1} opacity={0.15} />
      </g>
    );
  };

  const getHexPixel = (q: number, r: number) => {
    const { x: raw_x, y: raw_y } = pointyHexToPixel(q, r, HEX_SIZE);
    const bx = raw_x * Math.cos(BUILDING_ROT_ANGLE) - raw_y * Math.sin(BUILDING_ROT_ANGLE) + BUILDING_OFFSET_X;
    const by = raw_x * Math.sin(BUILDING_ROT_ANGLE) + raw_y * Math.cos(BUILDING_ROT_ANGLE) + BUILDING_OFFSET_Y;
    return { x: bx, y: by };
  };

  const getEdgeConstructionProgress = (site: InfraEdgeConstructionSite): number => {
    let totalNeeded = 0;
    let totalDelivered = 0;
    for (const [res, amount] of Object.entries(site.totalCost)) {
      totalNeeded += amount;
      totalDelivered += Math.min(site.delivered[res] || 0, amount);
    }
    return totalNeeded > 0 ? totalDelivered / totalNeeded : 1;
  };

  const renderInfrastructureEdges = () => {
    const elements: React.ReactNode[] = [];

    for (const [ek, edge] of Object.entries(gameState.infraEdges)) {
      const [a, b] = parseEdgeKey(ek);
      const pa = getHexPixel(a.q, a.r);
      const pb = getHexPixel(b.q, b.r);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;

      if (edge.type === 'canal') {
        elements.push(
          <g key={ek} className="pointer-events-none">
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#0d47a1" strokeWidth={6} strokeLinecap="round" opacity={0.7} />
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#42a5f5" strokeWidth={2.5} strokeLinecap="round" />
          </g>
        );
      } else if (edge.type === 'rail') {
        const perpX = -dy;
        const perpY = dx;
        const len = Math.sqrt(perpX * perpX + perpY * perpY);
        const off = len > 0 ? 2.5 / len : 0;
        elements.push(
          <g key={ek} className="pointer-events-none">
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#3e2723" strokeWidth={6} strokeLinecap="round" opacity={0.5} />
            <line x1={pa.x + perpX * off} y1={pa.y + perpY * off} x2={pb.x + perpX * off} y2={pb.y + perpY * off} stroke="#8d6e63" strokeWidth={1.5} strokeLinecap="round" />
            <line x1={pa.x - perpX * off} y1={pa.y - perpY * off} x2={pb.x - perpX * off} y2={pb.y - perpY * off} stroke="#8d6e63" strokeWidth={1.5} strokeLinecap="round" />
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#a1887f" strokeWidth={0.5} strokeDasharray="2,4" />
          </g>
        );
      } else {
        elements.push(
          <g key={ek} className="pointer-events-none">
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#424242" strokeWidth={5} strokeLinecap="round" opacity={0.6} />
            <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#9e9e9e" strokeWidth={1.5} strokeDasharray="3,3" />
          </g>
        );
      }
    }

    for (const site of gameState.infraConstructionSites) {
      const pa = getHexPixel(site.hexA.q, site.hexA.r);
      const pb = getHexPixel(site.hexB.q, site.hexB.r);
      const progress = getEdgeConstructionProgress(site);
      const midX = (pa.x + pb.x) / 2;
      const midY = (pa.y + pb.y) / 2;
      const color = site.targetType === 'canal' ? '#42a5f5' : site.targetType === 'rail' ? '#8d6e63' : '#9e9e9e';

      elements.push(
        <g key={`cs-${site.edgeKey}`} className="pointer-events-none">
          <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray="4,4" opacity={0.35} />
          <rect x={midX - 8} y={midY - 1.5} width={16} height={3} fill="#111" rx={1.5} opacity={0.8} />
          <rect x={midX - 8} y={midY - 1.5} width={16 * progress} height={3} fill="#eab308" rx={1.5} />
        </g>
      );
    }

    return elements;
  };

  const getHexPixelPos = (hex: HexData) => {
    const { x: raw_x, y: raw_y } = pointyHexToPixel(hex.q, hex.r, HEX_SIZE);
    const base_x = raw_x * Math.cos(BUILDING_ROT_ANGLE) - raw_y * Math.sin(BUILDING_ROT_ANGLE);
    const base_y = raw_x * Math.sin(BUILDING_ROT_ANGLE) + raw_y * Math.cos(BUILDING_ROT_ANGLE);
    return { x: base_x + BUILDING_OFFSET_X, y: base_y + BUILDING_OFFSET_Y };
  };

  const hexCorners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 30);
  const hexCornersStr = hexCorners.map(p => `${p.x},${p.y}`).join(' ');

  // Pass 1: fills + interaction (rendered first, below borders)
  const renderHexFill = (hex: HexData) => {
    const { x, y } = getHexPixelPos(hex);
    const key = hexKey(hex.q, hex.r);
    const isSelected = selectedHex === key;
    const isHovered = hoveredHex === key;
    const associatedTerrains = getAssociatedTerrains(hex.q, hex.r);
    const primaryTerrain = associatedTerrains[0] || 'water';
    const hasConstruction = !!hex.constructionSite;
    const buildingColor = hex.buildingId ? (BUILDING_COLORS[hex.buildingId] || '#666') : null;
    const isInCluster = hex.buildingId && !hex.constructionSite && clusterInfo.labelHex.has(key) && clusterInfo.labelHex.get(key) !== key;
    const isLabelHex = hex.buildingId && !hex.constructionSite && clusterInfo.labelHex.get(key) === key;
    const inCluster = isInCluster || isLabelHex;

    let fill = 'transparent';
    if (buildingColor && !hasConstruction) {
      fill = inCluster ? buildingColor + 'e0' : buildingColor + '35';
    } else if (hasConstruction) {
      const targetColor = BUILDING_COLORS[hex.constructionSite!.targetBuildingId] || '#a08000';
      fill = targetColor + '18';
    }
    if (isHovered) {
      fill = buildingColor ? (inCluster ? buildingColor + 'f0' : buildingColor + '50') : '#ffffff18';
    }
    if (isSelected) {
      fill = buildingColor ? (inCluster ? buildingColor + 'f0' : buildingColor + '60') : '#ffffff25';
    }

    return (
      <g key={key} transform={`translate(${x}, ${y})`} onMouseEnter={() => setHoveredHex(key)} onMouseLeave={() => setHoveredHex(null)} onClick={() => {
        if (infraPlacementMode) { completeInfraPlacement(key); }
        else if (placingZoneType) { placeZone(hex.q, hex.r); }
        else { setSelectedHex(key); }
      }} className="cursor-pointer">
        <polygon points={hexCornersStr} fill={fill} stroke="none" />
        {!hex.buildingId && !hasConstruction && (
          <circle cx={0} cy={0} r={1.5} fill={TERRAIN_COLORS[primaryTerrain as TerrainType]} opacity={0.5} />
        )}
      </g>
    );
  };

  // Pass 2: borders, labels, rings (rendered on top, pointer-events-none)
  const renderHexOverlay = (hex: HexData) => {
    const { x, y } = getHexPixelPos(hex);
    const key = hexKey(hex.q, hex.r);
    const isSelected = selectedHex === key;
    const isHovered = hoveredHex === key;
    const hasConstruction = !!hex.constructionSite;
    const progress = hasConstruction ? getConstructionProgress(hex.constructionSite!) : 0;
    const buildingColor = hex.buildingId ? (BUILDING_COLORS[hex.buildingId] || '#666') : null;
    const efficiency = hex.flowState?.efficiency ?? 0;
    const effColor = efficiency >= 0.9 ? '#4caf50' : efficiency >= 0.5 ? '#ffa726' : '#ef5350';
    const displayId = hasConstruction ? hex.constructionSite!.targetBuildingId : hex.buildingId;
    const label = displayId ? (BUILDING_LABELS[displayId] || '???') : null;
    const isInCluster = hex.buildingId && !hex.constructionSite && clusterInfo.labelHex.has(key) && clusterInfo.labelHex.get(key) !== key;
    const isLabelHex = hex.buildingId && !hex.constructionSite && clusterInfo.labelHex.get(key) === key;
    const inCluster = isInCluster || isLabelHex;
    const hasBuilding = !!hex.buildingId && !hasConstruction;

    // Determine default border style
    let stroke = '#ffffff12';
    let strokeWidth = 0.5;
    if (buildingColor && !hasConstruction) {
      stroke = buildingColor;
      strokeWidth = 1.2;
    } else if (hasConstruction) {
      stroke = '#d4a017';
      strokeWidth = 1;
    }

    return (
      <g key={`o-${key}`} transform={`translate(${x}, ${y})`} className="pointer-events-none">
        {/* Selection glow */}
        {isSelected && <polygon points={hexCornersStr} fill="none" stroke="#fbbf24" strokeWidth={4} opacity={0.35} />}
        {/* Hover glow */}
        {isHovered && !isSelected && <polygon points={hexCornersStr} fill="none" stroke="#ffffffd0" strokeWidth={2} />}
        {/* Per-edge borders */}
        {hexCorners.map((corner, i) => {
          const next = hexCorners[(i + 1) % 6];
          const isInternal = clusterInfo.sameTypeEdges.has(`${key}|${i}`);
          if (isInternal && !isSelected) return null;
          if (isSelected) {
            return <line key={i} x1={corner.x} y1={corner.y} x2={next.x} y2={next.y}
              stroke="#fbbf24" strokeWidth={2} />;
          }
          // External cluster edge: bright border to distinguish from terrain
          const isExternalCluster = inCluster && !isInternal;
          return <line key={i} x1={corner.x} y1={corner.y} x2={next.x} y2={next.y}
            stroke={isExternalCluster ? '#ffffffb0' : stroke}
            strokeWidth={isExternalCluster ? 1.5 : strokeWidth}
            strokeDasharray={hasConstruction ? '3,2' : undefined} />;
        })}
        {/* Operating building — efficiency ring + label */}
        {hasBuilding && (
          <>
            {!isInCluster && (
              <circle cx={0} cy={0} r={HEX_SIZE * 0.52} fill="none" stroke={effColor} strokeWidth={1.5} opacity={0.55} />
            )}
            {isLabelHex && (
              <text y={4} textAnchor="middle" className="select-none" style={{ fontSize: '9.5px', fontWeight: 800, fill: '#fff', letterSpacing: '0.3px' }}>
                {label}
              </text>
            )}
          </>
        )}
        {/* Construction site */}
        {hasConstruction && (
          <>
            <rect x={-HEX_SIZE * 0.55} y={HEX_SIZE * 0.22} width={HEX_SIZE * 1.1} height={2.5} fill="#1a1a1a" rx={1.25} />
            <rect x={-HEX_SIZE * 0.55} y={HEX_SIZE * 0.22} width={HEX_SIZE * 1.1 * progress} height={2.5} fill="#eab308" rx={1.25} />
            <text y={2} textAnchor="middle" className="select-none" style={{ fontSize: '7px', fontWeight: 700, fill: '#fde68a' }}>
              {label}
            </text>
          </>
        )}
      </g>
    );
  };

  const selectedHexData = selectedHex ? gameState.grid[selectedHex] : null;
  const selectedBuilding = selectedHexData?.buildingId ? BUILDINGS[selectedHexData.buildingId] : null;
  const selectedConstruction = selectedHexData?.constructionSite;

  const hasExports = Object.values(gameState.exportRate).some(v => v > 0);
  const hasTotalExports = Object.values(gameState.totalExports).some(v => v > 0);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0a0e14] text-zinc-100 font-sans" style={{ color: '#e4e4e7' }}>
      <div className="w-[340px] min-w-[340px] max-w-[340px] bg-[#111820] border-r border-[#1e2a3a] p-3 flex flex-col gap-2.5 overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-sm font-black tracking-tight text-emerald-400" style={{ fontVariant: 'small-caps' }}>Industrializer</h1>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-500">Era {gameState.era}</span>
            <button onClick={toggleNetwork} className={`p-1 rounded transition-colors ${gameState.showNetwork ? 'text-blue-300' : 'text-zinc-600 hover:text-zinc-400'}`} title="Toggle Network"><Info size={12} /></button>
            <button onClick={resetGame} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors" title="New Game"><Zap size={12} /></button>
          </div>
        </div>

        {/* Resource Flows — compact rows with key */}
        <div className="space-y-px">
          <div className="flex items-center gap-1.5 px-1.5 py-[2px] text-[11px] text-zinc-600">
            <span className="w-1.5" />
            <span className="w-[58px]">resource</span>
            <span className="flex-1 text-center">produced / potential</span>
            <span className="w-[42px] text-right">net</span>
          </div>
          {ALL_RESOURCES.map(res => {
            const potential = gameState.flowSummary.potential[res] || 0;
            const realized = gameState.flowSummary.realized[res] || 0;
            const consumed = gameState.flowSummary.consumed[res] || 0;
            const net = realized - consumed;
            const hasActivity = potential > 0 || consumed > 0;
            if (!hasActivity) return null;
            const resColor = RESOURCE_COLORS[res] || '#888';
            const barMax = Math.max(potential, consumed, 0.1);
            const realizedPct = Math.min(100, (realized / barMax) * 100);

            return (
              <div key={res} className="flex items-center gap-1.5 px-1.5 py-[3px] rounded hover:bg-[#1a2332]/50">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: resColor }} />
                <span className="text-[11px] text-zinc-500 w-[58px] truncate uppercase">{res.replace('_', ' ')}</span>
                <div className="flex-1 h-[4px] bg-[#0d1520] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${realizedPct}%`, backgroundColor: resColor, opacity: 0.7 }} />
                </div>
                <span className={`text-[11px] font-mono w-[42px] text-right font-bold ${net > 0.01 ? 'text-emerald-400' : net < -0.01 ? 'text-rose-400' : 'text-zinc-600'}`}>
                  {net > 0 ? '+' : ''}{net.toFixed(1)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Era Progress */}
        {gameState.era < 6 && ERA_MILESTONES[gameState.era + 1] && (
          <div className="bg-[#141c28] rounded-md p-2 space-y-1">
            <span className="text-[11px] text-zinc-500 font-bold">Era {gameState.era + 1}: {ERA_MILESTONES[gameState.era + 1].label}</span>
            {Object.entries(ERA_MILESTONES[gameState.era + 1].requirements).map(([res, needed]) => {
              const current = gameState.totalExports[res] || 0;
              const pct = Math.min(1, current / (needed as number));
              const complete = pct >= 1;
              const resColor = RESOURCE_COLORS[res] || '#888';
              return (
                <div key={res} className="flex items-center gap-1.5 text-[11px]">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: resColor }} />
                  <div className="flex-1 h-[4px] bg-[#0d1520] rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, backgroundColor: complete ? '#4caf50' : resColor }} />
                  </div>
                  <span className={`font-mono w-[60px] text-right ${complete ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {Math.floor(current)}/{needed}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Bonus Zones — compact */}
        <div className="space-y-1">
          {placingZoneType && (
            <div className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-800/40 rounded px-2 py-1">
              Click hex to place... (Esc cancel)
            </div>
          )}
          {/* Placed zones */}
          {gameState.zones.map(zone => (
            <div key={zone.id} className="flex items-center gap-1.5 bg-[#141c28] rounded px-2 py-1">
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: ZONE_TYPES[zone.type].color, boxShadow: `0 0 4px ${ZONE_TYPES[zone.type].color}60` }} />
              <span className="text-[11px] font-bold flex-1 text-zinc-300">{ZONE_TYPES[zone.type].name}</span>
              <button onClick={() => removeZone(zone.id)} className="text-[11px] text-zinc-600 hover:text-red-400 transition-colors">x</button>
            </div>
          ))}
          {/* Zone buttons — grid of small buttons */}
          <div className="flex flex-wrap gap-1">
            {(Object.entries(ZONE_TYPES) as [ZoneType, typeof ZONE_TYPES[ZoneType]][]).map(([zt, info]) => {
              const count = gameState.zones.filter(z => z.type === zt).length;
              const atLimit = count >= MAX_ZONES_PER_TYPE;
              const isActive = placingZoneType === zt;
              return (
                <button
                  key={zt}
                  onClick={() => setPlacingZoneType(isActive ? null : zt)}
                  disabled={atLimit && !isActive}
                  title={`${info.name} — ${info.description} (${count}/${MAX_ZONES_PER_TYPE})`}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-colors border ${
                    isActive
                      ? 'border-white/30 bg-[#243040]'
                      : atLimit
                        ? 'border-transparent opacity-30 cursor-not-allowed bg-[#141c28]'
                        : 'border-transparent bg-[#141c28] hover:bg-[#1e2a3a] cursor-pointer'
                  }`}
                >
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.color, boxShadow: `0 0 3px ${info.color}80` }} />
                  <span className="text-zinc-400">{info.name.split(' ')[0]}</span>
                  <span className="text-zinc-600">{count}/{MAX_ZONES_PER_TYPE}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Infra placement mode banner */}
        {infraPlacementMode && (
          <div className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-800/40 rounded px-2 py-1">
            Click adjacent hex for {infraPlacementMode.type}... (Esc)
          </div>
        )}

        {/* Hex Details */}
        {selectedHex && selectedHexData && (
          <div className="space-y-1.5 pt-1.5 border-t border-[#1e2a3a]">
            {/* Hex header */}
            <div className="flex justify-between items-center px-1">
              <span className="text-[11px] font-bold text-zinc-400 capitalize">{getAssociatedTerrains(selectedHexData.q, selectedHexData.r).join('/')}</span>
              <span className="text-[11px] font-mono text-zinc-600">{selectedHex}</span>
            </div>

            {/* Construction site */}
            {selectedConstruction && (
              <div className="bg-amber-900/15 border border-amber-700/30 rounded-md p-2 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-amber-200">
                    {selectedConstruction.isUpgrade ? 'Upgrading:' : 'Building:'} {BUILDINGS[selectedConstruction.targetBuildingId]?.name || '???'}
                  </span>
                  <span className="text-[11px] font-mono text-amber-300">{Math.floor(getConstructionProgress(selectedConstruction) * 100)}%</span>
                </div>
                <div className="w-full h-1.5 bg-[#0d1520] rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${getConstructionProgress(selectedConstruction) * 100}%` }} />
                </div>
                {Object.entries(selectedConstruction.totalCost).map(([res, needed]) => {
                  const delivered = selectedConstruction.delivered[res] || 0;
                  const pct = Math.min(1, delivered / needed);
                  const resColor = RESOURCE_COLORS[res] || '#888';
                  return (
                    <div key={res} className="flex items-center gap-1.5 text-[11px]">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: resColor }} />
                      <span className="capitalize text-zinc-500 w-[58px] truncate">{res.replace('_', ' ')}</span>
                      <div className="flex-1 h-[4px] bg-[#0d1520] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: resColor, opacity: 0.7 }} />
                      </div>
                      <span className="text-zinc-500 font-mono text-right">{delivered.toFixed(0)}/{needed}</span>
                    </div>
                  );
                })}
                <button onClick={demolishBuilding} className="w-full py-1 rounded text-center text-[11px] text-zinc-500 hover:text-red-400 bg-[#0d1520] hover:bg-red-900/20 transition-colors font-bold">Cancel</button>
              </div>
            )}

            {/* Active building */}
            {selectedBuilding && !selectedConstruction ? (
              <div className="space-y-1.5">
                {/* Building name + efficiency */}
                <div className="flex items-center gap-2 px-1">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: BUILDING_COLORS[selectedBuilding.id] || '#666' }} />
                  <span className="text-[11px] font-bold text-zinc-100 flex-1">{selectedBuilding.name}</span>
                  <span className={`text-[11px] font-bold font-mono ${(selectedHexData.flowState?.efficiency ?? 0) >= 0.9 ? 'text-emerald-400' : (selectedHexData.flowState?.efficiency ?? 0) >= 0.5 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {Math.floor((selectedHexData.flowState?.efficiency ?? 0) * 100)}%
                  </span>
                </div>

                {/* Inputs — compact bars */}
                {selectedHexData.flowState && selectedHexData.flowState.inputDiagnostics.length > 0 && (
                  <div className="bg-[#0d1520] rounded-md p-1.5 space-y-1">
                    {selectedHexData.flowState.inputDiagnostics.map(diag => {
                      const resColor = RESOURCE_COLORS[diag.resource] || '#888';
                      return (
                        <div key={diag.resource} className="flex items-center gap-1.5 text-[11px]">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: resColor }} />
                          <span className="capitalize text-zinc-500 w-[58px] truncate">{diag.resource.replace('_', ' ')}</span>
                          <div className="flex-1 h-[4px] bg-[#111820] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${diag.satisfaction * 100}%`, backgroundColor: diag.satisfaction >= 1 ? '#4caf50' : diag.satisfaction > 0 ? '#ffa726' : '#ef5350' }} />
                          </div>
                          <span className={`font-mono w-[28px] text-right font-bold ${diag.satisfaction >= 1 ? 'text-emerald-400' : diag.satisfaction > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                            {Math.floor(diag.satisfaction * 100)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Outputs — compact */}
                {selectedHexData.flowState && Object.keys(selectedHexData.flowState.potential).length > 0 && (
                  <div className="bg-[#0d1520] rounded-md p-1.5 space-y-0.5">
                    {Object.entries(selectedHexData.flowState.potential).map(([res, pot]) => {
                      const real = selectedHexData.flowState!.realized[res] || 0;
                      const resColor = RESOURCE_COLORS[res] || '#888';
                      return (
                        <div key={res} className="flex items-center gap-1.5 text-[11px]">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: resColor }} />
                          <span className="capitalize text-zinc-500 flex-1 truncate">{res.replace('_', ' ')}</span>
                          <span className="font-mono text-emerald-400 font-bold">{real.toFixed(1)}</span>
                          <span className="font-mono text-zinc-600">/{pot.toFixed(1)}</span>
                        </div>
                      );
                    })}
                    {selectedHexData.flowState!.clusterBonus > 0 && (
                      <div className="text-[11px] text-cyan-400/70 pt-0.5">+{Math.round(selectedHexData.flowState!.clusterBonus * 100)}% cluster ({selectedHexData.flowState!.clusterSize})</div>
                    )}
                    {selectedHexData.flowState!.zoneOutputBonus > 0 && (
                      <div className="text-[11px] text-purple-400/70">+{Math.round(selectedHexData.flowState!.zoneOutputBonus * 100)}% zone</div>
                    )}
                  </div>
                )}

                {/* Export port / trade depot specifics */}
                {(selectedBuilding.id === 'export_port' || selectedBuilding.id === 'trade_depot') && selectedHexData.flowState && (
                  <div className="bg-[#0d1520] rounded-md p-1.5 space-y-0.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Export eff.</span>
                      <span className={`font-bold ${selectedHexData.flowState.exportEfficiency > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {selectedHexData.flowState.exportEfficiency > 0 ? `${Math.round(selectedHexData.flowState.exportEfficiency * 100)}%` : 'No route'}
                      </span>
                    </div>
                    {Object.entries(selectedHexData.flowState.exports).filter(([, v]) => v > 0.001).map(([res, amt]) => (
                      <div key={res} className="flex justify-between font-mono">
                        <span className="capitalize text-zinc-500">{res.replace('_', ' ')}</span>
                        <span className="text-amber-400">{amt.toFixed(2)}/t</span>
                      </div>
                    ))}
                  </div>
                )}

                {!selectedHexData.flowState && Object.entries(selectedBuilding.outputs).map(([res, amt]) => (
                  <div key={res} className="flex justify-between text-[11px] px-1.5">
                    <span className="capitalize text-zinc-400">{res.replace('_', ' ')}</span>
                    <span className="text-emerald-400 font-bold font-mono">{amt}/s</span>
                  </div>
                ))}

                {/* Upgrade */}
                {selectedBuilding.upgradesTo && selectedBuilding.upgradeCost && !selectedConstruction && (() => {
                  const upgradeTarget = BUILDINGS[selectedBuilding.upgradesTo!];
                  const upgradeRisks = analyzeSupplyRisks(upgradeTarget.inputs, selectedBuilding.inputs, gameState.flowSummary, gameState.era);
                  return (
                    <button onClick={upgradeBuilding} className="w-full flex items-center gap-2 p-1.5 bg-indigo-900/25 hover:bg-indigo-800/35 rounded-md transition-colors border border-indigo-700/30 hover:border-indigo-600/50 group">
                      <Zap size={12} className="text-indigo-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-bold text-indigo-200">Upgrade: {upgradeTarget.name}</span>
                        {upgradeRisks.length > 0 && (
                          <div className="flex gap-1 text-[11px] text-amber-500/80 mt-0.5">
                            {upgradeRisks.slice(0, 2).map(r => <span key={r.resource} className="capitalize">{r.resource.replace('_', ' ')}</span>)}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })()}

                {/* Actions row */}
                <div className="flex gap-1">
                  <button onClick={togglePriority} className={`flex-1 py-1 rounded text-center text-[11px] font-bold transition-colors border ${selectedHexData.prioritized ? 'bg-amber-900/30 border-amber-700/40 text-amber-300' : 'bg-[#141c28] border-[#1e2a3a] text-zinc-500 hover:text-zinc-300'}`}>
                    {selectedHexData.prioritized ? 'Prioritized' : 'Prioritize'}
                  </button>
                  <button onClick={demolishBuilding} className="flex-1 py-1 rounded text-center text-[11px] font-bold bg-[#141c28] border border-[#1e2a3a] text-zinc-500 hover:text-red-400 hover:border-red-800/40 transition-colors">
                    Demolish
                  </button>
                </div>

                {/* Infrastructure */}
                {selectedHex && (() => {
                  const conns = countHexConnections(selectedHexData.q, selectedHexData.r, gameState.infraEdges);
                  const hexEdges = Object.entries(gameState.infraEdges).filter(([ek]) => {
                    const [a, b] = parseEdgeKey(ek);
                    return (a.q === selectedHexData.q && a.r === selectedHexData.r) ||
                           (b.q === selectedHexData.q && b.r === selectedHexData.r);
                  });
                  const hexEdgeSites = gameState.infraConstructionSites.filter(s =>
                    (s.hexA.q === selectedHexData.q && s.hexA.r === selectedHexData.r) ||
                    (s.hexB.q === selectedHexData.q && s.hexB.r === selectedHexData.r)
                  );
                  return (hexEdges.length > 0 || hexEdgeSites.length > 0 || (conns < MAX_INFRA_CONNECTIONS && !infraPlacementMode)) ? (
                    <div className="space-y-1 pt-1 border-t border-[#1e2a3a]">
                      <div className="flex justify-between items-center px-1">
                        <span className="text-[11px] uppercase text-zinc-600 font-bold">Infra</span>
                        <span className="text-[11px] font-mono text-zinc-600">{conns}/{MAX_INFRA_CONNECTIONS}</span>
                      </div>
                      {hexEdges.map(([ek, edge]) => {
                        const [a, b] = parseEdgeKey(ek);
                        const other = (a.q === selectedHexData.q && a.r === selectedHexData.r) ? b : a;
                        const infraColor = edge.type === 'canal' ? '#42a5f5' : edge.type === 'rail' ? '#8d6e63' : '#9e9e9e';
                        return (
                          <div key={ek} className="flex items-center gap-1.5 px-1.5 py-1 bg-[#0d1520] rounded text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: infraColor }} />
                            <span className="capitalize text-zinc-400 flex-1">{edge.type} {other.q},{other.r}</span>
                            <button onClick={() => demolishInfraEdge(ek)} className="text-zinc-600 hover:text-red-400 transition-colors">x</button>
                          </div>
                        );
                      })}
                      {hexEdgeSites.map(s => (
                        <div key={s.edgeKey} className="flex items-center gap-1.5 px-1.5 py-1 bg-amber-900/10 border border-amber-800/20 rounded text-[11px]">
                          <span className="capitalize text-amber-300/80 flex-1">{s.targetType} {Math.floor(getEdgeConstructionProgress(s) * 100)}%</span>
                          <button onClick={() => demolishInfraEdge(s.edgeKey)} className="text-zinc-600 hover:text-red-400 transition-colors">x</button>
                        </div>
                      ))}
                      {conns < MAX_INFRA_CONNECTIONS && !infraPlacementMode && (
                        <div className="flex gap-1">
                          <button onClick={() => startInfraPlacement('road')} className="flex-1 py-1 rounded bg-[#141c28] hover:bg-[#1e2a3a] text-[11px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors">Road</button>
                          {gameState.era >= 2 && <button onClick={() => startInfraPlacement('rail')} className="flex-1 py-1 rounded bg-[#141c28] hover:bg-[#1e2a3a] text-[11px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors">Rail</button>}
                          {gameState.era >= 2 && <button onClick={() => startInfraPlacement('canal')} className="flex-1 py-1 rounded bg-[#141c28] hover:bg-[#1e2a3a] text-[11px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors">Canal</button>}
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
            ) : !selectedConstruction ? (
              /* Empty hex — available buildings */
              <div className="space-y-1">
                {Object.values(BUILDINGS).filter(b => {
                  const associatedTerrains = getAssociatedTerrains(selectedHexData.q, selectedHexData.r);
                  return (!b.requiresTerrain || b.requiresTerrain.some(t => associatedTerrains.includes(t as any))) && b.unlockEra <= gameState.era;
                }).map(b => {
                  const buildRisks = analyzeSupplyRisks(b.inputs, undefined, gameState.flowSummary, gameState.era);
                  const bColor = BUILDING_COLORS[b.id] || '#666';
                  return (
                    <button key={b.id} onClick={() => buildBuilding(b.id)} className="w-full flex items-center gap-2 px-2 py-1.5 bg-[#141c28] hover:bg-[#1e2a3a] border border-[#1e2a3a] hover:border-[#3a506a] rounded text-left transition-colors group">
                      <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: bColor }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-bold text-zinc-200">{b.name}</span>
                        {Object.keys(b.cost).length > 0 && (
                          <span className="text-[11px] text-zinc-500 ml-1.5">
                            {Object.entries(b.cost).map(([res, amt]) => `${amt} ${res.replace('_', ' ')}`).join(', ')}
                          </span>
                        )}
                        {Object.keys(b.cost).length === 0 && <span className="text-[11px] text-emerald-500/70 ml-1.5">Free</span>}
                      </div>
                      {buildRisks.length > 0 && <span className="text-[11px] text-amber-500/70 flex-shrink-0">{'\u26a0'}</span>}
                    </button>
                  );
                })}
                {/* Infrastructure on empty hex */}
                {(() => {
                  const conns = countHexConnections(selectedHexData.q, selectedHexData.r, gameState.infraEdges);
                  return conns < MAX_INFRA_CONNECTIONS && !infraPlacementMode && (
                    <div className="flex gap-1 pt-1 border-t border-[#1e2a3a]">
                      <button onClick={() => startInfraPlacement('road')} className="flex-1 py-1 rounded bg-[#141c28] hover:bg-[#1e2a3a] text-[11px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors">Road</button>
                      {gameState.era >= 2 && <button onClick={() => startInfraPlacement('rail')} className="flex-1 py-1 rounded bg-[#141c28] hover:bg-[#1e2a3a] text-[11px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors">Rail</button>}
                      {gameState.era >= 2 && <button onClick={() => startInfraPlacement('canal')} className="flex-1 py-1 rounded bg-[#141c28] hover:bg-[#1e2a3a] text-[11px] font-bold text-zinc-500 hover:text-zinc-300 transition-colors">Canal</button>}
                    </div>
                  );
                })()}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden" style={{ background: 'radial-gradient(circle at center, #0f1922 0%, #080c12 100%)' }}>
        <svg viewBox={`-600 -600 1200 1200`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <clipPath id="terrain-clip">
              {Object.values(gameState.terrainGrid).map((hex: any) => {
                const { x, y } = pointyHexToPixel(hex.q, hex.r, LARGE_HEX_SIZE);
                return <polygon key={`clip-${hex.q},${hex.r}`} points={terrainCorners.map(p => `${p.x + x},${p.y + y}`).join(' ')} />;
              })}
            </clipPath>
          </defs>
          <g>
            {Object.values(gameState.terrainGrid).map(hex => renderTerrainHex(hex as any))}
            <g clipPath="url(#terrain-clip)">
              {/* Zone placement preview */}
              {placingZoneType && hoveredHex && (() => {
                const [hq, hr] = hoveredHex.split(',').map(Number);
                const overlap = zonesOverlap(hq, hr, gameState.zones);
                const previewColor = overlap ? '#ff0000' : ZONE_TYPES[placingZoneType].color;
                return getHexesInRadius(hq, hr, ZONE_RADIUS).map(h => {
                  const { x: raw_x, y: raw_y } = pointyHexToPixel(h.q, h.r, HEX_SIZE);
                  const bx = raw_x * Math.cos(BUILDING_ROT_ANGLE) - raw_y * Math.sin(BUILDING_ROT_ANGLE) + BUILDING_OFFSET_X;
                  const by = raw_x * Math.sin(BUILDING_ROT_ANGLE) + raw_y * Math.cos(BUILDING_ROT_ANGLE) + BUILDING_OFFSET_Y;
                  const corners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 30);
                  return (
                    <g key={`preview-${h.q},${h.r}`} transform={`translate(${bx}, ${by})`}>
                      <polygon
                        points={corners.map(p => `${p.x},${p.y}`).join(' ')}
                        fill={previewColor}
                        fillOpacity={0.3}
                        stroke={previewColor}
                        strokeOpacity={0.6}
                        strokeWidth={1}
                        className="pointer-events-none"
                      />
                    </g>
                  );
                });
              })()}
              {Object.values(gameState.grid).map(hex => renderHexFill(hex))}
              {/* Infrastructure edges layer — between fills and overlays */}
              {renderInfrastructureEdges()}
              {/* Infra placement highlight */}
              {infraPlacementMode && (() => {
                const [fq, fr] = infraPlacementMode.fromHex.split(',').map(Number);
                const fromPixel = getHexPixel(fq, fr);
                const neighbors = getNeighbors(fq, fr);
                const totalEdges = Object.keys(gameState.infraEdges).length;
                const typeColor = infraPlacementMode.type === 'canal' ? '#5dade2' : infraPlacementMode.type === 'rail' ? '#8d6e63' : '#888';
                return neighbors.map(n => {
                  const nk = hexKey(n.q, n.r);
                  if (!gameState.grid[nk]) return null;
                  const ek = getEdgeKey(fq, fr, n.q, n.r);
                  const existingEdge = gameState.infraEdges[ek];
                  if (existingEdge && existingEdge.type === infraPlacementMode.type) return null;
                  const alreadyConnected = existingEdge ? 1 : 0;
                  const toConns = countHexConnections(n.q, n.r, gameState.infraEdges);
                  if (toConns - alreadyConnected >= MAX_INFRA_CONNECTIONS) return null;
                  if (gameState.infraConstructionSites.some(s => s.edgeKey === ek)) return null;
                  // Network connectivity check (canals exempt)
                  if (infraPlacementMode.type !== 'canal' && totalEdges > 0 && !alreadyConnected) {
                    const fromIn = countHexConnections(fq, fr, gameState.infraEdges) > 0;
                    const toIn = countHexConnections(n.q, n.r, gameState.infraEdges) > 0;
                    if (!fromIn && !toIn) return null;
                  }
                  const nPixel = getHexPixel(n.q, n.r);
                  const corners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 30);
                  return (
                    <g key={`highlight-${nk}`}>
                      <g transform={`translate(${nPixel.x}, ${nPixel.y})`}>
                        <polygon points={corners.map(p => `${p.x},${p.y}`).join(' ')} fill={typeColor} fillOpacity={0.25} stroke={typeColor} strokeOpacity={0.6} strokeWidth={1.5} className="pointer-events-none" />
                      </g>
                      <line x1={fromPixel.x} y1={fromPixel.y} x2={nPixel.x} y2={nPixel.y} stroke={typeColor} strokeWidth={3} strokeDasharray="6,4" opacity={0.5} className="pointer-events-none" />
                    </g>
                  );
                });
              })()}
              {/* Placed zones — between infra and hex overlays */}
              {gameState.zones.map(zone => {
                const color = ZONE_TYPES[zone.type].color;
                return getHexesInRadius(zone.centerQ, zone.centerR, ZONE_RADIUS).map(h => {
                  const { x: raw_x, y: raw_y } = pointyHexToPixel(h.q, h.r, HEX_SIZE);
                  const bx = raw_x * Math.cos(BUILDING_ROT_ANGLE) - raw_y * Math.sin(BUILDING_ROT_ANGLE) + BUILDING_OFFSET_X;
                  const by = raw_x * Math.sin(BUILDING_ROT_ANGLE) + raw_y * Math.cos(BUILDING_ROT_ANGLE) + BUILDING_OFFSET_Y;
                  return (
                    <g key={`zone-${zone.id}-${h.q},${h.r}`} transform={`translate(${bx}, ${by})`}>
                      <polygon
                        points={hexCornersStr}
                        fill={color}
                        fillOpacity={0.15}
                        stroke={color}
                        strokeOpacity={0.55}
                        strokeWidth={1}
                        className="pointer-events-none"
                      />
                    </g>
                  );
                });
              })}
              {Object.values(gameState.grid).map(hex => renderHexOverlay(hex))}
            </g>
          </g>
        </svg>
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-3">
          <div className="bg-[#111820]/90 backdrop-blur-sm border border-[#1e2a3a] px-3.5 py-1.5 rounded-full flex items-center gap-2 shadow-lg shadow-black/20" title={
            ERA_MILESTONES[gameState.era + 1]
              ? `Next: ${ERA_MILESTONES[gameState.era + 1].label} — export ${Object.entries(ERA_MILESTONES[gameState.era + 1].requirements).map(([r, n]) => `${n} ${r.replace('_', ' ')}`).join(' + ')}`
              : 'Final era reached'
          }><Zap size={12} className="text-emerald-400" /><span className="text-[11px] font-bold font-mono tracking-wide text-emerald-300">ERA {gameState.era}</span></div>
          <div className="bg-[#111820]/90 backdrop-blur-sm border border-[#1e2a3a] px-3.5 py-1.5 rounded-full flex items-center gap-2 shadow-lg shadow-black/20"><span className="text-[11px] font-bold font-mono tracking-wide text-zinc-500">TICK {gameState.tick}</span></div>
          {hasTotalExports && (
            <div className="relative">
              <button onClick={() => setShowExportPanel(p => !p)} className={`bg-[#111820]/90 backdrop-blur-sm border px-3.5 py-1.5 rounded-full flex items-center gap-2 shadow-lg shadow-black/20 cursor-pointer hover:bg-[#1a2332]/90 transition-colors ${showExportPanel ? 'border-amber-500/50' : 'border-amber-800/30'}`}>
                <Zap size={12} className="text-amber-400" />
                <span className="text-[11px] font-bold font-mono tracking-wide text-amber-300">
                  EXPORTS {Object.values(gameState.totalExports).reduce((a, b) => a + b, 0).toFixed(0)}
                </span>
              </button>
              {showExportPanel && (
                <div className="absolute top-full mt-2 right-0 bg-[#111820]/95 backdrop-blur-sm border border-amber-800/30 rounded-lg shadow-xl shadow-black/40 p-3 min-w-[200px] z-10">
                  {/* Per-tick rates */}
                  {hasExports && (
                    <div className="space-y-1 mb-2">
                      <span className="text-[11px] text-zinc-500 font-bold uppercase">Per Tick</span>
                      {Object.entries(gameState.exportRate).filter(([, r]) => r > 0).map(([res, rate]) => {
                        const resColor = RESOURCE_COLORS[res] || '#888';
                        return (
                          <div key={res} className="flex items-center gap-1.5 text-[11px]">
                            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: resColor }} />
                            <span className="capitalize text-zinc-300 flex-1">{res.replace('_', ' ')}</span>
                            <span className="font-mono text-amber-400 font-bold">{rate.toFixed(1)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Cumulative totals */}
                  <div className="space-y-1 border-t border-amber-800/20 pt-2">
                    <span className="text-[11px] text-zinc-500 font-bold uppercase">Cumulative</span>
                    {Object.entries(gameState.totalExports).filter(([, t]) => t > 0).map(([res, total]) => {
                      const resColor = RESOURCE_COLORS[res] || '#888';
                      return (
                        <div key={res} className="flex items-center gap-1.5 text-[11px]">
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: resColor }} />
                          <span className="capitalize text-zinc-400 flex-1">{res.replace('_', ' ')}</span>
                          <span className="font-mono text-zinc-300">{total.toFixed(0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
