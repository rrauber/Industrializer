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
  inputs: Partial<Record<ResourceType, number>>;
  outputs: Partial<Record<ResourceType, number>>;
  labor: number;
  requiresTerrain?: TerrainType[];
  unlockEra: number;
  upgradesTo?: string;
  upgradeCost?: Partial<Record<ResourceType, number>>;
}

export interface InputDiagnostic {
  resource: string;
  required: number;
  available: number;
  distanceLoss: number;
  inputShortage: number;
  satisfaction: number; // 0-1 ratio (available / required)
}

export interface BuildingFlowState {
  potential: ResourceMap;
  realized: ResourceMap;
  consumed: ResourceMap;
  inputDiagnostics: InputDiagnostic[];
  efficiency: number; // overall efficiency 0-1
  adjacencyBonus: number; // 0.1 per identical neighbor
}

export interface ConstructionSite {
  targetBuildingId: string;
  totalCost: Record<string, number>;
  delivered: Record<string, number>;
  isUpgrade: boolean;
  previousBuildingId?: string;
}

export interface FlowSummary {
  potential: ResourceMap;
  realized: ResourceMap;
  consumed: ResourceMap;
  lostToDistance: ResourceMap;
  lostToShortage: ResourceMap;
}

export interface HexData {
  q: number;
  r: number;
  buildingId?: string;
  hasRoad?: boolean;
  prioritized?: boolean;
  constructionSite?: ConstructionSite;
  flowState?: BuildingFlowState;
}

export interface TerrainHex {
  q: number;
  r: number;
  terrain: TerrainType;
}

export interface GameState {
  flowSummary: FlowSummary;
  grid: Record<string, HexData>;
  terrainGrid: Record<string, TerrainHex>;
  era: number;
  tick: number;
  showNetwork?: boolean;
}
