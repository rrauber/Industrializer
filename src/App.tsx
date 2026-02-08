import React, { useState, useEffect } from 'react';
import { HexData, TerrainHex, ResourceMap, GameState, ResourceType, TerrainType } from './types';
import { hexKey, hexToPixel, pointyHexToPixel, pixelToPointyHex, getHexCorners, getNeighbors } from './hexUtils';
import { BUILDINGS, TERRAIN_COLORS } from './constants';
import { Zap, Info } from 'lucide-react';

const HEX_SIZE = 25;
const LARGE_HEX_SIZE = HEX_SIZE * Math.sqrt(3);
const GRID_RADIUS = 15;
const TERRAIN_RADIUS = 5;

const BUILDING_OFFSET_X = -HEX_SIZE * 0.5;
const BUILDING_OFFSET_Y = -HEX_SIZE * Math.sqrt(3) / 2;
const BUILDING_ROT_ANGLE = Math.PI / 3; // 60 degrees

const INITIAL_RESOURCES: ResourceMap = {
  food: 200,
  wood: 50,
  stone: 0,
  iron_ore: 0,
  coal: 0,
  iron_ingot: 0,
  tools: 5,
  concrete: 0,
  steel: 0,
  population: 0,
};

const INITIAL_CAPS: ResourceMap = {
  food: 2000,
  wood: 1000,
  stone: 1000,
  iron_ore: 500,
  coal: 500,
  iron_ingot: 200,
  tools: 100,
  concrete: 200,
  steel: 200,
  population: 10000,
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(() => {
    const saved = localStorage.getItem('industrializer_save');
    const resetPending = sessionStorage.getItem('industrializer_reset');
    
    if (saved && !resetPending) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.terrainGrid && Object.keys(parsed.terrainGrid).length > 0) {
          return {
            ...parsed,
            actualOutput: parsed.actualOutput || {},
            potentialOutput: parsed.potentialOutput || {},
            rates: parsed.rates || {},
            stockpileTargets: parsed.stockpileTargets || {},
            caps: parsed.caps || INITIAL_CAPS,
          };
        }
      } catch (e) {
        console.error("Failed to load save", e);
      }
    }

    if (resetPending) sessionStorage.removeItem('industrializer_reset');

    const terrainGrid: Record<string, { q: number, r: number, terrain: any }> = {};
    for (let q = -TERRAIN_RADIUS; q <= TERRAIN_RADIUS; q++) {
      const r1 = Math.max(-TERRAIN_RADIUS, -q - TERRAIN_RADIUS);
      const r2 = Math.min(TERRAIN_RADIUS, -q + TERRAIN_RADIUS);
      for (let r = r1; r <= r2; r++) {
        const rand = Math.random();
        let terrain = 'plains';
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
      resources: INITIAL_RESOURCES,
      rates: {},
      actualOutput: {},
      potentialOutput: {},
      stockpileTargets: {},
      caps: INITIAL_CAPS,
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
    const { x: raw_x, y: raw_y } = hexToPixel(q, r, HEX_SIZE);
    
    // Apply 60 deg rotation
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
        const dist = Math.sqrt((x - tx)**2 + (y - ty)**2);
        if (dist < LARGE_HEX_SIZE * 1.05) terrains.add(terrainHex.terrain);
      }
    });
    return Array.from(terrains);
  };

  const getConstructionCost = (targetHex: HexData, baseCost: Partial<Record<ResourceType, number>>) => {
    const actualCost: Partial<Record<ResourceType, number>> = {};
    const gridValues = Object.values(gameState.grid);

    Object.entries(baseCost).forEach(([res, amount]) => {
      const producers = gridValues.filter(h => h.buildingId && BUILDINGS[h.buildingId].outputs[res as ResourceType]);
      if (producers.length === 0) {
        actualCost[res as ResourceType] = amount;
      } else {
        let minPathCost = Infinity;
        producers.forEach(p => {
          const cost = getPathCost(p, targetHex, gameState.grid, 15);
          if (cost < minPathCost) minPathCost = cost;
        });
        if (minPathCost === Infinity) minPathCost = 15;
        actualCost[res as ResourceType] = (amount as number) * (1 + Math.max(0, minPathCost - 1) * 0.1);
      }
    });
    return actualCost;
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setGameState(prev => {
        const nextResources = { ...prev.resources };
        const nextGrid = { ...prev.grid };
        const currentRates: ResourceMap = {};
        const currentActual: ResourceMap = {};
        const currentPotential: ResourceMap = {};
        const startResources = { ...nextResources };

        nextResources['population'] = 0;
        const gridValues = Object.values(prev.grid);
        const producersByResource: Record<string, HexData[]> = {};
        gridValues.forEach(hex => {
          if (hex.buildingId) {
            Object.keys(BUILDINGS[hex.buildingId].outputs).forEach(res => {
              if (!producersByResource[res]) producersByResource[res] = [];
              producersByResource[res].push(hex);
            });
          }
        });

        const processBuilding = (hex: HexData) => {
          const key = hexKey(hex.q, hex.r);
          if (hex.buildingId) {
            const building = BUILDINGS[hex.buildingId];
            Object.entries(building.outputs).forEach(([res, amount]) => {
              currentPotential[res] = (currentPotential[res] || 0) + (amount as number);
            });

            let inputEfficiency = 1.0;
            const inputEffs: Record<string, number> = {};
            Object.entries(building.inputs).forEach(([res, amount]) => {
              const required = amount as number;
              let effectiveSupply = 0;
              (producersByResource[res] || []).forEach(p => {
                const outputRate = BUILDINGS[p.buildingId!].outputs[res as ResourceType]!;
                const cost = getPathCost(p, hex, prev.grid, 10);
                const transferEff = cost <= 1 ? 1.0 : Math.max(0, 1.0 - (cost - 1) * 0.1);
                effectiveSupply += outputRate * transferEff;
              });
              
              const target = prev.stockpileTargets[res] || 0;
              const globalAvailable = Math.max(0, (nextResources[res] || 0) - target);
              const hasGlobal = globalAvailable >= required;
              let ratio = required > 0 ? Math.min(1, effectiveSupply / required) : 1;
              if (ratio < 0.1 && hasGlobal) ratio = 0.1;
              if (!hasGlobal) ratio = Math.min(ratio, globalAvailable / required);
              
              inputEffs[res] = ratio;
              if (ratio < inputEfficiency) inputEfficiency = ratio;
            });

            nextGrid[key] = { ...nextGrid[key], lastEfficiency: inputEfficiency, inputEfficiencies: inputEffs };

            let isCapped = true;
            Object.keys(building.outputs).forEach(res => {
              if ((nextResources[res] || 0) < (prev.caps[res] || Infinity)) isCapped = false;
            });

            if (inputEfficiency > 0 && !isCapped) {
              Object.entries(building.inputs).forEach(([res, amount]) => {
                nextResources[res] -= (amount as number) * inputEfficiency;
              });

              let catalystEfficiency = 1.0;
              Object.entries(building.catalysts).forEach(([res, amount]) => {
                const required = (amount as number) * inputEfficiency;
                const target = prev.stockpileTargets[res] || 0;
                if ((nextResources[res] || 0) >= required + target) nextResources[res] -= required;
                else catalystEfficiency = 0.1;
              });

              Object.entries(building.outputs).forEach(([res, amount]) => {
                let multiplier = inputEfficiency * catalystEfficiency;
                const neighbors = getNeighbors(hex.q, hex.r);
                neighbors.forEach(n => {
                  const nHex = prev.grid[hexKey(n.q, n.r)];
                  if (nHex && nHex.buildingId === hex.buildingId) multiplier += 0.1;
                });
                const output = (amount as number) * multiplier;
                currentActual[res] = (currentActual[res] || 0) + output;
                nextResources[res] = Math.min(prev.caps[res] || Infinity, (nextResources[res] || 0) + output);
              });
            }
          }
        };

        gridValues.filter(hex => hex.buildingId && BUILDINGS[hex.buildingId].outputs['population']).forEach(processBuilding);
        gridValues.filter(hex => hex.buildingId && !BUILDINGS[hex.buildingId].outputs['population']).forEach(processBuilding);

        Object.keys(nextResources).forEach(key => {
          currentRates[key] = nextResources[key] - (startResources[key] || 0);
        });

        return { ...prev, resources: nextResources, rates: currentRates, actualOutput: currentActual, potentialOutput: currentPotential, grid: nextGrid, tick: prev.tick + 1 };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [getPathCost, gameState.grid, gameState.stockpileTargets, gameState.caps]);

  const buildBuilding = (buildingId: string) => {
    if (!selectedHex) return;
    const building = BUILDINGS[buildingId];
    const hex = gameState.grid[selectedHex];
    const scaledCost = getConstructionCost(hex, building.cost);
    let canAfford = true;
    Object.entries(scaledCost).forEach(([res, amount]) => {
      if ((gameState.resources[res] || 0) < (amount as number)) canAfford = false;
    });
    if (!canAfford) return;
    setGameState(prev => {
      const nextResources = { ...prev.resources };
      Object.entries(scaledCost).forEach(([res, amount]) => { nextResources[res] -= (amount as number); });
      return { ...prev, resources: nextResources, grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId } } };
    });
  };

  const buildRoad = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    if (hex.hasRoad) return;
    const scaledCost = getConstructionCost(hex, { stone: 10, wood: 5 });
    let canAfford = true;
    Object.entries(scaledCost).forEach(([res, amount]) => {
      if ((gameState.resources[res] || 0) < (amount as number)) canAfford = false;
    });
    if (!canAfford) return;
    setGameState(prev => {
      const nextResources = { ...prev.resources };
      Object.entries(scaledCost).forEach(([res, amount]) => { nextResources[res] -= (amount as number); });
      return { ...prev, resources: nextResources, grid: { ...prev.grid, [selectedHex]: { ...hex, hasRoad: true } } };
    });
  };

  const upgradeBuilding = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    if (!hex.buildingId) return;
    const building = BUILDINGS[hex.buildingId];
    if (!building.upgradesTo || !building.upgradeCost) return;
    const scaledCost = getConstructionCost(hex, building.upgradeCost);
    let canAfford = true;
    Object.entries(scaledCost).forEach(([res, amount]) => {
      if ((gameState.resources[res] || 0) < (amount as number)) canAfford = false;
    });
    if (!canAfford) return;
    setGameState(prev => {
      const nextResources = { ...prev.resources };
      Object.entries(scaledCost).forEach(([res, amount]) => { nextResources[res] -= (amount as number); });
      return { ...prev, resources: nextResources, grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId: building.upgradesTo } } };
    });
  };

  const demolishBuilding = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId: undefined } } }));
  };

  const renderTerrainHex = (hex: TerrainHex) => {
    const { x, y } = pointyHexToPixel(hex.q, hex.r, LARGE_HEX_SIZE);
    const corners = getHexCorners({ x: 0, y: 0 }, LARGE_HEX_SIZE, 30);
    return (
      <g key={`t-${hex.q},${hex.r}`} transform={`translate(${x}, ${y})`}>
        <polygon points={corners.map(p => `${p.x},${p.y}`).join(' ')} fill={TERRAIN_COLORS[hex.terrain]} stroke="#000" strokeWidth={1} opacity={0.6} />
      </g>
    );
  };

  const renderHex = (hex: HexData) => {
    const { x: raw_x, y: raw_y } = hexToPixel(hex.q, hex.r, HEX_SIZE);
    
    // Apply 60 deg rotation
    const base_x = raw_x * Math.cos(BUILDING_ROT_ANGLE) - raw_y * Math.sin(BUILDING_ROT_ANGLE);
    const base_y = raw_x * Math.sin(BUILDING_ROT_ANGLE) + raw_y * Math.cos(BUILDING_ROT_ANGLE);

    const x = base_x + BUILDING_OFFSET_X;
    const y = base_y + BUILDING_OFFSET_Y;
    const key = hexKey(hex.q, hex.r);
    const isSelected = selectedHex === key;
    const isHovered = hoveredHex === key;
    const corners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 0);
    const associatedTerrains = getAssociatedTerrains(hex.q, hex.r);
    const primaryTerrain = associatedTerrains[0] || 'water';

    return (
      <g key={key} transform={`translate(${x}, ${y})`} onMouseEnter={() => setHoveredHex(key)} onMouseLeave={() => setHoveredHex(null)} onClick={() => setSelectedHex(key)} className="cursor-pointer">
        <polygon points={corners.map(p => `${p.x},${p.y}`).join(' ')} fill={isSelected ? '#fff' : isHovered ? '#eee' : 'transparent'} stroke={isSelected ? '#fff' : isHovered ? '#bbb' : '#ffffff22'} strokeWidth={isSelected ? 2 : 1} className="transition-colors duration-200" />
        {!hex.buildingId && !hex.hasRoad && (
           <circle cx={0} cy={0} r={2} fill={TERRAIN_COLORS[primaryTerrain as TerrainType]} opacity={0.8} />
        )}
        {hex.hasRoad && getNeighbors(hex.q, hex.r).map((n) => {
          const nHex = gameState.grid[hexKey(n.q, n.r)];
          if (nHex && nHex.hasRoad) {
            const { x: n_raw_x, y: n_raw_y } = hexToPixel(n.q, n.r, HEX_SIZE);
            const n_base_x = n_raw_x * Math.cos(BUILDING_ROT_ANGLE) - n_raw_y * Math.sin(BUILDING_ROT_ANGLE);
            const n_base_y = n_raw_x * Math.sin(BUILDING_ROT_ANGLE) + n_raw_y * Math.cos(BUILDING_ROT_ANGLE);
            const dx = (n_base_x + BUILDING_OFFSET_X) - x;
            const dy = (n_base_y + BUILDING_OFFSET_Y) - y;
            return (
              <g key={hexKey(n.q, n.r)}>
                <line x1={0} y1={0} x2={dx/2} y2={dy/2} stroke="#555" strokeWidth={8} strokeLinecap="round" className="pointer-events-none" />
                <line x1={0} y1={0} x2={dx/2} y2={dy/2} stroke="#888" strokeWidth={2} strokeDasharray="4,4" className="pointer-events-none" />
              </g>
            );
          }
          return null;
        })}
        {hex.hasRoad && <circle cx={0} cy={0} r={4} fill="#555" />}
        {hex.buildingId && (
          <text y={5} textAnchor="middle" className="select-none pointer-events-none text-[10px] font-bold fill-white drop-shadow-md">
            {BUILDINGS[hex.buildingId].name.substring(0, 3).toUpperCase()}
          </text>
        )}
      </g>
    );
  };

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
        
        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Resources</h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(gameState.resources).map(([res, val]) => {
              const rate = gameState.rates[res] || 0;
              const actual = gameState.actualOutput[res] || 0;
              const potential = gameState.potentialOutput[res] || 0;
              const target = gameState.stockpileTargets[res] || 0;
              const cap = gameState.caps[res] || 0;
              return (
                <div key={res} className="bg-zinc-800/50 p-2 rounded border border-zinc-700/50 flex flex-col gap-1">
                  <div className="flex justify-between items-baseline">
                    <span className="text-[9px] uppercase text-zinc-400 font-bold truncate pr-1">{res.replace('_', ' ')}</span>
                    <span className={`text-[9px] font-mono font-bold ${rate > 0 ? 'text-emerald-400' : rate < 0 ? 'text-rose-400' : 'text-zinc-500'}`}>{rate > 0 ? '+' : ''}{rate !== 0 ? rate.toFixed(1) : '0.0'}</span>
                  </div>
                  <div className="flex items-center justify-between"><span className="text-sm font-mono font-black leading-none">{Math.floor(val)}</span><span className="text-[8px] text-zinc-500 font-mono">{actual.toFixed(1)}/{potential.toFixed(1)}</span></div>
                  <div className="flex flex-col gap-1 mt-1">
                     <div className="flex items-center justify-between"><span className="text-[8px] text-zinc-500 uppercase">Resv</span><input type="number" value={target} onChange={(e) => setGameState(prev => ({...prev, stockpileTargets: { ...prev.stockpileTargets, [res]: parseInt(e.target.value) || 0 }}))} className="w-10 bg-zinc-900 border border-zinc-700 text-[9px] px-1 rounded text-zinc-300 focus:outline-none focus:border-emerald-500" /></div>
                     <div className="flex items-center justify-between"><span className="text-[8px] text-zinc-500 uppercase">Cap</span><input type="number" value={cap} onChange={(e) => setGameState(prev => ({...prev, caps: { ...prev.caps, [res]: parseInt(e.target.value) || 0 }}))} className="w-10 bg-zinc-900 border border-zinc-700 text-[9px] px-1 rounded text-zinc-400 focus:outline-none focus:border-emerald-500" /></div>
                  </div>
                  <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden mt-1"><div className="h-full bg-zinc-600" style={{ width: `${Math.min(100, (val / (cap || 1)) * 100)}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>

        {selectedHex && (
          <div className="space-y-4 pt-4 border-t border-zinc-800">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Hex Details</h2>
            <div className="bg-zinc-800 p-3 rounded-lg border border-zinc-700">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold capitalize">{getAssociatedTerrains(gameState.grid[selectedHex].q, gameState.grid[selectedHex].r).join('/')}</span>
                <span className="text-[10px] font-mono text-zinc-500">{selectedHex}</span>
              </div>
              {!gameState.grid[selectedHex].buildingId ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-400 mb-1">Available Buildings:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {Object.values(BUILDINGS).filter(b => {
                        const associatedTerrains = getAssociatedTerrains(gameState.grid[selectedHex].q, gameState.grid[selectedHex].r);
                        return (!b.requiresTerrain || b.requiresTerrain.some(t => associatedTerrains.includes(t as any))) && b.unlockEra <= gameState.era;
                      }).map(b => {
                        const scaledCost = getConstructionCost(gameState.grid[selectedHex], b.cost);
                        return (
                          <button key={b.id} onClick={() => buildBuilding(b.id)} className="flex flex-col p-2 bg-zinc-700 hover:bg-emerald-600 rounded text-left transition-colors group">
                            <span className="font-bold text-sm">{b.name}</span>
                            <div className="flex flex-col gap-1 mt-1">
                              <div className="flex flex-wrap gap-x-2 text-[9px] text-zinc-300 group-hover:text-emerald-100">
                                <span className="font-bold uppercase text-zinc-400 group-hover:text-emerald-200">Cost:</span>
                                {Object.entries(scaledCost).map(([res, amt]) => <span key={res} className={((gameState.resources[res] || 0) < (amt as number)) ? 'text-rose-400' : ''}>{res}: {Math.ceil(amt as number)}</span>)}
                                {Object.keys(scaledCost).length === 0 && <span>Free</span>}
                              </div>
                              {Object.keys(b.inputs).length > 0 && <div className="flex flex-wrap gap-x-2 text-[9px] text-zinc-400 group-hover:text-emerald-100 italic"><span className="font-bold uppercase not-italic group-hover:text-emerald-200">Inputs:</span>{Object.entries(b.inputs).map(([res, amt]) => <span key={res}>{amt}/s {res}</span>)}</div>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="p-2 bg-zinc-700/50 rounded mb-3">
                    <p className="text-sm font-bold">{BUILDINGS[gameState.grid[selectedHex].buildingId!].name}</p>
                    <p className="text-xs text-zinc-400 mb-2">{BUILDINGS[gameState.grid[selectedHex].buildingId!].description}</p>
                    <div className="text-[10px] space-y-1 border-t border-zinc-600 pt-2">
                      <div className="flex flex-col gap-1">
                        <span className="text-zinc-500 uppercase text-[9px]">Inputs & Satisfaction:</span>
                        {Object.entries(BUILDINGS[gameState.grid[selectedHex].buildingId!].inputs).map(([res, amt]) => {
                          const eff = gameState.grid[selectedHex].inputEfficiencies?.[res] ?? 1;
                          return (
                            <div key={res} className="flex justify-between items-center bg-zinc-900/50 px-2 py-1 rounded">
                              <span className="capitalize">{res.replace('_', ' ')} ({amt}/s)</span>
                              <span className={eff >= 1 ? 'text-emerald-400 font-bold' : eff > 0 ? 'text-amber-400 font-bold' : 'text-rose-500 font-bold'}>{Math.floor(eff * 100)}%</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between mt-2"><span className="text-zinc-500 uppercase">Outputs:</span><span className="text-emerald-400 font-bold">{Object.entries(BUILDINGS[gameState.grid[selectedHex].buildingId!].outputs).map(([r, a]) => `${a} ${r}`).join(', ')}</span></div>
                      <div className="flex justify-between border-t border-zinc-700 mt-1 pt-1 font-bold"><span className="text-zinc-500 uppercase text-[9px]">Total Efficiency:</span><span className={gameState.grid[selectedHex].lastEfficiency === 1 ? 'text-emerald-400' : 'text-amber-400'}>{Math.floor((gameState.grid[selectedHex].lastEfficiency || 0) * 100)}%</span></div>
                    </div>
                  </div>
                  {BUILDINGS[gameState.grid[selectedHex].buildingId!].upgradesTo && <button onClick={upgradeBuilding} className="w-full flex flex-col p-2 bg-indigo-900 hover:bg-indigo-700 mb-3 rounded text-left transition-colors group border border-indigo-700"><span className="font-bold text-sm flex items-center gap-2 text-indigo-100"><Zap size={14} className="text-indigo-400" />Upgrade to {BUILDINGS[BUILDINGS[gameState.grid[selectedHex].buildingId!].upgradesTo!].name}</span></button>}
                  <button onClick={demolishBuilding} className="w-full mb-3 p-2 bg-zinc-800 hover:bg-red-900/50 border border-zinc-700 hover:border-red-800 rounded text-center transition-colors text-xs text-zinc-400 hover:text-red-300 uppercase tracking-wider font-bold">Demolish Building</button>
                  {!gameState.grid[selectedHex].hasRoad && <button onClick={buildRoad} className="w-full flex flex-col p-2 bg-zinc-700 hover:bg-amber-600 rounded text-left transition-colors group"><span className="font-bold text-sm flex items-center gap-2"><Zap size={14} className="text-amber-400" />Build Road</span></button>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-zinc-900 to-zinc-950">
        <svg viewBox={`-600 -600 1200 1200`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <g transform="translate(0, 0)">
            {Object.values(gameState.terrainGrid).map(hex => renderTerrainHex(hex as any))}
            {Object.values(gameState.grid).map(hex => renderHex(hex))}
          </g>
        </svg>
        <div className="absolute top-4 right-4 flex gap-4">
           <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-4 py-2 rounded-full flex items-center gap-2"><Zap size={14} className="text-yellow-500" /><span className="text-sm font-bold font-mono">ERA {gameState.era}</span></div>
           <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-4 py-2 rounded-full flex items-center gap-2"><Info size={14} className="text-blue-400" /><span className="text-sm font-bold font-mono text-zinc-400">TICK {gameState.tick}</span></div>
        </div>
      </div>
    </div>
  );
};

export default App;