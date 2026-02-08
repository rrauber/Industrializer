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

export function getNeighbors(q: number, r: number): { q: number, r: number }[] {
  const directions = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ];
  return directions.map(d => ({ q: q + d.q, r: r + d.r }));
}

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function getEdgeKey(q1: number, r1: number, q2: number, r2: number): string {
  const k1 = hexKey(q1, r1);
  const k2 = hexKey(q2, r2);
  return [k1, k2].sort().join('|');
}

export function parseHexKey(key: string): { q: number, r: number } {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}
