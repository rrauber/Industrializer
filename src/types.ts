export type ResourceType = 'food' | 'wood' | 'stone' | 'iron_ore' | 'coal' | 'iron_ingot' | 'tools' | 'concrete' | 'steel' | 'population';

export interface ResourceMap {
  [key: string]: number;
}

export type TerrainType = 'plains' | 'forest' | 'mountain' | 'water';

export interface BuildingType {
  id: string;
  name: string;
  description: string;
  cost: Partial<Record<ResourceType, number>>;
  inputs: Partial<Record<ResourceType, number>>; // Mandatory ingredients (e.g. Ore -> Ingot)
  catalysts: Partial<Record<ResourceType, number>>; // Optional boosters (e.g. Tools -> Faster Mining)
  outputs: Partial<Record<ResourceType, number>>;
  labor: number;
  requiresTerrain?: TerrainType[];
  unlockEra: number;
  upgradesTo?: string;
  upgradeCost?: Partial<Record<ResourceType, number>>;
}

export interface HexData {
  q: number;
  r: number;
  buildingId?: string;
  hasRoad?: boolean;
  lastEfficiency?: number; // Overall efficiency
  inputEfficiencies?: Record<string, number>; // Per-resource efficiency
  infrastructure?: string[]; // IDs of infrastructure on borders or tile
}

export interface TerrainHex {
  q: number;
  r: number;
  terrain: TerrainType;
}

export interface GameState {
  resources: ResourceMap;
  rates: ResourceMap; // Net change per tick
  actualOutput: ResourceMap; // Gross production before consumption
  potentialOutput: ResourceMap; // Max production if fully staffed/inputs met
  stockpileTargets: ResourceMap; // Minimum amount to keep (factories won't consume below this)
  caps: ResourceMap; // Maximum amount to store (factories won't produce above this)
  grid: Record<string, HexData>;
  terrainGrid: Record<string, TerrainHex>;
  era: number;
  tick: number;
  showNetwork?: boolean;
}
