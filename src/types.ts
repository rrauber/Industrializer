export type ResourceType = 'food' | 'wood' | 'stone' | 'iron_ore' | 'coal'
  | 'iron_ingot' | 'tools' | 'concrete' | 'steel'
  | 'machinery' | 'goods' | 'electricity' | 'population';

export interface ResourceMap {
  [key: string]: number;
}

export type TerrainType = 'plains' | 'forest' | 'mountain' | 'water';

export type DepositType = 'iron_ore' | 'coal';

export type InfrastructureType = 'road' | 'rail' | 'canal' | 'power_line' | 'hv_line';

export interface BuildingType {
  id: string;
  name: string;
  description: string;
  cost: Partial<Record<ResourceType, number>>;
  inputs: Partial<Record<ResourceType, number>>;
  outputs: Partial<Record<ResourceType, number>>;
  labor: number;
  requiresTerrain?: TerrainType[];
  requiresDeposit?: DepositType;
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
  clusterBonus: number; // threshold bonus from cluster size
  clusterSize: number; // how many buildings in this cluster
  zoneOutputBonus: number; // bonus zone output multiplier
  zoneInputReduction: number; // bonus zone input reduction
  superclusterSize: number; // non-wildcard members in best zone component
  exports: ResourceMap; // resources exported by this building this tick
  exportEfficiency: number; // 0–1 infra-to-map-edge multiplier
}

export interface ConstructionSite {
  targetBuildingId: string;
  totalCost: Record<string, number>;
  delivered: Record<string, number>;
  isUpgrade: boolean;
  previousBuildingId?: string;
}

export interface InfrastructureEdge {
  transport?: 'road' | 'rail' | 'canal';
  power?: 'power_line' | 'hv_line';
}

export interface InfraEdgeConstructionSite {
  edgeKey: string;
  hexA: { q: number; r: number };
  hexB: { q: number; r: number };
  targetType: InfrastructureType;
  totalCost: Record<string, number>;
  delivered: Record<string, number>;
  isUpgrade: boolean;
  previousType?: InfrastructureType;
}

export interface FlowSummary {
  potential: ResourceMap;
  potentialDemand: ResourceMap;
  realized: ResourceMap;
  consumed: ResourceMap;
  exportConsumed: ResourceMap;
  lostToDistance: ResourceMap;
  lostToShortage: ResourceMap;
}

export interface HexData {
  q: number;
  r: number;
  buildingId?: string;
  prioritized?: boolean;
  paused?: boolean;
  constructionSite?: ConstructionSite;
  flowState?: BuildingFlowState;
}

export interface TerrainHex {
  q: number;
  r: number;
  terrain: TerrainType;
  deposit?: DepositType;
}

export interface FlowPair {
  sourceKey: string;
  destKey: string;
  resource: string;
  amount: number;
  pathCost: number;
}

export interface GameState {
  flowSummary: FlowSummary;
  grid: Record<string, HexData>;
  terrainGrid: Record<string, TerrainHex>;
  infraEdges: Record<string, InfrastructureEdge>;
  infraConstructionSites: InfraEdgeConstructionSite[];
  era: number;
  tick: number;
  totalExports: ResourceMap; // cumulative exports
  exportRate: ResourceMap; // per-tick export rate
  tradeValue: number; // current trade value per tick
  marketPrices: ResourceMap; // current market prices per resource
  mapSeed: number;
}
