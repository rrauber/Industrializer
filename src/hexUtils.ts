import { InfrastructureType, InfrastructureEdge } from './types';

export function isPowerInfra(type: InfrastructureType): boolean {
  return type === 'power_line' || type === 'hv_line';
}

export function edgeHasType(edge: InfrastructureEdge | undefined, type: InfrastructureType): boolean {
  if (!edge) return false;
  if (isPowerInfra(type)) return edge.power === type;
  return edge.transport === type;
}

export function setEdgeType(edge: InfrastructureEdge | undefined, type: InfrastructureType): InfrastructureEdge {
  const result: InfrastructureEdge = edge ? { ...edge } : {};
  if (isPowerInfra(type)) result.power = type as 'power_line' | 'hv_line';
  else result.transport = type as 'road' | 'rail' | 'canal';
  return result;
}

export interface Point {
  x: number;
  y: number;
}

export function hexToPixel(q: number, r: number, size: number): Point {
  const x = size * (3 / 2 * q);
  const y = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
}

export function pointyHexToPixel(q: number, r: number, size: number): Point {
  const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const y = size * (3 / 2 * r);
  return { x, y };
}

export function pixelToHex(x: number, y: number, size: number): { q: number, r: number } {
  const q = (2/3 * x) / size;
  const r = (-1/3 * x + Math.sqrt(3)/3 * y) / size;
  return cubeToAxial(cubeRound(axialToCube({ q, r })));
}

export function pixelToPointyHex(x: number, y: number, size: number): { q: number, r: number } {
  const q = (Math.sqrt(3)/3 * x - 1/3 * y) / size;
  const r = (2/3 * y) / size;
  return cubeToAxial(cubeRound(axialToCube({ q, r })));
}

function axialToCube(hex: { q: number, r: number }) {
  const x = hex.q;
  const z = hex.r;
  const y = -x - z;
  return { x, y, z };
}

function cubeToAxial(cube: { x: number, y: number, z: number }) {
  return { q: cube.x, r: cube.z };
}

function cubeRound(cube: { x: number, y: number, z: number }) {
  let rx = Math.round(cube.x);
  let ry = Math.round(cube.y);
  let rz = Math.round(cube.z);

  const dx = Math.abs(rx - cube.x);
  const dy = Math.abs(ry - cube.y);
  const dz = Math.abs(rz - cube.z);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { x: rx, y: ry, z: rz };
}

export function getHexCorners(center: Point, size: number, startAngleDeg: number = 0): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle_deg = 60 * i + startAngleDeg;
    const angle_rad = Math.PI / 180 * angle_deg;
    corners.push({
      x: center.x + size * Math.cos(angle_rad),
      y: center.y + size * Math.sin(angle_rad)
    });
  }
  return corners;
}

export const HEX_DIRECTIONS: readonly { dq: number, dr: number }[] = [
  { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 }
];

export function getNeighbors(q: number, r: number): { q: number, r: number }[] {
  return [
    { q: q + 1, r },     { q: q + 1, r: r - 1 }, { q, r: r - 1 },
    { q: q - 1, r },     { q: q - 1, r: r + 1 }, { q, r: r + 1 }
  ];
}

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function getEdgeKey(q1: number, r1: number, q2: number, r2: number): string {
  // Canonical ordering without array/sort/join allocation
  if (q1 < q2 || (q1 === q2 && r1 < r2)) return `${q1},${r1}|${q2},${r2}`;
  return `${q2},${r2}|${q1},${r1}`;
}

export function parseHexKey(key: string): { q: number, r: number } {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function getHexInfraEdges(q: number, r: number, infraEdges: Record<string, InfrastructureEdge>, filterType?: InfrastructureType): { edgeKey: string; neighborQ: number; neighborR: number; type: InfrastructureType }[] {
  const result: { edgeKey: string; neighborQ: number; neighborR: number; type: InfrastructureType }[] = [];
  for (const n of getNeighbors(q, r)) {
    const ek = getEdgeKey(q, r, n.q, n.r);
    const edge = infraEdges[ek];
    if (!edge) continue;
    if (filterType) {
      if (edgeHasType(edge, filterType)) {
        result.push({ edgeKey: ek, neighborQ: n.q, neighborR: n.r, type: filterType });
      }
    } else {
      // No filter: return an entry for each type present on the edge
      if (edge.transport) result.push({ edgeKey: ek, neighborQ: n.q, neighborR: n.r, type: edge.transport });
      if (edge.power) result.push({ edgeKey: ek, neighborQ: n.q, neighborR: n.r, type: edge.power });
    }
  }
  return result;
}

export function countHexConnections(q: number, r: number, infraEdges: Record<string, InfrastructureEdge>, type?: InfrastructureType): number {
  if (type) {
    let count = 0;
    for (const d of HEX_DIRECTIONS) {
      const nq = q + d.dq, nr = r + d.dr;
      const ek = getEdgeKey(q, r, nq, nr);
      const edge = infraEdges[ek];
      if (edge && edgeHasType(edge, type)) count++;
    }
    return count;
  }
  // No type filter: count unique physical edges (not per-type entries)
  let count = 0;
  for (const d of HEX_DIRECTIONS) {
    const ek = getEdgeKey(q, r, q + d.dq, r + d.dr);
    if (infraEdges[ek]) count++;
  }
  return count;
}

export function parseEdgeKey(edgeKey: string): [{ q: number; r: number }, { q: number; r: number }] {
  const [a, b] = edgeKey.split('|');
  const [aq, ar] = a.split(',').map(Number);
  const [bq, br] = b.split(',').map(Number);
  return [{ q: aq, r: ar }, { q: bq, r: br }];
}

export function getHexesInRadius(cq: number, cr: number, radius: number): { q: number, r: number }[] {
  const hexes: { q: number, r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.push({ q: cq + q, r: cr + r });
    }
  }
  return hexes;
}

// Check if there is another intersection (degree > 2) of the same type within `range` steps.
// This function traverses the graph defined by infraEdges.
export function hasIntersectionInRadius(
  startQ: number,
  startR: number,
  type: InfrastructureType,
  infraEdges: Record<string, InfrastructureEdge>,
  range: number
): boolean {
  const startKey = hexKey(startQ, startR);
  // Queue: [key, dist]
  const queue: { q: number; r: number; dist: number }[] = [{ q: startQ, r: startR, dist: 0 }];
  const visited = new Set<string>();
  visited.add(startKey);

  while (queue.length > 0) {
    const { q, r, dist } = queue.shift()!;

    if (dist > 0) {
      // Check if this node is an intersection
      const conns = countHexConnections(q, r, infraEdges, type);
      if (conns > 2) return true;
    }

    if (dist >= range) continue;

    const neighbors = getHexInfraEdges(q, r, infraEdges, type);
    for (const n of neighbors) {
      const nKey = hexKey(n.neighborQ, n.neighborR);
      if (!visited.has(nKey)) {
        visited.add(nKey);
        queue.push({ q: n.neighborQ, r: n.neighborR, dist: dist + 1 });
      }
    }
  }

  return false;
}