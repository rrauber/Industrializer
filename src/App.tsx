import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { HexData, TerrainHex, GameState, ResourceType, TerrainType, InfrastructureType, InfrastructureEdge, FlowSummary, ConstructionSite, InfraEdgeConstructionSite } from './types';
import { hexKey, getEdgeKey, parseEdgeKey, pointyHexToPixel, getHexCorners, getNeighbors, countHexConnections, getHexesInRadius, hasIntersectionInRadius, edgeHasType, setEdgeType, isPowerInfra, hexDistance } from './hexUtils';
import { BUILDINGS, INFRASTRUCTURE_COSTS, MAX_INFRA_CONNECTIONS, TERRAIN_COLORS, DEPOSIT_COLORS, ERA_MILESTONES, INFRA_SPACING, INFRA_UNLOCK_ERA, HUB_RADIUS, MAP_RADIUS, HEX_SIZE, MARKET_CONFIG, WIN_PRICE_THRESHOLD } from './constants';
import { computeMarketPrices, computeTradeValue } from './economy';
import { generateTerrain } from './mapgen';
import { Zap, Box, Activity, Hammer, X, TrendingUp, Settings, Pause, Play, AlertTriangle, Info } from 'lucide-react';
import { BuildingIcons, ResourceIcons } from './icons';

function emptyFlowSummary(): FlowSummary {
  return { potential: {}, potentialDemand: {}, realized: {}, consumed: {}, exportConsumed: {}, lostToDistance: {}, lostToShortage: {} };
}

// All resource types to display
const ALL_RESOURCES: ResourceType[] = ['food', 'wood', 'stone', 'iron_ore', 'coal', 'iron_ingot', 'tools', 'concrete', 'steel', 'machinery', 'goods', 'electricity', 'population'];

const RESOURCE_COLORS: Record<string, string> = {
  food: '#84cc16', wood: '#4ade80', stone: '#a8a29e', iron_ore: '#f87171',
  coal: '#52525b', iron_ingot: '#fb923c', tools: '#38bdf8', concrete: '#94a3b8',
  steel: '#475569', machinery: '#818cf8', goods: '#e879f9', electricity: '#facc15',
  population: '#fbbf24',
};

// LIGHTER COLORS for buildings
const BUILDING_COLORS: Record<string, string> = {
  forager: '#aaddaa', farm: '#aaddaa', wood_camp: '#aaddaa', lumber_mill: '#aaddaa', industrial_farm: '#aaddaa', automated_sawmill: '#aaddaa',
  stone_camp: '#eecfa1', quarry: '#eecfa1', surface_mine: '#eecfa1', surface_coal: '#eecfa1', iron_mine: '#eecfa1', coal_mine: '#eecfa1', automated_quarry: '#eecfa1', automated_iron_mine: '#eecfa1', automated_coal_mine: '#eecfa1',
  bloomery: '#aabccf', smelter: '#aabccf', workshop: '#aabccf', tool_factory: '#aabccf', concrete_factory: '#aabccf', steel_mill: '#aabccf', machine_works: '#aabccf', manufactory: '#aabccf',
  coal_power_plant: '#aabccf', solar_array: '#aabccf', electric_arc_furnace: '#aabccf', automated_toolworks: '#aabccf', assembly_line: '#aabccf',
  electric_smelter: '#aabccf', electric_kiln: '#aabccf', precision_works: '#aabccf',
  export_port: '#ffe082', trade_depot: '#ffe082', station: '#ffe082',
  settlement: '#ffccbc', town: '#ffccbc', city: '#ffccbc', university: '#ffccbc',
};

function loadSave(parsed: any): GameState | null {
  // Force reset if save doesn't have mapSeed (old coordinate system)
  if (!parsed.mapSeed) return null;
  return {
    flowSummary: parsed.flowSummary || emptyFlowSummary(),
    grid: parsed.grid || {},
    terrainGrid: parsed.terrainGrid || {},
    infraEdges: parsed.infraEdges || {},
    infraConstructionSites: parsed.infraConstructionSites || [],
    era: Math.min(parsed.era || 1, 6),
    tick: parsed.tick || 0,
    totalExports: parsed.totalExports || {},
    exportRate: parsed.exportRate || {},
    tradeValue: parsed.tradeValue || 0,
    marketPrices: parsed.marketPrices || {},
    mapSeed: parsed.mapSeed,
  };
}

function createNewGame(): GameState {
  const seed = Date.now() ^ (Math.random() * 0xffffffff);
  const { terrainGrid, mapSeed } = generateTerrain(MAP_RADIUS, seed);
  const grid: Record<string, HexData> = {};
  for (const key of Object.keys(terrainGrid)) {
    const t = terrainGrid[key];
    grid[key] = { q: t.q, r: t.r };
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
    tradeValue: 0,
    marketPrices: {},
    mapSeed,
  };
}

// --- OPTIMIZED COMPONENTS ---

interface HexCompProps {
  hex: HexData;
  isSelected: boolean;
  isHovered: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const HexFill = React.memo(({ hex, isSelected, isHovered, onClick, onMouseEnter, onMouseLeave }: HexCompProps) => {
  const { x, y } = getHexPixelPos(hex);
  const hasConstruction = !!hex.constructionSite;
  
  let fill = 'transparent';
  if (hasConstruction) {
    const targetColor = BUILDING_COLORS[hex.constructionSite!.targetBuildingId] || '#a08000';
    fill = targetColor + '18';
  }
  
  if (isSelected) fill = '#ffffff30';
  else if (isHovered) fill = '#ffffff15';

  const hexCorners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 30);
  const cornersStr = hexCorners.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <g transform={`translate(${x}, ${y})`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={onClick} className="cursor-pointer">
      <polygon points={cornersStr} fill={fill} stroke="none" />
    </g>
  );
});

interface HexOverlayProps {
  hex: HexData;
  isSelected: boolean;
  isLabelHex: boolean;
  isInCluster: boolean;
  sameTypeEdges: Set<string>;
  efficiency: number;
}

const HexOverlay = React.memo(({ hex, isSelected, isLabelHex, isInCluster, sameTypeEdges, efficiency }: HexOverlayProps) => {
  const { x, y } = getHexPixelPos(hex);
  const key = hexKey(hex.q, hex.r);
  const hasConstruction = !!hex.constructionSite;
  const buildingColor = hex.buildingId ? (BUILDING_COLORS[hex.buildingId] || '#666') : null;
  const effColor = efficiency >= 0.9 ? '#4caf50' : efficiency >= 0.5 ? '#ffa726' : '#ef5350';
  const inCluster = isInCluster || isLabelHex;
  const hasBuilding = !!hex.buildingId && !hasConstruction;
  const IconComponent = hex.buildingId ? BuildingIcons[hex.buildingId] : null;

  const hexCorners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 30);
  const cornersStr = hexCorners.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <g transform={`translate(${x}, ${y})`} className="pointer-events-none">
      {isSelected && <polygon points={cornersStr} fill="none" stroke="#fbbf24" strokeWidth={3} opacity={0.8} />}
      {hexCorners.map((corner, i) => {
        const next = hexCorners[(i + 1) % 6];
        if (sameTypeEdges.has(`${key}|${i}`)) return null;
        if (hasBuilding) return <line key={i} x1={corner.x} y1={corner.y} x2={next.x} y2={next.y} stroke={buildingColor || '#fff'} strokeWidth={1.5} opacity={0.6} />;
        return null;
      })}
      {hasConstruction && <polygon points={cornersStr} fill="none" stroke="#d4a017" strokeWidth={1} strokeDasharray="3,2" />}
      {hasBuilding && IconComponent && isLabelHex && (
        <g opacity={inCluster ? 1 : 0.9}>
          <IconComponent color={buildingColor!} size={HEX_SIZE * 1.1} />
        </g>
      )}
      {hasBuilding && efficiency < 0.99 && <circle cx={HEX_SIZE * 0.6} cy={-HEX_SIZE * 0.6} r={3} fill={effColor} stroke="#000" strokeWidth={0.5} />}
      {hex.paused && hasBuilding && (
        <g transform={`translate(${-HEX_SIZE * 0.55}, ${-HEX_SIZE * 0.55})`}>
          <rect x={-2.5} y={-3.5} width={2} height={7} fill="#ef4444" rx={0.5} />
          <rect x={0.5} y={-3.5} width={2} height={7} fill="#ef4444" rx={0.5} />
        </g>
      )}
      {hasConstruction && (
        <>
          <rect x={-HEX_SIZE * 0.5} y={HEX_SIZE * 0.3} width={HEX_SIZE} height={3} fill="#1a1a1a" rx={1.5} />
          <rect x={-HEX_SIZE * 0.5} y={HEX_SIZE * 0.3} width={HEX_SIZE * getConstructionProgress(hex.constructionSite!)} height={3} fill="#eab308" rx={1.5} />
        </>
      )}
    </g>
  );
});

function getHexPixelPos(hex: { q: number; r: number }) {
  return pointyHexToPixel(hex.q, hex.r, HEX_SIZE);
}

function getConstructionProgress(site: ConstructionSite): number {
  let totalNeeded = 0, totalDelivered = 0;
  for (const [res, amount] of Object.entries(site.totalCost)) {
    totalNeeded += amount;
    totalDelivered += Math.min(site.delivered[res] || 0, amount);
  }
  return totalNeeded > 0 ? totalDelivered / totalNeeded : 1;
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(() => {
    const saved = localStorage.getItem('industrializer_save');
    const resetPending = sessionStorage.getItem('industrializer_reset');
    if (saved && !resetPending) {
      try {
        const parsed = JSON.parse(saved);
        const loaded = loadSave(parsed);
        if (loaded) return loaded;
        // Old save without mapSeed — force reset
        console.warn('Old save detected (no mapSeed) — starting new game');
      } catch (e) { console.error("Failed to load save", e); }
    }
    if (resetPending) sessionStorage.removeItem('industrializer_reset');
    return createNewGame();
  });

  useEffect(() => {
    localStorage.setItem('industrializer_save', JSON.stringify(gameState));
  }, [gameState]);

  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [hoveredHex, setHoveredHex] = useState<string | null>(null);
  const [infraPlacementMode, setInfraPlacementMode] = useState<{ type: InfrastructureType; fromHex: string; } | null>(null);
  const [buildTab, setBuildTab] = useState<'Agri' | 'Mine' | 'Ind' | 'Civic'>('Agri');
  const [hoveredBuildDelta, setHoveredBuildDelta] = useState<Record<string, number> | null>(null);
  const [showResourceLedger, setShowResourceLedger] = useState(false);
  const [gamePaused, setGamePaused] = useState(false);
  const [gameWon, setGameWon] = useState(false);

  // Pan/zoom — all in refs to avoid React re-renders during interaction
  const viewOffsetRef = useRef({ x: 0, y: 0 });
  const zoomLevelRef = useRef(1.0);
  const containerSizeRef = useRef({ w: 1200, h: 800 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const hasDraggedRef = useRef(false);
  const mainSvgRef = useRef<SVGSVGElement | null>(null);

  // Flow dot animation — continuous spawner, fully outside React's render tree
  interface FlowRoute {
    pixels: { x: number; y: number }[];
    segTimes: number[];     // cumulative time at each waypoint
    totalTime: number;      // sum of per-segment costs (determines duration)
    color: string;
    duration: number;       // seconds per dot
    spawnInterval: number;  // ms between spawns
    nextSpawnTime: number;  // performance.now() timestamp
  }
  interface FlowDotAnim {
    pixels: { x: number; y: number }[];
    segTimes: number[];
    totalTime: number;
    color: string;
    duration: number;
    birthTime: number;
  }
  const flowRoutesRef = useRef<FlowRoute[]>([]);
  const flowDotsRef = useRef<FlowDotAnim[]>([]);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const overlaySvgRef = useRef<SVGSVGElement | null>(null);
  const rafIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const terrainAssocRef = useRef<Record<string, TerrainType[]>>({});

  // Sync viewBox on both SVGs directly — no React re-render
  const syncViewBox = useCallback(() => {
    const { w, h } = containerSizeRef.current;
    const zoom = zoomLevelRef.current;
    const off = viewOffsetRef.current;
    const vbW = w / zoom;
    const vbH = h / zoom;
    const vb = `${off.x - vbW / 2} ${off.y - vbH / 2} ${vbW} ${vbH}`;
    if (mainSvgRef.current) mainSvgRef.current.setAttribute('viewBox', vb);
    if (overlaySvgRef.current) overlaySvgRef.current.setAttribute('viewBox', vb);
  }, []);

  // Track container resize
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    const update = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        containerSizeRef.current = { w, h };
        syncViewBox();
      }
    };
    const ro = new ResizeObserver(update);
    ro.observe(container);
    update();
    return () => ro.disconnect();
  }, [syncViewBox]);

  // 1:1 terrain associations — each hex maps to its own terrain
  const hexTerrainMap = useMemo(() => {
    const map = new Map<string, TerrainType[]>();
    for (const key of Object.keys(gameState.grid)) {
      const terrainHex = gameState.terrainGrid[key];
      map.set(key, terrainHex ? [terrainHex.terrain] : []);
    }
    return map;
  }, [gameState.terrainGrid]);

  const getAssociatedTerrains = (q: number, r: number): TerrainType[] => {
    return hexTerrainMap.get(hexKey(q, r)) || [];
  };

  // Sync terrain associations as a plain object for the Web Worker
  useMemo(() => {
    const obj: Record<string, TerrainType[]> = {};
    hexTerrainMap.forEach((v, k) => { obj[k] = v; });
    terrainAssocRef.current = obj;
  }, [hexTerrainMap]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (infraPlacementMode) setInfraPlacementMode(null);
        if (selectedHex) setSelectedHex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [infraPlacementMode, selectedHex]);

  const resetGame = () => {
    if (confirm('Are you sure you want to start a new game?')) {
      localStorage.removeItem('industrializer_save');
      sessionStorage.setItem('industrializer_reset', 'true');
      window.location.href = window.location.origin + window.location.pathname;
    }
  };

  // Continuous flow dot animation — overlay SVG, rAF spawner + animator
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    // Create overlay SVG imperatively — React never sees or touches this
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1 1');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    overlaySvgRef.current = svg;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(g);
    container.appendChild(svg);

    const animate = () => {
      const now = performance.now();
      const dots = flowDotsRef.current;
      const routes = flowRoutesRef.current;

      // Spawn new dots from routes (continuous, not tick-based)
      for (const route of routes) {
        if (now >= route.nextSpawnTime) {
          dots.push({
            pixels: route.pixels,
            segTimes: route.segTimes,
            totalTime: route.totalTime,
            color: route.color,
            duration: route.duration,
            birthTime: now,
          });
          route.nextSpawnTime = now + route.spawnInterval;
        }
      }

      // Prune finished dots in-place
      let write = 0;
      for (let i = 0; i < dots.length; i++) {
        if ((now - dots[i].birthTime) / 1000 < dots[i].duration) dots[write++] = dots[i];
      }
      dots.length = write;

      // Sync SVG circle count
      while (g.childNodes.length > dots.length) g.removeChild(g.lastChild!);
      while (g.childNodes.length < dots.length) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', '2');
        g.appendChild(c);
      }

      // Animate each dot
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        const c = g.childNodes[i] as SVGCircleElement;
        const t = Math.min(1, (now - dot.birthTime) / 1000 / dot.duration);
        // Interpolate along time-weighted path (speed varies per segment)
        const targetTime = t * dot.totalTime;
        let px = dot.pixels[0].x, py = dot.pixels[0].y;
        for (let s = 1; s < dot.pixels.length; s++) {
          if (dot.segTimes[s] >= targetTime) {
            const segStart = dot.segTimes[s - 1];
            const segLen = dot.segTimes[s] - segStart;
            const st = segLen > 0 ? (targetTime - segStart) / segLen : 0;
            px = dot.pixels[s - 1].x + (dot.pixels[s].x - dot.pixels[s - 1].x) * st;
            py = dot.pixels[s - 1].y + (dot.pixels[s].y - dot.pixels[s - 1].y) * st;
            break;
          }
        }
        c.setAttribute('cx', px.toFixed(1));
        c.setAttribute('cy', py.toFixed(1));
        c.setAttribute('fill', dot.color);
        // Fade in over first 8%, fade out over last 10%
        const opacity = t < 0.08 ? (t / 0.08) * 0.85 : t > 0.9 ? ((1 - t) / 0.1) * 0.85 : 0.85;
        c.setAttribute('opacity', opacity.toFixed(2));
      }
      rafIdRef.current = requestAnimationFrame(animate);
    };
    rafIdRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafIdRef.current);
      container.removeChild(svg);
    };
  }, []);

  // Web Worker for simulateTick — runs off main thread
  useEffect(() => {
    const worker = new Worker(new URL('./tickWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const { grid: workerGrid, flowSummary, exportRate, infraEdges: workerInfra, infraConstructionSites: workerInfraCS, routeData } = e.data;

      setGameState(prev => {
        // Merge worker grid with current state: preserve user mutations made while worker was running
        const sentGrid = sentGridRef.current;
        const sentInfra = sentInfraRef.current;
        const sentInfraCS = sentInfraCSRef.current;
        let mergedGrid: Record<string, HexData>;
        if (sentGrid) {
          mergedGrid = { ...workerGrid };
          for (const key of Object.keys(prev.grid)) {
            const cur = prev.grid[key];
            const sent = sentGrid[key];
            // If the user changed this hex after we sent the tick, keep the user's version
            if (cur.buildingId !== sent?.buildingId
              || cur.constructionSite !== sent?.constructionSite
              || cur.paused !== sent?.paused
              || cur.prioritized !== sent?.prioritized) {
              mergedGrid[key] = cur;
            }
          }
        } else {
          mergedGrid = workerGrid;
        }
        // Merge infra edges: keep user changes
        let mergedInfraEdges: Record<string, InfrastructureEdge>;
        if (sentInfra) {
          mergedInfraEdges = { ...workerInfra };
          // User-added edges
          for (const ek of Object.keys(prev.infraEdges)) {
            if (!(ek in sentInfra) && !(ek in workerInfra)) {
              mergedInfraEdges[ek] = prev.infraEdges[ek];
            }
          }
          // User-removed edges
          for (const ek of Object.keys(sentInfra)) {
            if (!(ek in prev.infraEdges) && ek in workerInfra) {
              delete mergedInfraEdges[ek];
            }
          }
        } else {
          mergedInfraEdges = workerInfra;
        }
        // Merge infra construction sites: keep user-added sites
        let mergedInfraCS: InfraEdgeConstructionSite[];
        if (sentInfraCS) {
          const workerEdgeKeys = new Set(workerInfraCS.map((s: InfraEdgeConstructionSite) => s.edgeKey));
          const sentEdgeKeys = new Set(sentInfraCS.map((s: InfraEdgeConstructionSite) => s.edgeKey));
          mergedInfraCS = [...workerInfraCS];
          // Add any construction sites the user started after the tick was sent
          for (const cs of prev.infraConstructionSites) {
            if (!sentEdgeKeys.has(cs.edgeKey) && !workerEdgeKeys.has(cs.edgeKey)) {
              mergedInfraCS.push(cs);
            }
          }
        } else {
          mergedInfraCS = workerInfraCS;
        }

        const totalExports = { ...prev.totalExports };
        for (const [res, amount] of Object.entries(exportRate)) {
          totalExports[res] = (totalExports[res] || 0) + (amount as number);
        }
        const marketPrices = computeMarketPrices(totalExports);
        const tradeValue = computeTradeValue(exportRate, marketPrices);
        let era = prev.era;
        while (ERA_MILESTONES[era + 1]) {
          const milestone = ERA_MILESTONES[era + 1];
          let met = false;
          if (milestone.type === 'cumulative' && milestone.requirements) {
            met = Object.entries(milestone.requirements).every(
              ([res, needed]) => (totalExports[res] || 0) >= (needed as number)
            );
          } else if (milestone.type === 'rate' && milestone.tradeValueTarget) {
            met = tradeValue >= milestone.tradeValueTarget;
          } else if (milestone.type === 'price' && milestone.priceThreshold && milestone.priceCount) {
            const crashed = Object.keys(MARKET_CONFIG).filter(res => {
              const baseVal = MARKET_CONFIG[res].base_value;
              return (marketPrices[res] || baseVal) <= baseVal * milestone.priceThreshold!;
            }).length;
            met = crashed >= milestone.priceCount;
          }
          if (met) era++;
          else break;
        }
        // Check win condition: all market prices ≤ WIN_PRICE_THRESHOLD
        const allCrashed = Object.keys(MARKET_CONFIG).every(res => {
          const baseVal = MARKET_CONFIG[res].base_value;
          return (marketPrices[res] || baseVal) <= WIN_PRICE_THRESHOLD;
        });
        if (allCrashed) setTimeout(() => setGameWon(true), 0);

        return { ...prev, grid: mergedGrid, flowSummary, era, tick: prev.tick + 1, exportRate, totalExports, marketPrices, tradeValue, infraEdges: mergedInfraEdges, infraConstructionSites: mergedInfraCS };
      });

      // Build flow routes from worker-computed paths (lightweight — just pixel conversion)
      const now = performance.now();
      const newRoutes: typeof flowRoutesRef.current = [];
      for (const { fp, path, segCosts } of routeData) {
        const pixels = path.map((h: { q: number; r: number }) => getHexPixelPos(h));
        if (pixels.length < 2) continue;
        // Build cumulative time from per-segment visual costs
        const segTimes = [0];
        let totalTime = 0;
        for (let s = 0; s < segCosts.length; s++) {
          totalTime += segCosts[s];
          segTimes.push(totalTime);
        }
        if (totalTime < 0.01) continue;
        const duration = Math.max(2.0, totalTime * 3.0);
        const baseInterval = Math.max(600, Math.min(8000, 800 / (fp.amount * 0.15)));
        newRoutes.push({
          pixels, segTimes, totalTime,
          color: RESOURCE_COLORS[fp.resource] || '#fff',
          duration, spawnInterval: baseInterval,
          nextSpawnTime: now + Math.random() * baseInterval,
        });
      }
      // Scale spawn intervals so total dots grow with economy but stay bounded
      // Target ~500 dots steady-state max; each route has ~(duration/interval) dots alive
      const estDots = newRoutes.reduce((s, r) => s + r.duration / (r.spawnInterval / 1000), 0);
      if (estDots > 500) {
        const scale = estDots / 500;
        for (const r of newRoutes) r.spawnInterval *= scale;
      }
      flowRoutesRef.current = newRoutes;
    };

    return () => worker.terminate();
  }, []);

  // Track grid snapshot sent to worker so we can detect user mutations
  const sentGridRef = useRef<Record<string, HexData> | null>(null);
  const sentInfraRef = useRef<Record<string, InfrastructureEdge> | null>(null);
  const sentInfraCSRef = useRef<InfraEdgeConstructionSite[] | null>(null);

  // Tick interval — posts state to worker (instant, no blocking)
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  useEffect(() => {
    if (gamePaused) return;
    const interval = setInterval(() => {
      const state = gameStateRef.current;
      sentGridRef.current = state.grid;
      sentInfraRef.current = state.infraEdges;
      sentInfraCSRef.current = state.infraConstructionSites;
      workerRef.current?.postMessage({
        grid: state.grid,
        terrainGrid: state.terrainGrid,
        terrainAssociations: terrainAssocRef.current,
        infraEdges: state.infraEdges,
        infraConstructionSites: state.infraConstructionSites,
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gamePaused]);

  const buildBuilding = (buildingId: string) => {
    if (!selectedHex) return;
    const building = BUILDINGS[buildingId];
    const hex = gameState.grid[selectedHex];
    const totalCost: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.cost)) {
      totalCost[res] = amount as number;
    }
    if (Object.keys(totalCost).length === 0) {
      setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId } } }));
      return;
    }
    const delivered: Record<string, number> = {};
    for (const res of Object.keys(totalCost)) delivered[res] = 0;
    const constructionSite: ConstructionSite = { targetBuildingId: buildingId, totalCost, delivered, isUpgrade: false };
    setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, constructionSite } } }));
  };

  const startInfraPlacement = (type: InfrastructureType) => {
    if (!selectedHex) return;
    setInfraPlacementMode({ type, fromHex: selectedHex });
  };

  const completeInfraPlacement = (toHexKey: string) => {
    if (!infraPlacementMode) return;
    const { type, fromHex } = infraPlacementMode;
    const [fromQ, fromR] = fromHex.split(',').map(Number);
    const [toQ, toR] = toHexKey.split(',').map(Number);

    const neighbors = getNeighbors(fromQ, fromR);
    if (!neighbors.some(n => n.q === toQ && n.r === toR)) { setInfraPlacementMode(null); return; }
    const ek = getEdgeKey(fromQ, fromR, toQ, toR);
    const existingEdge = gameState.infraEdges[ek];
    if (edgeHasType(existingEdge, type)) { setInfraPlacementMode(null); return; }

    // Hypothetical new state: real edges + construction site ghosts + the new edge
    const nextInfraEdges: Record<string, InfrastructureEdge> = {};
    for (const [k, e] of Object.entries(gameState.infraEdges)) nextInfraEdges[k] = { ...e };
    for (const site of gameState.infraConstructionSites) {
      nextInfraEdges[site.edgeKey] = setEdgeType(nextInfraEdges[site.edgeKey], site.targetType);
    }
    nextInfraEdges[ek] = setEdgeType(nextInfraEdges[ek], type);

    // Check Max Connections (physical edge count, not per-type)
    const fromConns = countHexConnections(fromQ, fromR, nextInfraEdges);
    const toConns = countHexConnections(toQ, toR, nextInfraEdges);
    if (fromConns > MAX_INFRA_CONNECTIONS || toConns > MAX_INFRA_CONNECTIONS) {
       setInfraPlacementMode(null);
       return;
    }

    // Check Spacing Rules (per-type intersection check)
    const spacing = INFRA_SPACING[type];
    const fromTypeConns = countHexConnections(fromQ, fromR, nextInfraEdges, type);
    const toTypeConns = countHexConnections(toQ, toR, nextInfraEdges, type);
    if (fromTypeConns > 2) {
       if (hasIntersectionInRadius(fromQ, fromR, type, nextInfraEdges, spacing)) {
          setInfraPlacementMode(null);
          console.log("Invalid placement: Intersection too close");
          return;
       }
    }
    if (toTypeConns > 2) {
       if (hasIntersectionInRadius(toQ, toR, type, nextInfraEdges, spacing)) {
          setInfraPlacementMode(null);
          console.log("Invalid placement: Intersection too close");
          return;
       }
    }

    if (type !== 'canal') {
      // Check connectivity: at least one endpoint must already be in the network
      const edgesWithoutNew: Record<string, InfrastructureEdge> = {};
      for (const [k, e] of Object.entries(nextInfraEdges)) edgesWithoutNew[k] = { ...e };
      delete edgesWithoutNew[ek];
      const totalEdges = Object.keys(edgesWithoutNew).length;
      if (totalEdges > 0) {
         const fromIn = countHexConnections(fromQ, fromR, edgesWithoutNew) > 0;
         const toIn = countHexConnections(toQ, toR, edgesWithoutNew) > 0;
         if (!fromIn && !toIn) { setInfraPlacementMode(null); return; }
      }
    }

    // Block if same-category construction already in progress on this edge
    const placingPower = isPowerInfra(type);
    if (gameState.infraConstructionSites.some(s => s.edgeKey === ek && isPowerInfra(s.targetType) === placingPower)) { setInfraPlacementMode(null); return; }

    const costs = INFRASTRUCTURE_COSTS[type];
    // Upgrade only within same category
    const sameCategoryExists = existingEdge && (placingPower ? !!existingEdge.power : !!existingEdge.transport);
    const isUpgrade = !!sameCategoryExists;
    const previousType = isUpgrade ? (placingPower ? existingEdge!.power : existingEdge!.transport) : undefined;
    if (Object.keys(costs).length === 0) {
      setGameState(prev => ({ ...prev, infraEdges: { ...prev.infraEdges, [ek]: setEdgeType(prev.infraEdges[ek], type) } }));
    } else {
      const totalCost: Record<string, number> = {};
      for (const [res, amount] of Object.entries(costs)) totalCost[res] = amount as number;
      const delivered: Record<string, number> = {};
      for (const res of Object.keys(totalCost)) delivered[res] = 0;
      const site: InfraEdgeConstructionSite = { edgeKey: ek, hexA: { q: fromQ, r: fromR }, hexB: { q: toQ, r: toR }, targetType: type, totalCost, delivered, isUpgrade, previousType };
      setGameState(prev => ({ ...prev, infraConstructionSites: [...prev.infraConstructionSites, site] }));
    }
    setInfraPlacementMode(null);
  };

  const demolishInfraEdge = (edgeKey: string, category?: 'transport' | 'power') => {
    setGameState(prev => {
      const newEdges = { ...prev.infraEdges };
      const edge = newEdges[edgeKey];
      if (edge && category) {
        const updated = { ...edge };
        if (category === 'transport') delete updated.transport;
        else delete updated.power;
        if (!updated.transport && !updated.power) delete newEdges[edgeKey];
        else newEdges[edgeKey] = updated;
      } else {
        delete newEdges[edgeKey];
      }
      const newSites = category
        ? prev.infraConstructionSites.filter(s => !(s.edgeKey === edgeKey && isPowerInfra(s.targetType) === (category === 'power')))
        : prev.infraConstructionSites.filter(s => s.edgeKey !== edgeKey);
      return { ...prev, infraEdges: newEdges, infraConstructionSites: newSites };
    });
  };

  const upgradeBuilding = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    if (!hex.buildingId) return;
    const building = BUILDINGS[hex.buildingId];
    if (!building.upgradesTo || !building.upgradeCost) return;
    if (BUILDINGS[building.upgradesTo].unlockEra > gameState.era) return;
    const totalCost: Record<string, number> = {};
    for (const [res, amount] of Object.entries(building.upgradeCost)) totalCost[res] = amount as number;
    const delivered: Record<string, number> = {};
    for (const res of Object.keys(totalCost)) delivered[res] = 0;
    if (Object.keys(totalCost).length === 0) {
      setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId: building.upgradesTo } } }));
      return;
    }
    const constructionSite: ConstructionSite = { targetBuildingId: building.upgradesTo, totalCost, delivered, isUpgrade: true, previousBuildingId: hex.buildingId };
    setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, constructionSite } } }));
  };

  const togglePriority = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, prioritized: !hex.prioritized } } }));
  };

  const togglePaused = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, paused: !hex.paused } } }));
  };

  const demolishBuilding = () => {
    if (!selectedHex) return;
    const hex = gameState.grid[selectedHex];
    if (hex.constructionSite?.isUpgrade && hex.constructionSite.previousBuildingId) {
      // Cancel upgrade: restore previous building
      setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId: hex.constructionSite!.previousBuildingId, constructionSite: undefined, flowState: undefined } } }));
    } else {
      setGameState(prev => ({ ...prev, grid: { ...prev.grid, [selectedHex]: { ...hex, buildingId: undefined, constructionSite: undefined, flowState: undefined } } }));
    }
  };

  const getEdgeConstructionProgress = (site: InfraEdgeConstructionSite): number => {
    let totalNeeded = 0, totalDelivered = 0;
    for (const [res, amount] of Object.entries(site.totalCost)) {
      totalNeeded += amount;
      totalDelivered += Math.min(site.delivered[res] || 0, amount);
    }
    return totalNeeded > 0 ? totalDelivered / totalNeeded : 1;
  };

  // Rendering helpers
  const clusterInfo = useMemo(() => {
    const sameTypeEdges = new Set<string>();
    const labelHex = new Map<string, string>();
    const visited = new Set<string>();
    const directions = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];

    for (const [key, hex] of Object.entries(gameState.grid)) {
      if (!hex.buildingId || hex.constructionSite || visited.has(key)) continue;
      const cluster: string[] = [];
      const queue = [key];
      visited.add(key);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        cluster.push(cur);
        const curHex = gameState.grid[cur];
        for (const d of directions) {
          const nk = hexKey(curHex.q + d.q, curHex.r + d.r);
          if (visited.has(nk)) continue;
          const nHex = gameState.grid[nk];
          if (nHex && nHex.buildingId === hex.buildingId && !nHex.constructionSite) {
            visited.add(nk);
            queue.push(nk);
          }
        }
      }
      for (const memberKey of cluster) {
        const mHex = gameState.grid[memberKey];
        for (let i = 0; i < 6; i++) {
          const nd = directions[5 - i];
          const nk = hexKey(mHex.q + nd.q, mHex.r + nd.r);
          if (cluster.includes(nk)) sameTypeEdges.add(`${memberKey}|${i}`);
        }
      }
      if (cluster.length === 1) labelHex.set(cluster[0], cluster[0]);
      else {
        let cx = 0, cy = 0;
        const positions = cluster.map(k => {
          const h = gameState.grid[k];
          const pos = pointyHexToPixel(h.q, h.r, HEX_SIZE);
          cx += pos.x; cy += pos.y;
          return { key: k, x: pos.x, y: pos.y };
        });
        cx /= cluster.length; cy /= cluster.length;
        let bestKey = cluster[0], bestDist = Infinity;
        for (const p of positions) {
          const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
          if (d < bestDist) { bestDist = d; bestKey = p.key; }
        }
        for (const k of cluster) labelHex.set(k, bestKey);
      }
    }
    // Hub buildings act as wildcards: suppress cluster borders between them and adjacent buildings
    const HUB_BUILDINGS = new Set(Object.keys(HUB_RADIUS));
    for (const [key, hex] of Object.entries(gameState.grid)) {
      if (!hex.buildingId || hex.constructionSite || !HUB_BUILDINGS.has(hex.buildingId)) continue;
      for (let i = 0; i < 6; i++) {
        const nd = directions[5 - i];
        const nk = hexKey(hex.q + nd.q, hex.r + nd.r);
        const nHex = gameState.grid[nk];
        if (nHex?.buildingId && !nHex.constructionSite) {
          sameTypeEdges.add(`${key}|${i}`);
        }
      }
    }

    return { sameTypeEdges, labelHex };
  }, [gameState.grid]);

  // Projected resource impact from buildings under construction
  const constructionProjection = useMemo(() => {
    const delta: Record<string, number> = {};
    for (const [, hex] of Object.entries(gameState.grid)) {
      if (!hex.constructionSite) continue;
      const target = BUILDINGS[hex.constructionSite.targetBuildingId];
      if (!target) continue;
      // Add projected outputs
      for (const [res, amt] of Object.entries(target.outputs)) {
        delta[res] = (delta[res] || 0) + (amt as number);
      }
      // Subtract projected inputs (new demand)
      for (const [res, amt] of Object.entries(target.inputs)) {
        delta[res] = (delta[res] || 0) - (amt as number);
      }
      // If upgrade, subtract old building's contribution (it will be replaced)
      if (hex.constructionSite.isUpgrade && hex.constructionSite.previousBuildingId) {
        const prev = BUILDINGS[hex.constructionSite.previousBuildingId];
        if (prev) {
          for (const [res, amt] of Object.entries(prev.outputs)) {
            delta[res] = (delta[res] || 0) - (amt as number);
          }
          for (const [res, amt] of Object.entries(prev.inputs)) {
            delta[res] = (delta[res] || 0) + (amt as number);
          }
        }
      }
    }
    return delta;
  }, [gameState.grid]);

  const terrainCorners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 30);
  const terrainCornersStr = terrainCorners.map(p => `${p.x},${p.y}`).join(' ');

  const renderTerrainHex = (hex: TerrainHex) => {
    const { x, y } = pointyHexToPixel(hex.q, hex.r, HEX_SIZE);
    const color = TERRAIN_COLORS[hex.terrain];
    return (
      <g key={`t-${hex.q},${hex.r}`} transform={`translate(${x}, ${y})`}>
        <polygon points={terrainCornersStr} fill={color} />
        <polygon points={terrainCornersStr} fill="none" stroke="#000000" strokeWidth={0.5} opacity={0.3} />
        {hex.deposit && (
          <circle cx={0} cy={0} r={HEX_SIZE * 0.18} fill={DEPOSIT_COLORS[hex.deposit]} stroke="#000" strokeWidth={0.5} opacity={0.8} />
        )}
      </g>
    );
  };

  const getHexPixelPos = (hex: { q: number; r: number }) => {
    return pointyHexToPixel(hex.q, hex.r, HEX_SIZE);
  };

  const hexCorners = getHexCorners({ x: 0, y: 0 }, HEX_SIZE, 30);
  const hexCornersStr = hexCorners.map(p => `${p.x},${p.y}`).join(' ');

  const getHexPixel = (q: number, r: number) => {
    return pointyHexToPixel(q, r, HEX_SIZE);
  };

  const renderInfrastructureEdges = () => {
    const elements: React.ReactNode[] = [];
    for (const [ek, edge] of Object.entries(gameState.infraEdges)) {
      const [a, b] = parseEdgeKey(ek);
      const pa = getHexPixel(a.q, a.r);
      const pb = getHexPixel(b.q, b.r);
      // Render transport layer first
      if (edge.transport === 'canal') {
        elements.push(<g key={`${ek}-t`} className="pointer-events-none"><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#0f1d2a" strokeWidth={6} strokeLinecap="round" opacity={0.7} /><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#1a2634" strokeWidth={2.5} strokeLinecap="round" /></g>);
      } else if (edge.transport === 'rail') {
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const perpX = -dy, perpY = dx;
        const len = Math.sqrt(perpX * perpX + perpY * perpY);
        const off = len > 0 ? 2.5 / len : 0;
        elements.push(<g key={`${ek}-t`} className="pointer-events-none"><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#3e2723" strokeWidth={6} strokeLinecap="round" opacity={0.5} /><line x1={pa.x + perpX * off} y1={pa.y + perpY * off} x2={pb.x + perpX * off} y2={pb.y + perpY * off} stroke="#8d6e63" strokeWidth={1.5} strokeLinecap="round" /><line x1={pa.x - perpX * off} y1={pa.y - perpY * off} x2={pb.x - perpX * off} y2={pb.y - perpY * off} stroke="#8d6e63" strokeWidth={1.5} strokeLinecap="round" /><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#a1887f" strokeWidth={0.5} strokeDasharray="2,4" /></g>);
      } else if (edge.transport === 'road') {
        elements.push(<g key={`${ek}-t`} className="pointer-events-none"><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#000000" strokeWidth={4} strokeLinecap="round" opacity={0.6} /><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#777" strokeWidth={2} strokeDasharray="3,3" /></g>);
      }
      // Render power layer on top
      if (edge.power === 'power_line') {
        elements.push(<g key={`${ek}-p`} className="pointer-events-none"><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#854d0e" strokeWidth={1.5} strokeLinecap="round" opacity={0.6} /><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#eab308" strokeWidth={1} strokeDasharray="4,3" /></g>);
      } else if (edge.power === 'hv_line') {
        elements.push(<g key={`${ek}-p`} className="pointer-events-none"><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#854d0e" strokeWidth={2.5} strokeLinecap="round" opacity={0.6} /><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#facc15" strokeWidth={1.5} strokeLinecap="round" /></g>);
      }
    }
    for (const site of gameState.infraConstructionSites) {
      const pa = getHexPixel(site.hexA.q, site.hexA.r);
      const pb = getHexPixel(site.hexB.q, site.hexB.r);
      const progress = getEdgeConstructionProgress(site as any);
      const midX = (pa.x + pb.x) / 2, midY = (pa.y + pb.y) / 2;
      const color = site.targetType === 'canal' ? '#42a5f5' : site.targetType === 'rail' ? '#8d6e63' : site.targetType === 'power_line' ? '#eab308' : site.targetType === 'hv_line' ? '#facc15' : '#9e9e9e';
      elements.push(<g key={`cs-${site.edgeKey}`} className="pointer-events-none"><line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray="4,4" opacity={0.35} /><rect x={midX - 8} y={midY - 1.5} width={16} height={3} fill="#111" rx={1.5} opacity={0.8} /><rect x={midX - 8} y={midY - 1.5} width={16 * progress} height={3} fill="#eab308" rx={1.5} /></g>);
    }
    return elements;
  };

  // Pan/zoom handlers — direct DOM, zero React re-renders
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomLevelRef.current = Math.max(0.5, Math.min(3.0, zoomLevelRef.current * delta));
    syncViewBox();
  }, [syncViewBox]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    const off = viewOffsetRef.current;
    dragStartRef.current = { x: e.clientX, y: e.clientY, vx: off.x, vy: off.y };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDraggedRef.current = true;
    if (hasDraggedRef.current) {
      viewOffsetRef.current = {
        x: dragStartRef.current.vx - dx / zoomLevelRef.current,
        y: dragStartRef.current.vy - dy / zoomLevelRef.current,
      };
      syncViewBox();
    }
  }, [syncViewBox]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const selectedHexData = selectedHex ? gameState.grid[selectedHex] : null;
  const selectedBuilding = selectedHexData?.buildingId ? BUILDINGS[selectedHexData.buildingId] : null;
  const selectedConstruction = selectedHexData?.constructionSite;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#05080a] text-zinc-100 font-sans selection:bg-emerald-500/30">
      
      {/* 1. Top Bar: Resources & Global Stats */}
      <div className="absolute top-0 left-0 right-0 h-14 bg-[#0e1218]/90 backdrop-blur-md border-b border-white/5 flex items-center px-4 justify-between z-10 shadow-xl">
         <div className="flex items-center gap-4 shrink-0">
            <h1 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
               <Box className="text-emerald-500 fill-emerald-500/20" size={24} />
               <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">INDUSTRIALIZER</span>
            </h1>
            <div className="h-6 w-px bg-white/10 mx-2" />
            <div className="flex gap-4 text-xs font-mono text-zinc-400">
               <span className="flex items-center gap-1.5"><Activity size={12} className="text-blue-400"/> ERA <span className="text-white font-bold">{gameState.era}</span></span>
               <span className="flex items-center gap-1.5"><TrendingUp size={12} className="text-emerald-400"/> TV <span className="text-white font-bold">{gameState.tradeValue.toFixed(1)}</span><span className="text-zinc-600">/tick</span></span>
            </div>
         </div>
         
         {/* Ticker-style Resources */}
         <div
            className="flex items-center gap-0.5 overflow-x-auto no-scrollbar mx-4 cursor-pointer hover:bg-white/5 px-1 py-1 rounded-lg transition-colors flex-wrap"
            onClick={() => setShowResourceLedger(true)}
            title="Open Resource Ledger"
         >
            {ALL_RESOURCES.map(res => {
               const realized = gameState.flowSummary.realized[res] || 0;
               const lossShort = gameState.flowSummary.lostToShortage[res] || 0;
               const potDem = gameState.flowSummary.potentialDemand[res] || 0;

               // Show unmet demand if buildings are short, otherwise production headroom
               const net = lossShort > 0 ? -lossShort : realized - potDem;

               // Projected change from buildings under construction
               const projDelta = constructionProjection[res] || 0;
               // Hover preview: projected change if this building were placed/upgraded
               const hoverDelta = hoveredBuildDelta ? (hoveredBuildDelta[res] || 0) : 0;
               const totalProj = projDelta + hoverDelta;

               if (realized <= 0 && potDem <= 0 && totalProj === 0) return null;
               const color = RESOURCE_COLORS[res];
               const isHoverAffected = hoverDelta !== 0;
               const wouldGoNegative = isHoverAffected && (net + projDelta + hoverDelta) < 0 && (net + projDelta) >= 0;
               return (
                  <div key={res} className={`flex items-center gap-0.5 min-w-max px-1 py-0.5 rounded ${isHoverAffected ? (wouldGoNegative ? 'bg-rose-500/20 ring-1 ring-rose-500/40' : 'bg-white/10 ring-1 ring-white/20') : ''}`} title={res.replace('_', ' ')}>
                     <div className="w-4 h-4 flex items-center justify-center">
                        <svg width="15" height="15" viewBox="-12 -12 24 24">
                           {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color, size: 15 })}
                        </svg>
                     </div>
                     <div className="flex flex-col items-start">
                        <span className={`text-[10px] font-mono font-bold leading-none ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-zinc-300'}`}>
                           {net > 0 ? '+' : ''}{net.toFixed(1)}
                        </span>
                        {totalProj !== 0 && (
                           <span className={`text-[8px] font-mono leading-none ${totalProj > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {totalProj > 0 ? '+' : ''}{totalProj.toFixed(1)}
                           </span>
                        )}
                     </div>
                  </div>
               )
            })}
         </div>

         <div className="flex gap-2 shrink-0">
            <button onClick={() => setGamePaused(p => !p)} className={`p-2 rounded-lg transition-all ${gamePaused ? 'bg-amber-500/20 text-amber-400' : 'hover:bg-white/5 text-zinc-500'}`}>{gamePaused ? <Play size={18} /> : <Pause size={18} />}</button>
            <button onClick={resetGame} className="p-2 rounded-lg hover:bg-white/5 text-zinc-500 hover:text-red-400 transition-all"><Settings size={18} /></button>
         </div>
      </div>

      {/* 2. Floating Sidebar */}
      <div className="absolute top-16 left-4 bottom-4 w-[360px] flex flex-col gap-3 pointer-events-none z-20">
         
         {/* Objective Card */}
         {(ERA_MILESTONES[gameState.era + 1] || (!gameWon && gameState.era >= 6)) && (() => {
           const milestone = ERA_MILESTONES[gameState.era + 1];
           // Win condition objective when no more era milestones
           if (!milestone) {
             const allRes = Object.keys(MARKET_CONFIG);
             const crashed = allRes.filter(res => {
               const baseVal = MARKET_CONFIG[res].base_value;
               return (gameState.marketPrices[res] || baseVal) <= WIN_PRICE_THRESHOLD;
             });
             const pct = Math.min(1, crashed.length / allRes.length);
             return (
               <div className="glass-panel rounded-xl p-4 pointer-events-auto">
                 <div className="flex justify-between items-center mb-3">
                   <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                     <TrendingUp size={14} className="text-amber-400" /> Final Objective
                   </span>
                   <span className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20 font-bold uppercase">Total Commoditization</span>
                 </div>
                 <div className="space-y-2">
                   <div className="flex justify-between items-center text-xs font-medium text-zinc-300">
                     <span className="text-[11px] font-bold">All prices below ${WIN_PRICE_THRESHOLD.toFixed(2)}</span>
                     <span className="font-mono text-zinc-400 text-[11px]">{crashed.length} <span className="text-zinc-700">/</span> {allRes.length}</span>
                   </div>
                   <div className="h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                     <div className="h-full transition-all duration-500 bg-amber-500" style={{ width: `${pct * 100}%` }} />
                   </div>
                   <div className="flex flex-wrap gap-1 mt-1">
                     {allRes.map(res => {
                       const baseVal = MARKET_CONFIG[res].base_value;
                       const price = gameState.marketPrices[res] ?? baseVal;
                       const isCrashed = price <= WIN_PRICE_THRESHOLD;
                       const resColor = RESOURCE_COLORS[res as ResourceType] || '#888';
                       return (
                         <div key={res} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono border ${isCrashed ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-black/20 border-white/5 text-zinc-500'}`}>
                           <svg width="10" height="10" viewBox="-12 -12 24 24">
                             {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: isCrashed ? resColor : '#555', size: 10 })}
                           </svg>
                           ${price.toFixed(2)}
                         </div>
                       );
                     })}
                   </div>
                 </div>
               </div>
             );
           }
           return (
           <div className="glass-panel rounded-xl p-4 pointer-events-auto">
              <div className="flex justify-between items-center mb-3">
                 <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp size={14} className="text-emerald-500" /> Current Objective
                 </span>
                 <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-bold uppercase">{milestone.label}</span>
              </div>
              <div className="space-y-2">
                 {milestone.type === 'cumulative' && milestone.requirements && Object.entries(milestone.requirements).map(([res, needed]) => {
                    const current = gameState.totalExports[res] || 0;
                    const pct = Math.min(1, current / (needed as number));
                    const resColor = RESOURCE_COLORS[res as ResourceType] || '#888';
                    return (
                       <div key={res} className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs font-medium text-zinc-300">
                             <div className="flex items-center gap-2">
                                <svg width="16" height="16" viewBox="-12 -12 24 24">
                                   {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: resColor, size: 16 })}
                                </svg>
                                <span className="capitalize text-[11px] font-bold">{res.replace('_', ' ')}</span>
                             </div>
                             <span className="font-mono text-zinc-400 text-[11px]">{Math.floor(current)} <span className="text-zinc-700">/</span> {needed}</span>
                          </div>
                          <div className="h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                             <div className="h-full transition-all duration-500" style={{ width: `${pct * 100}%`, backgroundColor: resColor }} />
                          </div>
                       </div>
                    )
                 })}
                 {milestone.type === 'rate' && milestone.tradeValueTarget && (() => {
                    const pct = Math.min(1, gameState.tradeValue / milestone.tradeValueTarget);
                    return (
                       <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs font-medium text-zinc-300">
                             <div className="flex items-center gap-2">
                                <TrendingUp size={14} className="text-emerald-400" />
                                <span className="text-[11px] font-bold">Trade Value / tick</span>
                             </div>
                             <span className="font-mono text-zinc-400 text-[11px]">{gameState.tradeValue.toFixed(1)} <span className="text-zinc-700">/</span> {milestone.tradeValueTarget}</span>
                          </div>
                          <div className="h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                             <div className="h-full transition-all duration-500 bg-emerald-500" style={{ width: `${pct * 100}%` }} />
                          </div>
                       </div>
                    );
                 })()}
                 {milestone.type === 'price' && milestone.priceThreshold && milestone.priceCount && (() => {
                    const allRes = Object.keys(MARKET_CONFIG);
                    const crashed = allRes.filter(res => {
                       const baseVal = MARKET_CONFIG[res].base_value;
                       return (gameState.marketPrices[res] || baseVal) <= baseVal * milestone.priceThreshold!;
                    });
                    const pct = Math.min(1, crashed.length / milestone.priceCount);
                    return (
                       <div className="space-y-2">
                          <div className="flex justify-between items-center text-xs font-medium text-zinc-300">
                             <div className="flex items-center gap-2">
                                <TrendingUp size={14} className="text-emerald-400" />
                                <span className="text-[11px] font-bold">Crash prices below {Math.round(milestone.priceThreshold * 100)}% base</span>
                             </div>
                             <span className="font-mono text-zinc-400 text-[11px]">{crashed.length} <span className="text-zinc-700">/</span> {milestone.priceCount}</span>
                          </div>
                          <div className="h-2 bg-black/40 rounded-full overflow-hidden border border-white/5">
                             <div className="h-full transition-all duration-500 bg-emerald-500" style={{ width: `${pct * 100}%` }} />
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                             {allRes.map(res => {
                                const baseVal = MARKET_CONFIG[res].base_value;
                                const price = gameState.marketPrices[res] ?? baseVal;
                                const isCrashed = price <= baseVal * milestone.priceThreshold!;
                                const resColor = RESOURCE_COLORS[res as ResourceType] || '#888';
                                return (
                                   <div key={res} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono border ${isCrashed ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-black/20 border-white/5 text-zinc-500'}`}>
                                      <svg width="10" height="10" viewBox="-12 -12 24 24">
                                         {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: isCrashed ? resColor : '#555', size: 10 })}
                                      </svg>
                                      ${price.toFixed(2)}
                                   </div>
                                );
                             })}
                          </div>
                       </div>
                    );
                 })()}
              </div>
           </div>
           );
         })()}

         {/* Main Context Panel */}
         <div className="glass-panel rounded-xl flex-1 flex flex-col overflow-hidden pointer-events-auto shadow-2xl">
            {selectedHex && selectedHexData ? (
               <>
                  <div className="p-4 border-b border-white/5 bg-white/[0.02]">
                     <div className="flex justify-between items-start">
                        <div>
                           <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Selected Hex</div>
                           <div className="text-sm font-bold text-white flex items-center gap-2">
                              {selectedBuilding ? selectedBuilding.name : selectedConstruction ? 'Construction Site' : 'Empty Terrain'}
                              {selectedHexData.prioritized && <Zap size={12} className="text-amber-400 fill-amber-400" />}
                           </div>
                           <div className="text-xs text-zinc-500 mt-0.5 capitalize">
                              {getAssociatedTerrains(selectedHexData.q, selectedHexData.r).join(', ')}
                              {gameState.terrainGrid[selectedHex]?.deposit && <span className="text-amber-400"> • {gameState.terrainGrid[selectedHex].deposit!.replace('_', ' ')} deposit</span>}
                              <span> • {selectedHex}</span>
                           </div>
                        </div>
                        <button onClick={() => setSelectedHex(null)} className="p-1 hover:bg-white/10 rounded text-zinc-500 hover:text-white"><X size={16}/></button>
                     </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
                     {/* INSPECT MODE */}
                     {selectedBuilding && !selectedConstruction && (
                        <div className="space-y-6">
                           
                           {/* Infrastructure Row (At the top for consistency) */}
                           <div className="flex gap-2">
                              {(['road', 'rail', 'canal', 'power_line', 'hv_line'] as InfrastructureType[]).filter(type => gameState.era >= INFRA_UNLOCK_ERA[type]).map(type => {
                                 const costs = INFRASTRUCTURE_COSTS[type];
                                 const isFree = Object.keys(costs).length === 0;
                                 return (
                                    <button
                                       key={type}
                                       onClick={() => startInfraPlacement(type)}
                                       className={`flex-1 py-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex flex-col items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed group relative`}
                                    >
                                       {type === 'road' && <div className="w-6 h-1 bg-zinc-400 rounded-full" />}
                                       {type === 'rail' && <div className="w-6 h-1 bg-amber-700 border-t border-b border-dashed border-amber-900" />}
                                       {type === 'canal' && <div className="w-6 h-1 bg-blue-500 opacity-60 rounded-full" />}
                                       {type === 'power_line' && <div className="w-6 h-1 bg-yellow-400 rounded-full" />}
                                       {type === 'hv_line' && <div className="w-6 h-1 bg-yellow-300 rounded-full shadow-[0_0_4px_#facc15]" />}
                                       <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider">{{ road: 'Road', rail: 'Rail', canal: 'Canal', power_line: 'Power', hv_line: 'HV' }[type]}</span>
                                       <div className="flex flex-wrap justify-center gap-2 mt-1">
                                          {isFree ? (
                                             <span className="text-[10px] text-emerald-500 font-bold uppercase">Free</span>
                                          ) : (
                                             Object.entries(costs).map(([res, amt]) => (
                                                <div key={res} className="flex items-center gap-1 text-[11px] font-bold text-zinc-300">
                                                   <svg width="14" height="14" viewBox="-12 -12 24 24">
                                                      {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                                   </svg>
                                                   <span>{amt}</span>
                                                </div>
                                             ))
                                          )}
                                       </div>
                                    </button>
                                 );
                              })}
                           </div>

                           <div className="flex justify-center py-4 bg-gradient-to-b from-white/5 to-transparent rounded-lg border border-white/5">
                              {BuildingIcons[selectedBuilding.id] && (
                                 <svg width="64" height="64" viewBox="-12 -12 24 24">
                                    {React.createElement(BuildingIcons[selectedBuilding.id], { color: BUILDING_COLORS[selectedBuilding.id], size: 24 })}
                                 </svg>
                              )}
                           </div>

                           {/* Efficiency Gauge */}
                           {selectedHexData.flowState && (
                              <div className="space-y-3">
                                 <div className="flex justify-between items-end">
                                    <span className="text-xs font-bold text-zinc-400">Efficiency</span>
                                    <span className={`text-xl font-black ${selectedHexData.flowState.efficiency >= 0.9 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                       {Math.round(selectedHexData.flowState.efficiency * 100)}%
                                    </span>
                                 </div>
                                 <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                                    <div className={`h-full transition-all duration-500 ${selectedHexData.flowState.efficiency >= 0.9 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${selectedHexData.flowState.efficiency * 100}%` }} />
                                 </div>
                                 
                                 <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
                                    <div className="bg-white/5 p-2 rounded flex flex-col items-center">
                                       <span className="mb-1">Cluster</span>
                                       <span className="text-white font-bold text-sm">+{Math.round((selectedHexData.flowState.clusterBonus || 0) * 100)}%</span>
                                    </div>
                                    <div className="bg-white/5 p-2 rounded flex flex-col items-center">
                                       <span className="mb-1">SC Output</span>
                                       <span className="text-emerald-400 font-bold text-sm">+{Math.round((selectedHexData.flowState.zoneOutputBonus || 0) * 100)}%</span>
                                    </div>
                                    <div className="bg-white/5 p-2 rounded flex flex-col items-center">
                                       <span className="mb-1">SC Input</span>
                                       <span className="text-sky-400 font-bold text-sm">-{Math.round((selectedHexData.flowState.zoneInputReduction || 0) * 100)}%</span>
                                    </div>
                                 </div>
                                 {(() => {
                                    const scSize = selectedHexData.flowState!.superclusterSize || 0;
                                    const scPct = scSize >= 42 ? 100 : scSize < 1 ? 0 : Math.round(Math.min(100, (scSize / 42) * 100));
                                    const thresholdPct = Math.round((21 / 42) * 100);
                                    return (
                                       <div className="text-[10px] text-zinc-500">
                                          <div className="flex justify-between mb-1">
                                             <span>Zone size: {scSize}/42</span>
                                             <span className={scSize >= 21 ? 'text-emerald-400' : 'text-zinc-500'}>{scSize >= 42 ? 'Max' : scSize >= 21 ? 'Active' : `${21 - scSize} to activate`}</span>
                                          </div>
                                          <div className="h-2 bg-black/40 rounded-full overflow-hidden relative">
                                             <div className="absolute h-full w-px bg-zinc-500/60" style={{ left: `${thresholdPct}%` }} />
                                             <div className={`h-full transition-all duration-500 ${scSize >= 21 ? 'bg-emerald-500' : 'bg-zinc-600'}`} style={{ width: `${scPct}%` }} />
                                          </div>
                                       </div>
                                    );
                                 })()}
                              </div>
                           )}

                           {/* Contextual Hints */}
                           {selectedHexData.flowState && (() => {
                              const fs = selectedHexData.flowState!;
                              const bid = selectedHexData.buildingId!;
                              const building = BUILDINGS[bid];
                              const hints: { type: 'warn' | 'info'; text: string }[] = [];

                              // Demand-gating: outputs exist but realized is 0 despite inputs being ok
                              const hasOutputs = Object.keys(building.outputs).length > 0;
                              const allOutputsZero = hasOutputs && Object.values(fs.realized).every(v => v === 0);
                              if (allOutputsZero && !selectedHexData.paused) {
                                 hints.push({ type: 'warn', text: 'No demand for outputs. Build consumers or a trade depot nearby.' });
                              }

                              // Export efficiency warning for hub/export buildings
                              if ((bid === 'trade_depot' || bid === 'station' || bid === 'export_port') && fs.exportEfficiency === 0) {
                                 hints.push({ type: 'warn', text: 'No export route. Connect infrastructure (road/rail/canal) to the map edge or coast.' });
                              }

                              // Distance loss warning
                              const totalDistLoss = fs.inputDiagnostics.reduce((s, d) => s + d.distanceLoss, 0);
                              const totalRequired = fs.inputDiagnostics.reduce((s, d) => s + d.required, 0);
                              if (totalRequired > 0 && totalDistLoss / totalRequired > 0.15) {
                                 hints.push({ type: 'warn', text: 'High distance loss. Build roads closer to suppliers.' });
                              }

                              // Hub radius info
                              if (HUB_RADIUS[bid]) {
                                 hints.push({ type: 'info', text: `Free resource flow within ${HUB_RADIUS[bid]} hexes. Acts as wildcard for cluster bonuses.` });
                              }

                              // Export efficiency info for hub/export buildings
                              if ((bid === 'trade_depot' || bid === 'station' || bid === 'export_port') && fs.exportEfficiency > 0) {
                                 hints.push({ type: 'info', text: `Export efficiency: ${Math.round(fs.exportEfficiency * 100)}%. Upgrade roads to rail/canal for better rates.` });
                              }

                              // Power + transport coexistence hint
                              if (bid === 'coal_power_plant' || bid === 'solar_array') {
                                 hints.push({ type: 'info', text: 'Electricity needs power lines. Power and transport can share the same edge.' });
                              }

                              if (hints.length === 0) return null;
                              return (
                                 <div className="space-y-1.5">
                                    {hints.map((h, i) => (
                                       <div key={i} className={`flex items-start gap-2 text-[10px] p-2 rounded ${h.type === 'warn' ? 'bg-amber-500/10 text-amber-300' : 'bg-sky-500/10 text-sky-300'}`}>
                                          {h.type === 'warn' ? <AlertTriangle size={12} className="shrink-0 mt-0.5" /> : <Info size={12} className="shrink-0 mt-0.5" />}
                                          <span>{h.text}</span>
                                       </div>
                                    ))}
                                 </div>
                              );
                           })()}

                           {/* Inputs/Outputs */}
                           <div className="space-y-2">
                              {selectedHexData.flowState?.inputDiagnostics.map(diag => (
                                 <div key={diag.resource} className="flex items-center gap-2 text-xs">
                                    <div className="w-4 h-4 flex items-center justify-center">
                                       <svg width="14" height="14" viewBox="-12 -12 24 24">
                                          {ResourceIcons[diag.resource] && React.createElement(ResourceIcons[diag.resource], { color: RESOURCE_COLORS[diag.resource as ResourceType] || '#fff', size: 14 })}
                                       </svg>
                                    </div>
                                    <span className="flex-1 capitalize text-zinc-300">{diag.resource.replace('_', ' ')}</span>
                                    <span className={`font-mono ${diag.satisfaction >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                       {((selectedHexData.flowState?.consumed[diag.resource] || 0) + diag.distanceLoss).toFixed(1)}
                                       <span className="text-zinc-600 ml-1">/ {diag.required.toFixed(1)}</span>
                                    </span>
                                 </div>
                              ))}
                              {Object.entries(selectedBuilding.outputs).map(([res]) => {
                                 const real = selectedHexData.flowState?.realized[res] || 0;
                                 return (
                                    <div key={res} className="flex items-center gap-2 text-xs">
                                       <div className="w-4 h-4 flex items-center justify-center">
                                          <svg width="14" height="14" viewBox="-12 -12 24 24">
                                             {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                          </svg>
                                       </div>
                                       <span className="flex-1 capitalize text-zinc-300">{res.replace('_', ' ')}</span>
                                       <span className="font-mono font-bold text-white">{real.toFixed(1)} <span className="text-zinc-600">/s</span></span>
                                    </div>
                                 )
                              })}
                           </div>

                           <div className="grid grid-cols-3 gap-2 pt-4">
                              <button onClick={togglePaused} className={`p-2 rounded font-bold text-xs transition-colors border ${selectedHexData.paused ? 'bg-red-500/20 border-red-500/50 text-red-300' : 'bg-white/5 border-transparent text-zinc-400 hover:bg-white/10'}`}>
                                 {selectedHexData.paused ? 'Paused' : 'Pause'}
                              </button>
                              <button onClick={togglePriority} className={`p-2 rounded font-bold text-xs transition-colors border ${selectedHexData.prioritized ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-white/5 border-transparent text-zinc-400 hover:bg-white/10'}`}>
                                 {selectedHexData.prioritized ? 'Prioritized' : 'Prioritize'}
                              </button>
                              <button onClick={demolishBuilding} className="p-2 rounded font-bold text-xs bg-red-500/10 text-red-400 border border-transparent hover:bg-red-500/20 transition-colors">
                                 Demolish
                              </button>
                              {selectedBuilding.upgradesTo && BUILDINGS[selectedBuilding.upgradesTo].unlockEra <= gameState.era && (() => {
                                 const target = BUILDINGS[selectedBuilding.upgradesTo!];
                                 const upgradeCost = selectedBuilding.upgradeCost || {};
                                 return (
                                    <div className="col-span-2 space-y-2 mt-2 pt-4 border-t border-white/5">
                                       <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Available Upgrade</div>
                                       <button onClick={upgradeBuilding} onMouseEnter={() => {
                                          const d: Record<string, number> = {};
                                          for (const [r, a] of Object.entries(target.outputs)) d[r] = (d[r] || 0) + (a as number);
                                          for (const [r, a] of Object.entries(target.inputs)) d[r] = (d[r] || 0) - (a as number);
                                          for (const [r, a] of Object.entries(selectedBuilding.outputs)) d[r] = (d[r] || 0) - (a as number);
                                          for (const [r, a] of Object.entries(selectedBuilding.inputs)) d[r] = (d[r] || 0) + (a as number);
                                          setHoveredBuildDelta(d);
                                       }} onMouseLeave={() => setHoveredBuildDelta(null)} className="w-full flex flex-col items-center gap-2 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all group">
                                          <div className="flex items-center gap-3 w-full">
                                             <div className="w-10 h-10 rounded-lg bg-[#0a0e12] border border-white/10 flex items-center justify-center">
                                                <svg width="24" height="24" viewBox="-12 -12 24 24">
                                                   {BuildingIcons[target.id] && React.createElement(BuildingIcons[target.id], { color: BUILDING_COLORS[target.id], size: 24 })}
                                                </svg>
                                             </div>
                                             <div className="text-left flex-1">
                                                <div className="text-[12px] font-bold text-white group-hover:text-indigo-300 transition-colors">{target.name}</div>
                                                <div className="text-[10px] text-zinc-500 leading-tight">{target.description}</div>
                                             </div>
                                          </div>
                                          
                                          <div className="w-full grid grid-cols-2 gap-4 pt-3 border-t border-white/10">
                                             <div className="text-left">
                                                <div className="text-[9px] text-zinc-500 font-black uppercase mb-1.5 tracking-wider">Upgrade Cost</div>
                                                <div className="flex flex-wrap gap-3">
                                                   {Object.entries(upgradeCost).length === 0 ? (
                                                      <span className="text-[11px] text-emerald-500 font-bold uppercase tracking-tight">Free</span>
                                                   ) : (
                                                      Object.entries(upgradeCost).map(([res, amt]) => (
                                                         <div key={res} className="flex items-center gap-1.5 text-[12px] font-bold text-zinc-200">
                                                            <svg width="14" height="14" viewBox="-12 -12 24 24">
                                                               {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                                            </svg>
                                                            {amt}
                                                         </div>
                                                      ))
                                                   )}
                                                </div>
                                             </div>
                                             <div className="text-left">
                                                <div className="text-[9px] text-zinc-500 font-black uppercase mb-1.5 tracking-wider">Consumption</div>
                                                <div className="flex flex-wrap gap-3">
                                                   {Object.entries(target.inputs).map(([res, amt]) => (
                                                      <div key={res} className="flex items-center gap-1.5 text-[12px] font-bold text-zinc-200">
                                                         <svg width="14" height="14" viewBox="-12 -12 24 24">
                                                            {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                                         </svg>
                                                         {amt}
                                                      </div>
                                                   ))}
                                                </div>
                                             </div>
                                             {Object.keys(target.outputs).length > 0 && (
                                                <div className="text-left col-span-2 pt-2 border-t border-white/5">
                                                   <div className="text-[9px] text-emerald-600 font-black uppercase mb-1.5 tracking-wider">Production</div>
                                                   <div className="flex flex-wrap gap-3">
                                                      {Object.entries(target.outputs).map(([res, amt]) => (
                                                         <div key={res} className="flex items-center gap-1.5 text-[12px] font-bold text-emerald-400/80">
                                                            <svg width="14" height="14" viewBox="-12 -12 24 24">
                                                               {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                                            </svg>
                                                            {amt}
                                                         </div>
                                                      ))}
                                                   </div>
                                                </div>
                                             )}
                                          </div>
                                       </button>
                                    </div>
                                 );
                              })()}
                           </div>

                           {/* Infra List */}
                           {(() => {
                               const hexEdges = Object.entries(gameState.infraEdges).filter(([ek]) => {
                                   const [a, b] = parseEdgeKey(ek);
                                   return (a.q === selectedHexData.q && a.r === selectedHexData.r) ||
                                          (b.q === selectedHexData.q && b.r === selectedHexData.r);
                               });
                               const hexEdgeSites = gameState.infraConstructionSites.filter(s =>
                                   (s.hexA.q === selectedHexData.q && s.hexA.r === selectedHexData.r) ||
                                   (s.hexB.q === selectedHexData.q && s.hexB.r === selectedHexData.r)
                               );

                               // Flatten edges into per-category entries
                               const edgeEntries: { ek: string; type: string; category: 'transport' | 'power'; other: { q: number; r: number } }[] = [];
                               for (const [ek, edge] of hexEdges) {
                                   const [a, b] = parseEdgeKey(ek);
                                   const other = (a.q === selectedHexData.q && a.r === selectedHexData.r) ? b : a;
                                   if (edge.transport) edgeEntries.push({ ek, type: edge.transport, category: 'transport', other });
                                   if (edge.power) edgeEntries.push({ ek, type: edge.power, category: 'power', other });
                               }

                               if (edgeEntries.length > 0 || hexEdgeSites.length > 0) {
                                   return (
                                       <div className="pt-4 border-t border-white/5 space-y-2">
                                           <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Infrastructure</div>
                                           <div className="space-y-1.5">
                                               {edgeEntries.map(({ ek, type, category, other }) => (
                                                       <div key={`${ek}-${category}`} className="flex items-center justify-between text-xs bg-white/5 px-2 py-1.5 rounded-lg border border-white/5">
                                                           <span className="capitalize text-zinc-400 font-medium">{type.replace('_', ' ')} to {other.q},{other.r}</span>
                                                           <button onClick={() => demolishInfraEdge(ek, category)} className="text-zinc-600 hover:text-red-400 px-1 transition-colors">×</button>
                                                       </div>
                                               ))}
                                               {hexEdgeSites.map(site => {
                                                   const other = (site.hexA.q === selectedHexData.q && site.hexA.r === selectedHexData.r) ? site.hexB : site.hexA;
                                                   return (
                                                       <div key={site.edgeKey} className="flex flex-col gap-1.5 bg-amber-500/5 p-2 rounded-lg border border-amber-500/10">
                                                           <div className="flex items-center justify-between text-[10px]">
                                                               <span className="capitalize text-amber-400 font-bold leading-tight flex-1 mr-2">Building {site.targetType.replace('_', ' ')} to {other.q},{other.r}</span>
                                                               <button onClick={() => demolishInfraEdge(site.edgeKey, isPowerInfra(site.targetType) ? 'power' : 'transport')} className="text-zinc-500 hover:text-red-400 transition-colors text-[9px] font-bold uppercase whitespace-nowrap">Cancel</button>
                                                           </div>
                                                           {Object.entries(site.totalCost).map(([res, cost]) => {
                                                               const del = site.delivered[res] || 0;
                                                               return (
                                                                   <div key={res} className="space-y-0.5">
                                                                       <div className="flex justify-between text-[9px] text-zinc-400">
                                                                           <span className="capitalize">{res.replace('_', ' ')}</span>
                                                                           <span>{Math.floor(del)} / {cost}</span>
                                                                       </div>
                                                                       <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                                                                           <div className="h-full bg-amber-500 transition-all" style={{ width: `${(del / cost) * 100}%` }} />
                                                                       </div>
                                                                   </div>
                                                               );
                                                           })}
                                                       </div>
                                                   );
                                               })}
                                           </div>
                                       </div>
                                   );
                               }
                               return null;
                           })()}
                        </div>
                     )}

                     {/* BUILD MODE */}
                     {!selectedBuilding && !selectedConstruction && (
                        <div className="space-y-4">
                           <div className="flex gap-2 mb-4">
                              {(['road', 'rail', 'canal', 'power_line', 'hv_line'] as InfrastructureType[]).filter(type => gameState.era >= INFRA_UNLOCK_ERA[type]).map(type => {
                                 const costs = INFRASTRUCTURE_COSTS[type];
                                 const isFree = Object.keys(costs).length === 0;
                                 return (
                                    <button
                                       key={type}
                                       onClick={() => startInfraPlacement(type)}
                                       className={`flex-1 py-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex flex-col items-center justify-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed group relative`}
                                    >
                                       {type === 'road' && <div className="w-6 h-1 bg-zinc-400 rounded-full" />}
                                       {type === 'rail' && <div className="w-6 h-1 bg-amber-700 border-t border-b border-dashed border-amber-900" />}
                                       {type === 'canal' && <div className="w-6 h-1 bg-blue-500 opacity-60 rounded-full" />}
                                       {type === 'power_line' && <div className="w-6 h-1 bg-yellow-400 rounded-full" />}
                                       {type === 'hv_line' && <div className="w-6 h-1 bg-yellow-300 rounded-full shadow-[0_0_4px_#facc15]" />}
                                       <span className="text-[10px] font-black uppercase text-zinc-400 tracking-wider">{{ road: 'Road', rail: 'Rail', canal: 'Canal', power_line: 'Power', hv_line: 'HV' }[type]}</span>
                                       <div className="flex flex-wrap justify-center gap-2 mt-1">
                                          {isFree ? (
                                             <span className="text-[10px] text-emerald-500 font-bold uppercase">Free</span>
                                          ) : (
                                             Object.entries(costs).map(([res, amt]) => (
                                                <div key={res} className="flex items-center gap-1 text-[11px] font-bold text-zinc-300">
                                                   <svg width="14" height="14" viewBox="-12 -12 24 24">
                                                      {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                                   </svg>
                                                   <span>{amt}</span>
                                                </div>
                                             ))
                                          )}
                                       </div>
                                    </button>
                                 );
                              })}
                           </div>

                           {/* Build Tabs */}
                           <div className="flex p-1 bg-black/40 rounded-lg mb-2">
                              {(['Agri', 'Mine', 'Ind', 'Civic'] as const).map(tab => {
                                 const tabColors: Record<string, string> = { Agri: '#aaddaa', Mine: '#eecfa1', Ind: '#aabccf', Civic: '#ffccbc' };
                                 const isActive = buildTab === tab;
                                 return (
                                    <button
                                       key={tab}
                                       onClick={() => setBuildTab(tab)}
                                       style={{ 
                                          backgroundColor: isActive ? tabColors[tab] : undefined,
                                          color: isActive ? '#05080a' : undefined 
                                       }}
                                       className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all flex items-center justify-center gap-1.5 ${isActive ? 'shadow-lg shadow-black/20' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    >
                                       {!isActive && <div className="w-1.5 h-1.5 rounded-full shadow-sm" style={{ backgroundColor: tabColors[tab] }} />}
                                       {tab}
                                    </button>
                                 );
                              })}
                           </div>

                           <div className="grid grid-cols-2 gap-2">
                              {(() => {
                                 const groups: Record<string, string[]> = {
                                    'Agri': ['forager', 'farm', 'industrial_farm', 'wood_camp', 'lumber_mill', 'automated_sawmill'],
                                    'Mine': ['stone_camp', 'quarry', 'automated_quarry', 'surface_mine', 'iron_mine', 'automated_iron_mine', 'surface_coal', 'coal_mine', 'automated_coal_mine'],
                                    'Ind': ['bloomery', 'smelter', 'workshop', 'tool_factory', 'concrete_factory', 'steel_mill', 'machine_works', 'manufactory', 'coal_power_plant', 'solar_array', 'electric_arc_furnace', 'electric_smelter', 'electric_kiln', 'precision_works', 'automated_toolworks', 'assembly_line'],
                                    'Civic': ['settlement', 'town', 'city', 'trade_depot', 'station', 'export_port', 'university']
                                 };
                                 return groups[buildTab].map(id => {
                                    const b = BUILDINGS[id];
                                    if (b.unlockEra > gameState.era) return null;
                                    const requires = b.requiresTerrain;
                                    const localTerrain = getAssociatedTerrains(selectedHexData.q, selectedHexData.r);
                                    const hasCanal = countHexConnections(selectedHexData.q, selectedHexData.r, gameState.infraEdges, 'canal') > 0;
                                    const canBuild = !requires || requires.some(t => localTerrain.includes(t) || (t === 'water' && hasCanal));
                                    if (!canBuild) return null;
                                    // Deposit check
                                    if (b.requiresDeposit) {
                                       const terrainHex = gameState.terrainGrid[selectedHex];
                                       if (!terrainHex || terrainHex.deposit !== b.requiresDeposit) return null;
                                    }

                                    return (
                                       <button
                                          key={id}
                                          onClick={() => buildBuilding(id)}
                                          onMouseEnter={() => {
                                             const d: Record<string, number> = {};
                                             for (const [r, a] of Object.entries(b.outputs)) d[r] = (d[r] || 0) + (a as number);
                                             for (const [r, a] of Object.entries(b.inputs)) d[r] = (d[r] || 0) - (a as number);
                                             setHoveredBuildDelta(d);
                                          }}
                                          onMouseLeave={() => setHoveredBuildDelta(null)}
                                          className="glass-card flex flex-col items-center p-3 rounded-xl gap-2 text-center group relative overflow-hidden"
                                       >
                                          <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                          <div className="w-10 h-10 rounded-lg bg-[#0a0e12] border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                                             {BuildingIcons[id] && (
                                                <svg width="24" height="24" viewBox="-12 -12 24 24">
                                                   {React.createElement(BuildingIcons[id], { color: BUILDING_COLORS[id], size: 24 })}
                                                </svg>
                                             )}
                                          </div>
                                          <div className="flex flex-col w-full">
                                             <span className="text-[11px] font-bold text-zinc-300 group-hover:text-white leading-tight">{b.name}</span>
                                             
                                             {/* Costs */}
                                             <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1.5">
                                                {Object.keys(b.cost).length === 0 ? (
                                                   <span className="text-[10px] text-emerald-500 font-bold uppercase">Free</span>
                                                ) : (
                                                   Object.entries(b.cost).map(([res, amt]) => (
                                                      <div key={res} className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-300 whitespace-nowrap">
                                                         <svg width="14" height="14" viewBox="-12 -12 24 24">
                                                            {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                                         </svg>
                                                         <span>{amt} <span className="opacity-50 text-[9px] font-medium lowercase tracking-tight">{res.replace('_', ' ')}</span></span>
                                                      </div>
                                                   ))
                                                )}
                                             </div>

                                             {/* Outputs (Produces) */}
                                             {Object.keys(b.outputs).length > 0 && (
                                                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-white/5">
                                                   <span className="text-[9px] text-emerald-600 font-black uppercase w-full mb-1 tracking-tighter">Produces</span>
                                                   {Object.entries(b.outputs).map(([res, amt]) => (
                                                      <div key={res} className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-400/80 whitespace-nowrap">
                                                         <svg width="14" height="14" viewBox="-12 -12 24 24">
                                                            {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                                         </svg>
                                                         <span>{amt} <span className="opacity-50 text-[9px] font-medium lowercase tracking-tight">{res.replace('_', ' ')}</span></span>
                                                      </div>
                                                   ))}
                                                </div>
                                             )}

                                             {/* Inputs (Consumes) */}
                                             {Object.keys(b.inputs).length > 0 && (
                                                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-white/5">
                                                   <span className="text-[9px] text-zinc-500 font-black uppercase w-full mb-1 tracking-tighter">Consumes</span>
                                                   {Object.entries(b.inputs).map(([res, amt]) => (
                                                      <div key={res} className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400 whitespace-nowrap">
                                                         <svg width="14" height="14" viewBox="-12 -12 24 24">
                                                            {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: RESOURCE_COLORS[res as ResourceType] || '#fff', size: 14 })}
                                                         </svg>
                                                         <span>{amt} <span className="opacity-50 text-[9px] font-medium lowercase tracking-tight">{res.replace('_', ' ')}</span></span>
                                                      </div>
                                                   ))}
                                                </div>
                                             )}
                                          </div>
                                       </button>
                                    );
                                 });
                              })()}
                           </div>

                           {/* Infra List (empty hex) */}
                           {(() => {
                               const hexEdges = Object.entries(gameState.infraEdges).filter(([ek]) => {
                                   const [a, b] = parseEdgeKey(ek);
                                   return (a.q === selectedHexData.q && a.r === selectedHexData.r) ||
                                          (b.q === selectedHexData.q && b.r === selectedHexData.r);
                               });
                               const hexEdgeSites = gameState.infraConstructionSites.filter(s =>
                                   (s.hexA.q === selectedHexData.q && s.hexA.r === selectedHexData.r) ||
                                   (s.hexB.q === selectedHexData.q && s.hexB.r === selectedHexData.r)
                               );

                               const edgeEntries: { ek: string; type: string; category: 'transport' | 'power'; other: { q: number; r: number } }[] = [];
                               for (const [ek, edge] of hexEdges) {
                                   const [a, b] = parseEdgeKey(ek);
                                   const other = (a.q === selectedHexData.q && a.r === selectedHexData.r) ? b : a;
                                   if (edge.transport) edgeEntries.push({ ek, type: edge.transport, category: 'transport', other });
                                   if (edge.power) edgeEntries.push({ ek, type: edge.power, category: 'power', other });
                               }

                               if (edgeEntries.length > 0 || hexEdgeSites.length > 0) {
                                   return (
                                       <div className="pt-4 border-t border-white/5 space-y-2">
                                           <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Infrastructure</div>
                                           <div className="space-y-1.5">
                                               {edgeEntries.map(({ ek, type, category, other }) => (
                                                       <div key={`${ek}-${category}`} className="flex items-center justify-between text-xs bg-white/5 px-2 py-1.5 rounded-lg border border-white/5">
                                                           <span className="capitalize text-zinc-400 font-medium">{type.replace('_', ' ')} to {other.q},{other.r}</span>
                                                           <button onClick={() => demolishInfraEdge(ek, category)} className="text-zinc-600 hover:text-red-400 px-1 transition-colors">×</button>
                                                       </div>
                                               ))}
                                               {hexEdgeSites.map(site => {
                                                   const other = (site.hexA.q === selectedHexData.q && site.hexA.r === selectedHexData.r) ? site.hexB : site.hexA;
                                                   return (
                                                       <div key={site.edgeKey} className="flex flex-col gap-1.5 bg-amber-500/5 p-2 rounded-lg border border-amber-500/10">
                                                           <div className="flex items-center justify-between text-[10px]">
                                                               <span className="capitalize text-amber-400 font-bold leading-tight flex-1 mr-2">Building {site.targetType.replace('_', ' ')} to {other.q},{other.r}</span>
                                                               <button onClick={() => demolishInfraEdge(site.edgeKey, isPowerInfra(site.targetType) ? 'power' : 'transport')} className="text-zinc-500 hover:text-red-400 transition-colors text-[9px] font-bold uppercase whitespace-nowrap">Cancel</button>
                                                           </div>
                                                           {Object.entries(site.totalCost).map(([res, cost]) => {
                                                               const del = site.delivered[res] || 0;
                                                               return (
                                                                   <div key={res} className="space-y-0.5">
                                                                       <div className="flex justify-between text-[9px] text-zinc-400">
                                                                           <span className="capitalize">{res.replace('_', ' ')}</span>
                                                                           <span>{Math.floor(del)} / {cost}</span>
                                                                       </div>
                                                                       <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                                                                           <div className="h-full bg-amber-500 transition-all" style={{ width: `${(del / cost) * 100}%` }} />
                                                                       </div>
                                                                   </div>
                                                               );
                                                           })}
                                                       </div>
                                                   );
                                               })}
                                           </div>
                                       </div>
                                   );
                               }
                               return null;
                           })()}
                        </div>
                     )}

                     {/* CONSTRUCTION MODE */}
                     {selectedConstruction && (
                        <div className="space-y-4 text-center">
                           <div className="inline-flex p-3 rounded-full bg-amber-500/10 text-amber-500 mb-2 border border-amber-500/20">
                              <Hammer size={24} className="animate-pulse" />
                           </div>
                           <div>
                              <div className="text-sm font-bold text-white mb-1">Under Construction</div>
                              <div className="text-xs text-zinc-400">{BUILDINGS[selectedConstruction.targetBuildingId].name}</div>
                           </div>
                           <div className="space-y-2 bg-black/20 p-3 rounded-lg">
                              {Object.entries(selectedConstruction.totalCost).map(([res, cost]) => {
                                 const del = selectedConstruction.delivered[res] || 0;
                                 return (
                                    <div key={res} className="space-y-1">
                                       <div className="flex justify-between text-[10px] text-zinc-400">
                                          <span className="capitalize">{res}</span>
                                          <span>{Math.floor(del)} / {cost}</span>
                                       </div>
                                       <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                                          <div className="h-full bg-amber-500" style={{ width: `${(del/cost)*100}%` }} />
                                       </div>
                                    </div>
                                 )
                              })}
                           </div>
                           <button onClick={demolishBuilding} className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded">Cancel</button>
                        </div>
                     )}
                  </div>
               </>
            ) : (
               <div className="p-4 h-full flex flex-col items-center justify-center text-center">
                  <div className="text-zinc-600 text-xs">Select a hex to inspect or build</div>
               </div>
            )}
         </div>
      </div>

      {/* 3. Main Map */}
      <div ref={mapContainerRef} className="absolute top-14 bottom-0 right-0 left-[380px] z-0"
         onWheel={handleWheel}
         onMouseDown={handleMouseDown}
         onMouseMove={handleMouseMove}
         onMouseUp={handleMouseUp}
         onMouseLeave={handleMouseUp}
      >
         <svg ref={mainSvgRef} viewBox="0 0 1 1" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
            <g>
               {Object.values(gameState.terrainGrid).map(hex => renderTerrainHex(hex as any))}
               <g>
                 {Object.values(gameState.grid).map(hex => (
                    <HexFill 
                       key={`f-${hex.q},${hex.r}`}
                       hex={hex}
                       isSelected={selectedHex === hexKey(hex.q, hex.r)}
                       isHovered={hoveredHex === hexKey(hex.q, hex.r)}
                       onClick={() => {
                          if (hasDraggedRef.current) return;
                          if (infraPlacementMode) { completeInfraPlacement(hexKey(hex.q, hex.r)); }
                          else { setSelectedHex(hexKey(hex.q, hex.r)); }
                       }}
                       onMouseEnter={() => setHoveredHex(hexKey(hex.q, hex.r))}
                       onMouseLeave={() => setHoveredHex(null)}
                    />
                 ))}
                 {renderInfrastructureEdges()}
                 {selectedHex && (() => {
                    const selHex = gameState.grid[selectedHex];
                    if (!selHex?.buildingId || selHex.constructionSite) return null;
                    const radius = HUB_RADIUS[selHex.buildingId];
                    if (radius === undefined) return null;
                    const color = BUILDING_COLORS[selHex.buildingId] || '#ffe082';
                    // Collect other operating hubs to determine closest-hub ownership
                    const otherHubs: { key: string; q: number; r: number; radius: number }[] = [];
                    for (const [k, hex] of Object.entries(gameState.grid)) {
                       if (k === selectedHex) continue;
                       if (!hex.buildingId || hex.constructionSite) continue;
                       const r2 = HUB_RADIUS[hex.buildingId];
                       if (r2 !== undefined) otherHubs.push({ key: k, q: hex.q, r: hex.r, radius: r2 });
                    }
                    return getHexesInRadius(selHex.q, selHex.r, radius).map(h => {
                       const dist = hexDistance(h.q, h.r, selHex.q, selHex.r);
                       // Check if another hub is closer (or equidistant with lower key)
                       const claimed = otherHubs.some(oh => {
                          const ohDist = hexDistance(h.q, h.r, oh.q, oh.r);
                          return ohDist <= oh.radius && (ohDist < dist || (ohDist === dist && oh.key < selectedHex!));
                       });
                       const { x: bx, y: by } = pointyHexToPixel(h.q, h.r, HEX_SIZE);
                       return (
                          <g key={`hub-${h.q},${h.r}`} transform={`translate(${bx}, ${by})`} className="pointer-events-none">
                             <polygon points={hexCornersStr} fill={color} fillOpacity={claimed ? 0.02 : 0.06} stroke={color} strokeOpacity={claimed ? 0.1 : 0.3} strokeWidth={1} strokeDasharray={claimed ? "2,4" : "3,2"} />
                          </g>
                       );
                    });
                 })()}
                 {infraPlacementMode && hoveredHex && (() => {
                    const [hq, hr] = hoveredHex.split(',').map(Number);
                    const { x: bx, y: by } = pointyHexToPixel(hq, hr, HEX_SIZE);
                    return (
                       <g key={`p-${hq},${hr}`} transform={`translate(${bx}, ${by})`} className="pointer-events-none">
                          <polygon points={hexCornersStr} fill="#ffffff" fillOpacity={0.2} stroke="#ffffff" strokeDasharray="4,2" />
                       </g>
                    );
                 })()}
                 {Object.values(gameState.grid).map(hex => {
                    const key = hexKey(hex.q, hex.r);
                    return (
                       <HexOverlay 
                          key={`o-${key}`}
                          hex={hex}
                          isSelected={selectedHex === key}
                          isLabelHex={clusterInfo.labelHex.get(key) === key}
                          isInCluster={clusterInfo.labelHex.has(key) && clusterInfo.labelHex.get(key) !== key}
                          sameTypeEdges={clusterInfo.sameTypeEdges}
                          efficiency={hex.flowState?.efficiency ?? 1}
                       />
                    )
                 })}
               </g>
            </g>
         </svg>
      </div>

      {/* Hints Overlay */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-2 z-30">
        {infraPlacementMode && <div className="bg-blue-500/20 text-blue-300 backdrop-blur-md px-4 py-2 rounded-full text-xs font-bold border border-blue-500/30 shadow-lg">Placing {{ road: 'ROAD', rail: 'RAIL', canal: 'CANAL', power_line: 'POWER LINE', hv_line: 'HV LINE' }[infraPlacementMode.type]} (Select Target)</div>}
      </div>

      {/* Resource Ledger Modal */}
      {showResourceLedger && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8" onClick={() => setShowResourceLedger(false)}>
           <div className="glass-panel w-full max-w-5xl flex flex-col rounded-xl overflow-hidden max-h-full shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                 <div className="flex items-center gap-3">
                    <Activity className="text-emerald-400" />
                    <div>
                       <h2 className="text-lg font-bold text-white">Resource Ledger</h2>
                       <div className="text-xs text-zinc-400 font-mono">GLOBAL ECONOMY STATISTICS</div>
                    </div>
                 </div>
                 <button onClick={() => setShowResourceLedger(false)} className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"><X /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-0">
                 <table className="w-full text-left border-collapse">
                    <thead className="bg-black/20 sticky top-0 backdrop-blur-md z-10">
                       <tr className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-white/5">
                          <th className="p-4 font-bold text-zinc-300">Resource</th>
                          <th className="p-4 text-right">Net Capacity <span className="opacity-50 lowercase">(prod / cons)</span></th>
                          <th className="p-4 text-right">Realized Prod.</th>
                          <th className="p-4 text-right">Consumed</th>
                          <th className="p-4 text-right">Losses</th>
                          <th className="p-4 text-right">Efficiency</th>
                          <th className="p-4 text-right">Surplus</th>
                          <th className="p-4 text-right">Price</th>
                          <th className="p-4 text-right">Export/t</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs font-mono">
                       {ALL_RESOURCES.map(res => {
                          const pot = gameState.flowSummary.potential[res] || 0;
                          const dem = gameState.flowSummary.potentialDemand[res] || 0;
                          const real = gameState.flowSummary.realized[res] || 0;
                          const cons = gameState.flowSummary.consumed[res] || 0;
                          const lossDist = gameState.flowSummary.lostToDistance[res] || 0;
                          const lossShort = gameState.flowSummary.lostToShortage[res] || 0;
                          
                          if (pot <= 0 && dem <= 0 && real <= 0) return null;

                          const transferEff = real > 0.01 ? (cons / real) : 0;
                          
                          // Show unmet demand if buildings are short, otherwise production headroom
                          const surplus = lossShort > 0 ? -lossShort : real - dem;
                          
                          const color = RESOURCE_COLORS[res];

                          return (
                             <tr key={res} className="hover:bg-white/5 transition-colors group">
                                <td className="p-4">
                                   <div className="flex items-center gap-3">
                                      <div className="w-6 h-6 flex items-center justify-center">
                                         <svg width="20" height="20" viewBox="-12 -12 24 24">
                                            {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: color || '#fff', size: 20 })}
                                         </svg>
                                      </div>
                                      <span className="font-bold text-zinc-300 capitalize text-sm font-sans">{res.replace('_', ' ')}</span>
                                   </div>
                                </td>
                                <td className="p-4 text-right">
                                   <div className="flex flex-col items-end gap-0.5">
                                      <span className="text-zinc-300 font-bold">{pot.toFixed(1)} <span className="text-zinc-600">/</span> {dem.toFixed(1)}</span>
                                      <div className="w-24 h-1 bg-zinc-800 rounded-full overflow-hidden flex">
                                         <div className="h-full bg-zinc-500" style={{ width: `${Math.min(100, (pot / Math.max(pot, dem)) * 100)}%` }} />
                                      </div>
                                   </div>
                                </td>
                                <td className="p-4 text-right font-bold text-white">{real.toFixed(1)}</td>
                                <td className="p-4 text-right text-zinc-300">{cons.toFixed(1)}</td>
                                <td className="p-4 text-right text-rose-400">
                                   {lossDist > 0 && <div>-{lossDist.toFixed(1)} <span className="text-[9px] text-rose-500/70">DIST</span></div>}
                                   {lossShort > 0 && <div>-{lossShort.toFixed(1)} <span className="text-[9px] text-amber-500/70">SHORT</span></div>}
                                   {lossDist <= 0 && lossShort <= 0 && <span className="text-zinc-600">-</span>}
                                </td>
                                <td className="p-4 text-right">
                                   <div className={`font-bold ${transferEff >= 0.95 ? 'text-emerald-400' : transferEff >= 0.8 ? 'text-blue-400' : 'text-amber-400'}`}>
                                      {Math.round(transferEff * 100)}%
                                   </div>
                                </td>
                                <td className="p-4 text-right">
                                   <span className={`font-bold ${surplus > 0.1 ? 'text-emerald-400' : surplus < -0.1 ? 'text-rose-400' : 'text-zinc-600'}`}>
                                      {surplus > 0 ? '+' : ''}{surplus.toFixed(1)}
                                   </span>
                                </td>
                                <td className="p-4 text-right">
                                   {gameState.marketPrices[res] != null ? (
                                      <span className="font-bold text-zinc-300">{gameState.marketPrices[res].toFixed(2)}</span>
                                   ) : (
                                      <span className="text-zinc-600">-</span>
                                   )}
                                </td>
                                <td className="p-4 text-right">
                                   {(gameState.exportRate[res] || 0) > 0 ? (
                                      <span className="font-bold text-amber-400">{(gameState.exportRate[res] || 0).toFixed(2)}</span>
                                   ) : (
                                      <span className="text-zinc-600">-</span>
                                   )}
                                </td>
                             </tr>
                          )
                       })}
                    </tbody>
                 </table>
              </div>
           </div>
        </div>
      )}

      {/* Win Screen Overlay */}
      {gameWon && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="max-w-lg w-full mx-4 bg-zinc-900 rounded-2xl border border-amber-500/30 shadow-2xl shadow-amber-500/10 overflow-hidden">
            <div className="bg-gradient-to-b from-amber-500/20 to-transparent p-8 text-center">
              <div className="text-5xl mb-4">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" className="mx-auto">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#f59e0b" fillOpacity="0.2"/>
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-amber-400 mb-2">Total Commoditization</h2>
              <p className="text-zinc-400 text-sm">Every resource has been driven below ${WIN_PRICE_THRESHOLD.toFixed(2)} per unit. Your industrial machine has flooded the global market.</p>
            </div>
            <div className="px-8 pb-4">
              <div className="grid grid-cols-3 gap-2 mb-6">
                {Object.keys(MARKET_CONFIG).map(res => {
                  const price = gameState.marketPrices[res] ?? MARKET_CONFIG[res].base_value;
                  const resColor = RESOURCE_COLORS[res as ResourceType] || '#888';
                  return (
                    <div key={res} className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/20">
                      <svg width="12" height="12" viewBox="-12 -12 24 24">
                        {ResourceIcons[res] && React.createElement(ResourceIcons[res], { color: resColor, size: 12 })}
                      </svg>
                      <span className="text-[10px] text-zinc-400 capitalize flex-1">{res.replace('_', ' ')}</span>
                      <span className="text-[10px] font-mono text-amber-400">${price.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="text-center text-xs text-zinc-500 mb-4">
                Completed in {gameState.tick} ticks — Era {gameState.era}
              </div>
            </div>
            <div className="px-8 pb-8 flex gap-3">
              <button onClick={() => setGameWon(false)} className="flex-1 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors border border-white/5">
                Keep Playing
              </button>
              <button onClick={() => { setGameWon(false); resetGame(); }} className="flex-1 py-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-sm font-medium transition-colors border border-amber-500/30">
                New Game
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default App;