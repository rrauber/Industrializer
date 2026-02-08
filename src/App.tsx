import React, { useState, useEffect } from 'react';
import { HexData, TerrainHex, GameState, ResourceType, TerrainType, FlowSummary, ConstructionSite } from './types';
import { hexKey, pointyHexToPixel, pixelToPointyHex, getHexCorners, getNeighbors } from './hexUtils';
import { BUILDINGS, TERRAIN_COLORS } from './constants';
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
const ALL_RESOURCES: ResourceType[] = ['food', 'wood', 'stone', 'iron_ore', 'coal', 'iron_ingot', 'tools', 'concrete', 'steel', 'population'];

function migrateOldSave(parsed: any): GameState {
  // If old save has 'resources' field, migrate it
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

  // Strip old fields from hex data
  for (const key of Object.keys(grid)) {
    const hex = grid[key];
    delete hex.lastEfficiency;
    delete hex.inputEfficiencies;
    delete hex.infrastructure;
  }

  return {
    flowSummary: parsed.flowSummary || emptyFlowSummary(),
    grid,
    terrainGrid: parsed.terrainGrid,
    era: parsed.era || 1,
    tick: parsed.tick || 0,
    showNetwork: parsed.showNetwork,
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
      era: 1,
      tick: 0,
    };
  });

  useEffect(() => {
    localStorage.setItem('industrializer_save', JSON.stringify(gameState));
  }, [gameState]);

  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [hoveredHex, setHoveredHex] = useState<string | null>(null);

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
        const stepCost = (current.hasRoad && nHex.hasRoad) ? 0.5 : 1.0;
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
        const { grid, flowSummary } = simulateTick(prev.grid, prev.terrainGrid, getPathCost);
        // Auto-advance era based on production milestones
        let era = prev.era;
        if (era === 1 && (flowSummary.realized['iron_ingot'] || 0) > 0) era = 2;
        if (era === 2 && (flowSummary.realized['iron_ingot'] || 0) > 0 && (flowSummary.realized['tools'] || 0) > 0) era = 3;
        return { ...prev, grid, flowSummary, era, tick: prev.tick + 1 };
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

  const buildRoad = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    if (hex.hasRoad) return;
    // Roads are instant (cheap infrastructure)
    setGameState(prev => ({
      ...prev,
      grid: { ...prev.grid, [selectedHex]: { ...hex, hasRoad: true } },
    }));
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

  const terrainCorners = getHexCorners({ x: 0, y: 0 }, LARGE_HEX_SIZE, 30);
  const terrainCornersStr = terrainCorners.map(p => `${p.x},${p.y}`).join(' ');

  const renderTerrainHex = (hex: TerrainHex) => {
    const { x, y } = pointyHexToPixel(hex.q, hex.r, LARGE_HEX_SIZE);
    return (
      <g key={`t-${hex.q},${hex.r}`} transform={`translate(${x}, ${y})`}>
        <polygon points={terrainCornersStr} fill={TERRAIN_COLORS[hex.terrain]} opacity={0.6} />
      </g>
    );
  };

  const renderHex = (hex: HexData) => {
    const { x: raw_x, y: raw_y } = pointyHexToPixel(hex.q, hex.r, HEX_SIZE);
    const base_x = raw_x * Math.cos(BUILDING_ROT_ANGLE) - raw_y * Math.sin(BUILDING_ROT_ANGLE);
    const base_y = raw_x * Math.sin(BUILDING_ROT_ANGLE) + raw_y * Math.cos(BUILDING_ROT_ANGLE);
    const x = base_x + BUILDING_OFFSET_X;
    const y = base_y + BUILDING_OFFSET_Y;
    const key = hexKey(hex.q, hex.r);
    const isSelected = selectedHex === key;
    const isHovered = hoveredHex === key;
    const corners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 30);
    const associatedTerrains = getAssociatedTerrains(hex.q, hex.r);
    const primaryTerrain = associatedTerrains[0] || 'water';
    const hasConstruction = !!hex.constructionSite;
    const progress = hasConstruction ? getConstructionProgress(hex.constructionSite!) : 0;

    return (
      <g key={key} transform={`translate(${x}, ${y})`} onMouseEnter={() => setHoveredHex(key)} onMouseLeave={() => setHoveredHex(null)} onClick={() => setSelectedHex(key)} className="cursor-pointer">
        <polygon
          points={corners.map(p => `${p.x},${p.y}`).join(' ')}
          fill={isSelected ? '#fff' : isHovered ? '#eee' : hasConstruction ? '#2a2a1a' : 'transparent'}
          stroke={isSelected ? '#fff' : isHovered ? '#bbb' : hasConstruction ? '#aa8' : '#ffffff55'}
          strokeWidth={isSelected ? 2 : hasConstruction ? 1.5 : 1}
          strokeDasharray={hasConstruction ? '4,3' : undefined}
          className="transition-colors duration-200"
        />
        {!hex.buildingId && !hex.hasRoad && !hasConstruction && (
          <circle cx={0} cy={0} r={2} fill={TERRAIN_COLORS[primaryTerrain as TerrainType]} opacity={0.8} />
        )}
        {hasConstruction && (
          <>
            {/* Progress fill */}
            <rect x={-HEX_SIZE * 0.6} y={HEX_SIZE * 0.2} width={HEX_SIZE * 1.2} height={3} fill="#333" rx={1.5} />
            <rect x={-HEX_SIZE * 0.6} y={HEX_SIZE * 0.2} width={HEX_SIZE * 1.2 * progress} height={3} fill="#eab308" rx={1.5} />
            <text y={2} textAnchor="middle" className="select-none pointer-events-none text-[8px] font-bold fill-yellow-300 drop-shadow-md">
              {BUILDINGS[hex.constructionSite!.targetBuildingId]?.name.substring(0, 3).toUpperCase() || '???'}
            </text>
          </>
        )}
        {hex.hasRoad && getNeighbors(hex.q, hex.r).map((n) => {
          const nHex = gameState.grid[hexKey(n.q, n.r)];
          if (nHex && nHex.hasRoad) {
            const { x: n_raw_x, y: n_raw_y } = pointyHexToPixel(n.q, n.r, HEX_SIZE);
            const n_base_x = n_raw_x * Math.cos(BUILDING_ROT_ANGLE) - n_raw_y * Math.sin(BUILDING_ROT_ANGLE);
            const n_base_y = n_raw_x * Math.sin(BUILDING_ROT_ANGLE) + n_raw_y * Math.cos(BUILDING_ROT_ANGLE);
            const dx = (n_base_x + BUILDING_OFFSET_X) - x;
            const dy = (n_base_y + BUILDING_OFFSET_Y) - y;
            return (
              <g key={hexKey(n.q, n.r)}>
                <line x1={0} y1={0} x2={dx / 2} y2={dy / 2} stroke="#555" strokeWidth={8} strokeLinecap="round" className="pointer-events-none" />
                <line x1={0} y1={0} x2={dx / 2} y2={dy / 2} stroke="#888" strokeWidth={2} strokeDasharray="4,4" className="pointer-events-none" />
              </g>
            );
          }
          return null;
        })}
        {hex.hasRoad && <circle cx={0} cy={0} r={4} fill="#555" />}
        {hex.buildingId && !hasConstruction && (
          <text y={5} textAnchor="middle" className="select-none pointer-events-none text-[10px] font-bold fill-white drop-shadow-md">
            {BUILDINGS[hex.buildingId].name.substring(0, 3).toUpperCase()}
          </text>
        )}
      </g>
    );
  };

  const selectedHexData = selectedHex ? gameState.grid[selectedHex] : null;
  const selectedBuilding = selectedHexData?.buildingId ? BUILDINGS[selectedHexData.buildingId] : null;
  const selectedConstruction = selectedHexData?.constructionSite;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans">
      <div className="w-[400px] min-w-[400px] max-w-[400px] bg-zinc-900 border-r border-zinc-800 p-4 flex flex-col gap-6 overflow-y-auto">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-black tracking-tighter text-emerald-500 italic">INDUSTRIALIZER</h1>
          <div className="flex gap-2">
            <button onClick={toggleNetwork} className={`p-1 rounded ${gameState.showNetwork ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`} title="Toggle Network"><Info size={16} /></button>
            <button onClick={resetGame} className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-zinc-700" title="New Game"><Zap size={16} /></button>
          </div>
        </div>

        {/* Flow-based resource panel */}
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Resource Flows</h2>
          <div className="grid grid-cols-2 gap-2">
            {ALL_RESOURCES.map(res => {
              const potential = gameState.flowSummary.potential[res] || 0;
              const realized = gameState.flowSummary.realized[res] || 0;
              const consumed = gameState.flowSummary.consumed[res] || 0;
              const net = realized - consumed;
              const distLoss = gameState.flowSummary.lostToDistance[res] || 0;
              const shortageLoss = gameState.flowSummary.lostToShortage[res] || 0;
              const hasActivity = potential > 0 || consumed > 0;

              return (
                <div key={res} className={`px-1.5 py-1 rounded border flex flex-col h-[54px] ${hasActivity ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-zinc-800/30 border-zinc-700/30 opacity-50'}`}>
                  <span className="text-[9px] uppercase text-zinc-400 font-bold truncate">{res.replace('_', ' ')}</span>
                  {!hasActivity ? (
                    <span className="text-[9px] text-zinc-600 font-mono">No activity</span>
                  ) : (
                    <>
                      <div className="flex justify-between text-[9px] font-mono">
                        <span className="text-emerald-600">pot {potential.toFixed(1)}</span>
                        <span className="text-zinc-300">act {realized.toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between text-[9px] font-mono">
                        <span className="text-rose-400">use {consumed.toFixed(1)}</span>
                        <span className={`font-bold ${net > 0.01 ? 'text-emerald-400' : net < -0.01 ? 'text-rose-400' : 'text-zinc-500'}`}>
                          {net > 0 ? '+' : ''}{net.toFixed(1)}
                        </span>
                      </div>
                      <div className="text-[8px] font-mono text-zinc-500 mt-0.5">
                        {distLoss > 0.01 && <span className="text-amber-600">-{distLoss.toFixed(1)} dist </span>}
                        {shortageLoss > 0.01 && <span className="text-rose-500">-{shortageLoss.toFixed(1)} short</span>}
                        {distLoss <= 0.01 && shortageLoss <= 0.01 && <span className="invisible">-</span>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Hex details panel */}
        {selectedHex && selectedHexData && (
          <div className="space-y-4 pt-4 border-t border-zinc-800">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Hex Details</h2>
            <div className="bg-zinc-800 p-3 rounded-lg border border-zinc-700">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold capitalize">{getAssociatedTerrains(selectedHexData.q, selectedHexData.r).join('/')}</span>
                <span className="text-[10px] font-mono text-zinc-500">{selectedHex}</span>
              </div>

              {/* Construction site display */}
              {selectedConstruction && (
                <div className="p-2 bg-yellow-900/30 border border-yellow-700/50 rounded mb-3">
                  <p className="text-sm font-bold text-yellow-200">
                    {selectedConstruction.isUpgrade ? 'Upgrading to' : 'Building'}: {BUILDINGS[selectedConstruction.targetBuildingId]?.name || '???'}
                  </p>
                  {selectedConstruction.isUpgrade && selectedConstruction.previousBuildingId && (
                    <p className="text-[10px] text-yellow-400 mb-1">Current: {BUILDINGS[selectedConstruction.previousBuildingId]?.name} (still running)</p>
                  )}
                  {/* Overall progress */}
                  <div className="mt-2">
                    <div className="flex justify-between text-[9px] text-yellow-300 mb-1">
                      <span>Progress</span>
                      <span>{Math.floor(getConstructionProgress(selectedConstruction) * 100)}%</span>
                    </div>
                    <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-500 transition-all duration-500" style={{ width: `${getConstructionProgress(selectedConstruction) * 100}%` }} />
                    </div>
                  </div>
                  {/* Per-resource progress */}
                  <div className="mt-2 space-y-1">
                    {Object.entries(selectedConstruction.totalCost).map(([res, needed]) => {
                      const delivered = selectedConstruction.delivered[res] || 0;
                      const pct = Math.min(1, delivered / needed);
                      return (
                        <div key={res} className="flex items-center gap-2 text-[9px]">
                          <span className="capitalize text-zinc-400 w-16 truncate">{res.replace('_', ' ')}</span>
                          <div className="flex-1 h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                            <div className="h-full bg-yellow-600" style={{ width: `${pct * 100}%` }} />
                          </div>
                          <span className="text-zinc-400 font-mono w-14 text-right">{delivered.toFixed(1)}/{needed}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Active building detail */}
              {selectedBuilding && !selectedConstruction ? (
                <div>
                  <div className="p-2 bg-zinc-700/50 rounded mb-3">
                    <p className="text-sm font-bold">{selectedBuilding.name}</p>
                    <p className="text-xs text-zinc-400 mb-2">{selectedBuilding.description}</p>
                    <div className="text-[10px] space-y-1 border-t border-zinc-600 pt-2">
                      {/* Input diagnostics from flow state */}
                      {selectedHexData.flowState && selectedHexData.flowState.inputDiagnostics.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-zinc-500 uppercase text-[9px]">Inputs & Satisfaction:</span>
                          {selectedHexData.flowState.inputDiagnostics.map(diag => {
                            return (
                              <div key={diag.resource} className="bg-zinc-900/50 px-2 py-1 rounded">
                                <div className="flex justify-between items-center">
                                  <span className="capitalize">
                                    {diag.resource.replace('_', ' ')} ({diag.required}/s)
                                  </span>
                                  <span className={diag.satisfaction >= 1 ? 'text-emerald-400 font-bold' : diag.satisfaction > 0 ? 'text-amber-400 font-bold' : 'text-rose-500 font-bold'}>
                                    {Math.floor(diag.satisfaction * 100)}%
                                  </span>
                                </div>
                                {(diag.distanceLoss > 0.01 || diag.inputShortage > 0.01) && (
                                  <div className="text-[8px] text-zinc-500 mt-0.5">
                                    {diag.distanceLoss > 0.01 && <span className="text-amber-600">-{diag.distanceLoss.toFixed(2)} dist </span>}
                                    {diag.inputShortage > 0.01 && <span className="text-rose-500">-{diag.inputShortage.toFixed(2)} short</span>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* Realized vs potential outputs */}
                      <div className="flex flex-col gap-1 mt-1">
                        <span className="text-zinc-500 uppercase text-[9px]">Outputs:</span>
                        {selectedHexData.flowState && Object.entries(selectedHexData.flowState.potential).map(([res, pot]) => {
                          const real = selectedHexData.flowState!.realized[res] || 0;
                          const baseOutput = (selectedBuilding.outputs[res as ResourceType] || 0) as number;
                          const adjBonus = selectedHexData.flowState!.adjacencyBonus;
                          return (
                            <div key={res} className="bg-zinc-900/50 px-2 py-1 rounded">
                              <div className="flex justify-between items-center">
                                <span className="capitalize">{res.replace('_', ' ')}</span>
                                <span>
                                  <span className="text-emerald-400 font-bold">{real.toFixed(1)}</span>
                                  <span className="text-zinc-500">/{pot.toFixed(1)}</span>
                                </span>
                              </div>
                              {adjBonus > 0 && (
                                <div className="text-[8px] text-cyan-400 mt-0.5">
                                  +{Math.round(adjBonus * 100)}% adjacency ({baseOutput.toFixed(1)} base + {(baseOutput * adjBonus).toFixed(1)} bonus)
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!selectedHexData.flowState && Object.entries(selectedBuilding.outputs).map(([res, amt]) => (
                          <div key={res} className="flex justify-between items-center bg-zinc-900/50 px-2 py-1 rounded">
                            <span className="capitalize">{res.replace('_', ' ')}</span>
                            <span className="text-emerald-400 font-bold">{amt}/s</span>
                          </div>
                        ))}
                      </div>
                      {/* Overall efficiency */}
                      <div className="flex justify-between border-t border-zinc-700 mt-1 pt-1 font-bold">
                        <span className="text-zinc-500 uppercase text-[9px]">Total Efficiency:</span>
                        <span className={(selectedHexData.flowState?.efficiency ?? 0) >= 1 ? 'text-emerald-400' : 'text-amber-400'}>
                          {Math.floor((selectedHexData.flowState?.efficiency ?? 0) * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  {/* Upgrade button */}
                  {selectedBuilding.upgradesTo && selectedBuilding.upgradeCost && !selectedConstruction && (() => {
                    const upgradeTarget = BUILDINGS[selectedBuilding.upgradesTo!];
                    return (
                      <button onClick={upgradeBuilding} className="w-full flex flex-col p-2 bg-indigo-900 hover:bg-indigo-700 mb-3 rounded text-left transition-colors group border border-indigo-700">
                        <span className="font-bold text-sm flex items-center gap-2 text-indigo-100"><Zap size={14} className="text-indigo-400" />Upgrade to {upgradeTarget.name}</span>
                        <div className="flex flex-col gap-1 mt-1">
                          <div className="flex flex-wrap gap-x-2 text-[9px] text-indigo-200 group-hover:text-indigo-100">
                            <span className="font-bold uppercase text-indigo-300">Cost:</span>
                            {Object.entries(selectedBuilding.upgradeCost!).map(([res, amt]) => <span key={res}>{res}: {amt}</span>)}
                            {Object.keys(selectedBuilding.upgradeCost!).length === 0 && <span>Free</span>}
                          </div>
                          {Object.keys(upgradeTarget.inputs).length > 0 && <div className="flex flex-wrap gap-x-2 text-[9px] text-indigo-300 group-hover:text-indigo-100 italic"><span className="font-bold uppercase not-italic text-indigo-300">Inputs:</span>{Object.entries(upgradeTarget.inputs).map(([res, amt]) => <span key={res}>{amt}/s {res}</span>)}</div>}
                          {Object.keys(upgradeTarget.outputs).length > 0 && <div className="flex flex-wrap gap-x-2 text-[9px] text-indigo-300 group-hover:text-indigo-100"><span className="font-bold uppercase text-indigo-300">Outputs:</span>{Object.entries(upgradeTarget.outputs).map(([res, amt]) => <span key={res}>{amt}/s {res}</span>)}</div>}
                        </div>
                      </button>
                    );
                  })()}
                  <button onClick={togglePriority} className={`w-full mb-2 p-2 rounded text-center transition-colors text-xs uppercase tracking-wider font-bold border ${selectedHexData.prioritized ? 'bg-amber-900/50 border-amber-700 text-amber-300 hover:bg-amber-800/50' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'}`}>{selectedHexData.prioritized ? 'Prioritized' : 'Prioritize'}</button>
                  <button onClick={demolishBuilding} className="w-full mb-3 p-2 bg-zinc-800 hover:bg-red-900/50 border border-zinc-700 hover:border-red-800 rounded text-center transition-colors text-xs text-zinc-400 hover:text-red-300 uppercase tracking-wider font-bold">Demolish Building</button>
                  {!selectedHexData.hasRoad && <button onClick={buildRoad} className="w-full flex flex-col p-2 bg-zinc-700 hover:bg-amber-600 rounded text-left transition-colors group"><span className="font-bold text-sm flex items-center gap-2"><Zap size={14} className="text-amber-400" />Build Road</span></button>}
                </div>
              ) : !selectedConstruction ? (
                /* Empty hex — show available buildings */
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-400 mb-1">Available Buildings:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {Object.values(BUILDINGS).filter(b => {
                        const associatedTerrains = getAssociatedTerrains(selectedHexData.q, selectedHexData.r);
                        return (!b.requiresTerrain || b.requiresTerrain.some(t => associatedTerrains.includes(t as any))) && b.unlockEra <= gameState.era;
                      }).map(b => (
                        <button key={b.id} onClick={() => buildBuilding(b.id)} className="flex flex-col p-2 bg-zinc-700 hover:bg-emerald-600 rounded text-left transition-colors group">
                          <span className="font-bold text-sm">{b.name}</span>
                          <div className="flex flex-col gap-1 mt-1">
                            <div className="flex flex-wrap gap-x-2 text-[9px] text-zinc-300 group-hover:text-emerald-100">
                              <span className="font-bold uppercase text-zinc-400 group-hover:text-emerald-200">Cost:</span>
                              {Object.entries(b.cost).map(([res, amt]) => <span key={res}>{res}: {amt}</span>)}
                              {Object.keys(b.cost).length === 0 && <span>Free</span>}
                            </div>
                            {Object.keys(b.inputs).length > 0 && <div className="flex flex-wrap gap-x-2 text-[9px] text-zinc-400 group-hover:text-emerald-100 italic"><span className="font-bold uppercase not-italic group-hover:text-emerald-200">Inputs:</span>{Object.entries(b.inputs).map(([res, amt]) => <span key={res}>{amt}/s {res}</span>)}</div>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  {!selectedHexData.hasRoad && <button onClick={buildRoad} className="w-full flex flex-col p-2 bg-zinc-700 hover:bg-amber-600 rounded text-left transition-colors group"><span className="font-bold text-sm flex items-center gap-2"><Zap size={14} className="text-amber-400" />Build Road</span></button>}
                </div>
              ) : (
                /* Construction site selected — show cancel option */
                <div>
                  <button onClick={demolishBuilding} className="w-full p-2 bg-zinc-800 hover:bg-red-900/50 border border-zinc-700 hover:border-red-800 rounded text-center transition-colors text-xs text-zinc-400 hover:text-red-300 uppercase tracking-wider font-bold">Cancel Construction</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 to-zinc-950">
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
              {Object.values(gameState.grid).map(hex => renderHex(hex))}
            </g>
          </g>
        </svg>
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-4">
          <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-4 py-2 rounded-full flex items-center gap-2" title={
            gameState.era === 1 ? 'Next era: produce iron ingots (build a Bloomery)' :
            gameState.era === 2 ? 'Next era: produce iron ingots AND tools' :
            'Final era reached'
          }><Zap size={14} className="text-yellow-500" /><span className="text-sm font-bold font-mono">ERA {gameState.era}</span></div>
          <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-4 py-2 rounded-full flex items-center gap-2"><Info size={14} className="text-blue-400" /><span className="text-sm font-bold font-mono text-zinc-400">TICK {gameState.tick}</span></div>
        </div>
      </div>
    </div>
  );
};

export default App;
