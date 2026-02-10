import { TerrainHex, TerrainType, DepositType } from './types';
import { hexKey } from './hexUtils';

// Seeded PRNG — mulberry32
export function createRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D simplex noise
export function createNoise2D(rng: () => number): (x: number, y: number) => number {
  // Build permutation table
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  // Gradients for 2D simplex
  const GRAD2 = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];

  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  function grad(hash: number, x: number, y: number): number {
    const g = GRAD2[hash & 7];
    return g[0] * x + g[1] * y;
  }

  return (xin: number, yin: number): number => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    let i1: number, j1: number;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * grad(perm[ii + perm[jj]], x0, y0); }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * grad(perm[ii + i1 + perm[jj + j1]], x1, y1); }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * grad(perm[ii + 1 + perm[jj + 1]], x2, y2); }

    // Scale to [-1, 1]
    return 70 * (n0 + n1 + n2);
  };
}

// Multi-octave noise
function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number, lacunarity: number = 2.0, gain: number = 0.5): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += noise(x * frequency, y * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxAmp;
}

export function generateTerrain(radius: number, seed: number): { terrainGrid: Record<string, TerrainHex>; mapSeed: number } {
  const rng = createRNG(seed);
  const elevNoise = createNoise2D(rng);
  const moistNoise = createNoise2D(rng);
  const depositNoise = createNoise2D(rng);
  const riverNoise = createNoise2D(rng);

  const terrainGrid: Record<string, TerrainHex> = {};
  const scale = 0.045;
  const extent = radius * 1.7; // max cartesian distance from center

  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      // Convert axial to cartesian for noise sampling
      const px = Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r;
      const py = (3 / 2) * r;

      // Normalized coordinates: -1 to +1 across the map
      const nx = px / extent;
      const ny = py / extent;

      // --- Elevation gradient: high in upper-left, low in lower-right ---
      // This puts mountains NW, coast/delta SE
      const gradient = (-nx * 0.6 - ny * 0.4) * 0.28;

      // Noise-based elevation variation
      let elevation = (fbm(elevNoise, px * scale, py * scale, 2) + 1) / 2;
      elevation += gradient;

      // --- River: meanders from NW toward SE, widening into delta ---
      // River progress: 0 at NW corner, 1 at SE corner
      const riverProgress = (nx + ny + 2) / 4; // 0..1 diagonal
      // River center: meanders using noise, drifts with the gradient
      const meander = riverNoise(py * 0.025, px * 0.01) * 0.2;
      // River runs roughly along the diagonal; center offset perpendicular to it
      const perpDist = (nx - ny) / Math.SQRT2; // perpendicular distance from diagonal
      const riverCenter = meander;
      const distToRiver = Math.abs(perpDist - riverCenter);

      // Width: narrow upstream (0.02), opens into broad delta (0.18)
      const riverWidth = 0.015 + riverProgress * riverProgress * 0.18;

      // Carve river into elevation
      if (distToRiver < riverWidth) {
        const carveDepth = 0.35 * (1 - distToRiver / riverWidth);
        elevation -= carveDepth;
      }

      // Boost moisture near river
      const riverProximity = Math.max(0, 1 - distToRiver / (riverWidth * 3));

      // --- Moisture ---
      let moisture = (fbm(moistNoise, px * scale * 0.9 + 100, py * scale * 0.9 + 100, 2) + 1) / 2;
      moisture += riverProximity * 0.25;

      // --- Terrain classification ---
      let terrain: TerrainType;
      if (elevation < 0.30) {
        terrain = 'water';
      } else if (elevation > 0.72) {
        terrain = 'mountain';
      } else if (moisture > 0.55 && elevation < 0.55) {
        terrain = 'forest';
      } else {
        terrain = 'plains';
      }

      // --- Deposits on mountains ---
      let deposit: DepositType | undefined;
      if (terrain === 'mountain') {
        const dv = depositNoise(px * scale * 0.6 + 200, py * scale * 0.6 + 200);
        if (dv > 0.45) deposit = 'iron_ore';
        else if (dv < -0.45) deposit = 'coal';
      }

      const hex: TerrainHex = { q, r, terrain };
      if (deposit) hex.deposit = deposit;
      terrainGrid[hexKey(q, r)] = hex;
    }
  }

  return { terrainGrid, mapSeed: seed };
}
