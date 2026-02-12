import { BuildingType, DepositType, InfrastructureType, ResourceType, TerrainType } from './types';

export const BUILDINGS: Record<string, BuildingType> = {
  // --- TIER 0: PRIMITIVE (No complex inputs, easy start) ---
  forager: {
    id: 'forager',
    name: 'Forager Hut',
    description: 'Gathers food from the wild. Inefficient.',
    cost: { wood: 5 },
    inputs: { population: 0.1 },
    outputs: { food: 0.3 },
    labor: 0,
    requiresTerrain: ['plains', 'forest'],
    unlockEra: 1,
    upgradesTo: 'farm',
    upgradeCost: { wood: 20, stone: 10 },
  },
  wood_camp: {
    id: 'wood_camp',
    name: 'Wood Camp',
    description: 'Basic wood gathering operation.',
    cost: {}, // Free to start
    inputs: { population: 0.1 },
    outputs: { wood: 0.3 },
    labor: 0,
    requiresTerrain: ['forest'],
    unlockEra: 1,
    upgradesTo: 'lumber_mill',
    upgradeCost: { wood: 50, tools: 5 },
  },
  stone_camp: {
    id: 'stone_camp',
    name: 'Stone Camp',
    description: 'Gathers loose stone.',
    cost: { wood: 10 },
    inputs: { population: 0.1 },
    outputs: { stone: 0.3 },
    labor: 0,
    requiresTerrain: ['mountain', 'plains'],
    unlockEra: 1,
    upgradesTo: 'quarry',
    upgradeCost: { wood: 50, tools: 10 },
  },
  workshop: {
    id: 'workshop',
    name: 'Workshop',
    description: 'Cobbles together basic tools from stone and wood.',
    cost: { wood: 20 },
    inputs: { wood: 0.5, stone: 0.25, population: 0.1 },
    outputs: { tools: 0.1 },
    labor: 0,
    unlockEra: 1,
    upgradesTo: 'tool_factory',
    upgradeCost: { stone: 100, iron_ingot: 20 },
  },
  surface_mine: {
    id: 'surface_mine',
    name: 'Surface Iron',
    description: 'Collects surface iron deposits.',
    cost: { wood: 30, stone: 10 },
    inputs: { population: 0.2, tools: 0.1 },
    outputs: { iron_ore: 0.3 },
    labor: 0,
    requiresTerrain: ['mountain'],
    requiresDeposit: 'iron_ore',
    unlockEra: 2,
    upgradesTo: 'iron_mine',
    upgradeCost: { wood: 100, stone: 100, tools: 20 },
  },
  surface_coal: {
    id: 'surface_coal',
    name: 'Surface Coal',
    description: 'Collects surface coal deposits.',
    cost: { wood: 30, stone: 10 },
    inputs: { population: 0.2, tools: 0.1 },
    outputs: { coal: 0.3 },
    labor: 0,
    requiresTerrain: ['mountain'],
    requiresDeposit: 'coal',
    unlockEra: 2,
    upgradesTo: 'coal_mine',
    upgradeCost: { wood: 100, stone: 100, tools: 20 },
  },
  bloomery: {
    id: 'bloomery',
    name: 'Bloomery',
    description: 'A primitive furnace for smelting iron using wood fuel.',
    cost: { stone: 40, wood: 20 },
    inputs: { iron_ore: 1, wood: 2, population: 0.2 },
    outputs: { iron_ingot: 0.25 },
    labor: 0,
    unlockEra: 2,
    upgradesTo: 'smelter',
    upgradeCost: { stone: 100, wood: 50, iron_ingot: 10 },
  },

  // --- TIER 1: INDUSTRIAL (Requires Infrastructure & Tools) ---
  farm: {
    id: 'farm',
    name: 'Farm',
    description: 'Produces food from fertile plains.',
    cost: { wood: 50, stone: 20 },
    inputs: { population: 0.1, tools: 0.1 },
    outputs: { food: 1.5 },
    labor: 0,
    requiresTerrain: ['plains'],
    unlockEra: 2,
    upgradesTo: 'industrial_farm',
    upgradeCost: { steel: 150, concrete: 75, machinery: 30 },
  },
  lumber_mill: {
    id: 'lumber_mill',
    name: 'Lumber Mill',
    description: 'Industrial wood processing.',
    cost: { wood: 100, tools: 10 },
    inputs: { population: 0.2, tools: 0.2 },
    outputs: { wood: 2 },
    labor: 0,
    requiresTerrain: ['forest'],
    unlockEra: 3,
    upgradesTo: 'automated_sawmill',
    upgradeCost: { steel: 150, concrete: 50, machinery: 30 },
  },
  quarry: {
    id: 'quarry',
    name: 'Ind. Quarry',
    description: 'Deep stone excavation.',
    cost: { wood: 100, tools: 10 },
    inputs: { population: 0.5, tools: 0.2 },
    outputs: { stone: 2 },
    labor: 0,
    requiresTerrain: ['mountain'],
    unlockEra: 3,
    upgradesTo: 'automated_quarry',
    upgradeCost: { steel: 150, concrete: 75, machinery: 30 },
  },
  iron_mine: {
    id: 'iron_mine',
    name: 'Deep Iron Mine',
    description: 'Deep shaft mining. Very slow without tools.',
    cost: { stone: 300, tools: 30 },
    inputs: { population: 1.0, tools: 0.5 },
    outputs: { iron_ore: 2.5 },
    labor: 0,
    requiresTerrain: ['mountain'],
    requiresDeposit: 'iron_ore',
    unlockEra: 3,
    upgradesTo: 'automated_iron_mine',
    upgradeCost: { steel: 200, concrete: 100, machinery: 50 },
  },
  coal_mine: {
    id: 'coal_mine',
    name: 'Deep Coal Mine',
    description: 'Deep shaft mining. Very slow without tools.',
    cost: { stone: 300, tools: 30 },
    inputs: { population: 1.0, tools: 0.5 },
    outputs: { coal: 2.5 },
    labor: 0,
    requiresTerrain: ['mountain'],
    requiresDeposit: 'coal',
    unlockEra: 3,
    upgradesTo: 'automated_coal_mine',
    upgradeCost: { steel: 200, concrete: 100, machinery: 50 },
  },
  smelter: {
    id: 'smelter',
    name: 'Smelter',
    description: 'Refines ore. Requires Fuel.',
    cost: { stone: 150, wood: 75 },
    inputs: { iron_ore: 2, coal: 1, population: 0.5 },
    outputs: { iron_ingot: 0.75 },
    labor: 0,
    unlockEra: 3,
    upgradesTo: 'electric_smelter',
    upgradeCost: { steel: 150, concrete: 75, machinery: 30 },
  },
  tool_factory: {
    id: 'tool_factory',
    name: 'Tool Factory',
    description: 'Mass produces high-quality tools.',
    cost: { stone: 300, iron_ingot: 75 },
    inputs: { iron_ingot: 1, wood: 1, coal: 0.5, population: 0.5 },
    outputs: { tools: 1 },
    labor: 0,
    unlockEra: 3,
    upgradesTo: 'automated_toolworks',
    upgradeCost: { steel: 150, concrete: 50, machinery: 30 },
  },
  concrete_factory: {
    id: 'concrete_factory',
    name: 'Concrete Plant',
    description: 'Mixes concrete.',
    cost: { stone: 300, iron_ingot: 40 },
    inputs: { stone: 5, coal: 1, population: 0.5 },
    outputs: { concrete: 1 },
    labor: 0,
    unlockEra: 3,
    upgradesTo: 'electric_kiln',
    upgradeCost: { steel: 200, concrete: 100, machinery: 50 },
  },
  steel_mill: {
    id: 'steel_mill',
    name: 'Steel Mill',
    description: 'Advanced metallurgy.',
    cost: { iron_ingot: 150, concrete: 75 },
    inputs: { iron_ingot: 3, coal: 3, tools: 0.5, population: 1.0 },
    outputs: { steel: 1 },
    labor: 0,
    unlockEra: 3,
    upgradesTo: 'electric_arc_furnace',
    upgradeCost: { steel: 200, concrete: 100, machinery: 50 },
  },

  // --- TIER 2: ADVANCED (Era 3-4, deeper chains) ---
  machine_works: {
    id: 'machine_works',
    name: 'Machine Works',
    description: 'Produces precision machinery from steel and tools.',
    cost: { steel: 100, concrete: 50 },
    inputs: { steel: 2, tools: 1, iron_ingot: 1, population: 1.0 },
    outputs: { machinery: 0.5 },
    labor: 0,
    unlockEra: 3,
    upgradesTo: 'precision_works',
    upgradeCost: { steel: 250, concrete: 100, machinery: 75 },
  },
  manufactory: {
    id: 'manufactory',
    name: 'Manufactory',
    description: 'Mass produces finished goods for export.',
    cost: { steel: 150, concrete: 75, machinery: 20 },
    inputs: { iron_ingot: 2, wood: 2, tools: 0.5, machinery: 0.5, population: 2.0 },
    outputs: { goods: 1.5 },
    labor: 0,
    unlockEra: 4,
    upgradesTo: 'assembly_line',
    upgradeCost: { steel: 300, concrete: 150, machinery: 100 },
  },
  export_port: {
    id: 'export_port',
    name: 'Port',
    description: 'Ships goods abroad. Free flow within 4 hexes. Wildcard for clusters. Water ports provide free maritime transit.',
    cost: { concrete: 150, steel: 75 },
    inputs: { goods: 5, tools: 0.2, population: 1.0 },
    outputs: {}, // produces no flow resources — generates exports instead
    labor: 0,
    requiresTerrain: ['plains', 'water'],
    unlockEra: 4,
  },
  trade_depot: {
    id: 'trade_depot',
    name: 'Trade Depot',
    description: 'Absorbs surplus production and exports it. Free flow within 2 hexes. Wildcard for cluster bonuses.',
    cost: { wood: 15 },
    inputs: { population: 0.2 },
    outputs: {}, // generates exports, not flow resources
    labor: 0,
    requiresTerrain: ['plains', 'forest'],
    unlockEra: 1,
    upgradesTo: 'station',
    upgradeCost: { stone: 150, iron_ingot: 50 },
  },
  station: {
    id: 'station',
    name: 'Station',
    description: 'Rail logistics hub. Free flow within 3 hexes. Absorbs surplus for export. Wildcard for clusters.',
    cost: { stone: 150, iron_ingot: 50 },
    inputs: { population: 0.5, tools: 0.1 },
    outputs: {},
    labor: 0,
    requiresTerrain: ['plains'],
    unlockEra: 3,
  },

  // --- TIER 3: ELECTRIC (Era 5-6, electricity-powered) ---
  coal_power_plant: {
    id: 'coal_power_plant',
    name: 'Coal Power Plant',
    description: 'Burns coal to generate electricity.',
    cost: { steel: 200, concrete: 100, machinery: 30 },
    inputs: { coal: 3, tools: 0.5, population: 1.0 },
    outputs: { electricity: 2 },
    labor: 0,
    unlockEra: 4,
  },
  solar_array: {
    id: 'solar_array',
    name: 'Solar Array',
    description: 'Fuel-free electricity from sunlight. Requires machinery upkeep.',
    cost: { steel: 100, concrete: 50, machinery: 30 },
    inputs: { machinery: 0.5, population: 0.2 },
    outputs: { electricity: 2 },
    labor: 0,
    requiresTerrain: ['plains'],
    unlockEra: 4,
  },
  electric_arc_furnace: {
    id: 'electric_arc_furnace',
    name: 'Electric Arc Furnace',
    description: 'Electric steelmaking. Replaces coal with electricity.',
    cost: { steel: 200, concrete: 100, machinery: 50 },
    inputs: { iron_ingot: 3, electricity: 2, tools: 0.5, population: 0.5 },
    outputs: { steel: 2 },
    labor: 0,
    unlockEra: 4,
  },
  automated_toolworks: {
    id: 'automated_toolworks',
    name: 'Automated Toolworks',
    description: 'Electric tool production. No wood or coal needed.',
    cost: { steel: 150, concrete: 50, machinery: 30 },
    inputs: { steel: 1, machinery: 0.25, electricity: 1, population: 0.3 },
    outputs: { tools: 5 },
    labor: 0,
    unlockEra: 4,
  },
  assembly_line: {
    id: 'assembly_line',
    name: 'Assembly Line',
    description: 'Electric mass production. Huge goods output.',
    cost: { steel: 300, concrete: 150, machinery: 100 },
    inputs: { iron_ingot: 3, wood: 1, electricity: 2, machinery: 1, population: 1.0 },
    outputs: { goods: 4 },
    labor: 0,
    unlockEra: 4,
  },

  electric_smelter: {
    id: 'electric_smelter',
    name: 'Electric Smelter',
    description: 'Electric iron smelting. No coal, much more efficient.',
    cost: { steel: 150, concrete: 75, machinery: 30 },
    inputs: { iron_ore: 3, electricity: 1, population: 0.3 },
    outputs: { iron_ingot: 2 },
    labor: 0,
    unlockEra: 4,
  },
  electric_kiln: {
    id: 'electric_kiln',
    name: 'Electric Kiln',
    description: 'Electric concrete production. No coal, higher output.',
    cost: { steel: 200, concrete: 100, machinery: 50 },
    inputs: { stone: 3, machinery: 0.1, electricity: 1, population: 0.3 },
    outputs: { concrete: 2.5 },
    labor: 0,
    unlockEra: 4,
  },
  precision_works: {
    id: 'precision_works',
    name: 'Precision Works',
    description: 'CNC-driven precision machinery. Triple output.',
    cost: { steel: 250, concrete: 100, machinery: 75 },
    inputs: { steel: 2, tools: 0.5, electricity: 2, population: 0.5 },
    outputs: { machinery: 1.5 },
    labor: 0,
    unlockEra: 4,
  },

  industrial_farm: {
    id: 'industrial_farm',
    name: 'Industrial Farm',
    description: 'Electrically-powered agriculture. Massive food output, minimal labor.',
    cost: { steel: 150, concrete: 75, machinery: 30 },
    inputs: { electricity: 1, tools: 0.1, population: 0.05 },
    outputs: { food: 3 },
    labor: 0,
    requiresTerrain: ['plains'],
    unlockEra: 4,
  },
  automated_sawmill: {
    id: 'automated_sawmill',
    name: 'Automated Sawmill',
    description: 'Electric wood processing. Double output, fraction of the labor.',
    cost: { steel: 150, concrete: 50, machinery: 30 },
    inputs: { electricity: 1, tools: 0.1, population: 0.1 },
    outputs: { wood: 4 },
    labor: 0,
    requiresTerrain: ['forest'],
    unlockEra: 4,
  },
  automated_quarry: {
    id: 'automated_quarry',
    name: 'Automated Quarry',
    description: 'Electric stone extraction. Double output, less labor.',
    cost: { steel: 150, concrete: 75, machinery: 30 },
    inputs: { electricity: 1, tools: 0.2, population: 0.2 },
    outputs: { stone: 4 },
    labor: 0,
    requiresTerrain: ['mountain'],
    unlockEra: 4,
  },
  automated_iron_mine: {
    id: 'automated_iron_mine',
    name: 'Automated Iron Mine',
    description: 'Electric deep mining. Double iron output, less labor.',
    cost: { steel: 200, concrete: 100, machinery: 50 },
    inputs: { electricity: 2, tools: 0.2, machinery: 0.1, population: 0.3 },
    outputs: { iron_ore: 5 },
    labor: 0,
    requiresTerrain: ['mountain'],
    requiresDeposit: 'iron_ore',
    unlockEra: 4,
  },
  automated_coal_mine: {
    id: 'automated_coal_mine',
    name: 'Automated Coal Mine',
    description: 'Electric deep mining. Double coal output, less labor.',
    cost: { steel: 200, concrete: 100, machinery: 50 },
    inputs: { electricity: 2, tools: 0.2, machinery: 0.1, population: 0.3 },
    outputs: { coal: 5 },
    labor: 0,
    requiresTerrain: ['mountain'],
    requiresDeposit: 'coal',
    unlockEra: 4,
  },

  // --- NUCLEAR ---
  uranium_mine: {
    id: 'uranium_mine',
    name: 'Uranium Mine',
    description: 'Extracts rare uranium ore from deep deposits. Requires heavy machinery.',
    cost: { steel: 200, concrete: 100, machinery: 50 },
    inputs: { electricity: 2, tools: 0.3, machinery: 0.1, population: 0.5 },
    outputs: { uranium_ore: 2 },
    labor: 0,
    requiresTerrain: ['mountain'],
    requiresDeposit: 'uranium',
    unlockEra: 5,
  },
  enrichment_plant: {
    id: 'enrichment_plant',
    name: 'Enrichment Plant',
    description: 'Refines raw uranium ore into enriched fuel via centrifuge cascades.',
    cost: { steel: 300, concrete: 200, machinery: 100 },
    inputs: { uranium_ore: 2, electricity: 3, machinery: 0.25, population: 0.5 },
    outputs: { enriched_uranium: 0.5 },
    labor: 0,
    unlockEra: 5,
  },
  nuclear_reactor: {
    id: 'nuclear_reactor',
    name: 'Nuclear Reactor',
    description: 'Massive electricity from enriched uranium. One reactor replaces 7+ coal plants.',
    cost: { steel: 500, concrete: 300, machinery: 200 },
    inputs: { enriched_uranium: 0.5, concrete: 0.5, machinery: 0.1, population: 0.5 },
    outputs: { electricity: 15 },
    labor: 0,
    unlockEra: 5,
  },

  // --- CIVIC ---
  university: {
    id: 'university',
    name: 'University',
    description: 'Amplifies bonus zone effects. +10% output, +5% input reduction per university in zone.',
    cost: { concrete: 200, steel: 100, machinery: 50 },
    inputs: { population: 3, tools: 0.5, goods: 0.5 },
    outputs: {},
    labor: 0,
    requiresTerrain: ['plains'],
    unlockEra: 4,
  },

  // --- RESIDENTIAL (Population Production) ---
  settlement: {
    id: 'settlement',
    name: 'Settlement',
    description: 'A small community. Consumes food to grow population.',
    cost: { wood: 20 },
    inputs: { food: 2 },
    outputs: { population: 0.75 },
    labor: 0,
    requiresTerrain: ['plains', 'forest'],
    unlockEra: 1,
    upgradesTo: 'town',
    upgradeCost: { wood: 100, stone: 50 },
  },
  town: {
    id: 'town',
    name: 'Town',
    description: 'A growing town. Needs robust food supply.',
    cost: { wood: 100, stone: 50 },
    inputs: { food: 5, tools: 0.1 },
    outputs: { population: 2 },
    labor: 0,
    requiresTerrain: ['plains'],
    unlockEra: 2,
    upgradesTo: 'city',
    upgradeCost: { stone: 300, iron_ingot: 75, concrete: 75 },
  },
  city: {
    id: 'city',
    name: 'City',
    description: 'A major metropolis. Requires massive food and goods.',
    cost: { stone: 300, iron_ingot: 75, concrete: 75 },
    inputs: { food: 10, tools: 0.5, electricity: 0.5 },
    outputs: { population: 6 },
    labor: 0,
    requiresTerrain: ['plains'],
    unlockEra: 4,
  },
};

export const MAX_INFRA_CONNECTIONS = 4;

export const INFRA_SPACING: Record<InfrastructureType, number> = {
  road: 2,
  rail: 4,
  canal: 4,
  power_line: 2,
  hv_line: 4,
};

export const INFRA_STEP_COSTS: Record<InfrastructureType, number> = { road: 0.5, rail: 0.1, canal: 1.0, power_line: 1.0, hv_line: 1.0 };

export const INFRASTRUCTURE_COSTS: Record<InfrastructureType, Partial<Record<ResourceType, number>>> = {
  road: {},        // free (instant, as before)
  rail: { iron_ingot: 10, stone: 20 },
  canal: { stone: 40, tools: 10, concrete: 20 },
  power_line: { iron_ingot: 10, tools: 5 },
  hv_line: { steel: 30, concrete: 10, machinery: 5 },
};

export const INFRA_UNLOCK_ERA: Record<InfrastructureType, number> = { road: 1, rail: 2, canal: 2, power_line: 4, hv_line: 4 };

export const HUB_RADIUS: Record<string, number> = {
  trade_depot: 2,
  station: 3,
  export_port: 4,
};

export const MAP_RADIUS = 27;
export const HEX_SIZE = 30;

export const TERRAIN_COLORS: Record<TerrainType, string> = {
  plains: '#2d3a28',   // Dark grass
  forest: '#1e2b18',   // Very dark green
  mountain: '#3a3c3e', // Dark grey
  water: '#1a2634',    // Dark deep blue
};

export const DEPOSIT_COLORS: Record<DepositType, string> = {
  iron_ore: '#8b4513',  // Reddish-brown
  coal: '#2a2a2a',      // Dark grey
  uranium: '#4ade80',   // Radioactive green
};

export const ZONE_OUTPUT_BONUS = 0.15;
export const ZONE_INPUT_REDUCTION = 0.10;

export const ZONE_TYPES: Record<string, { name: string; description: string; color: string; buildings: string[] }> = {
  agricultural: {
    name: 'Agricultural',
    description: 'Food & forestry',
    color: '#39ff14', // Neon Green
    buildings: ['forager', 'farm', 'industrial_farm', 'wood_camp', 'lumber_mill', 'automated_sawmill'],
  },
  mining: {
    name: 'Mining',
    description: 'Extraction & quarrying',
    color: '#ff4500', // Neon Orange-Red
    buildings: ['surface_mine', 'surface_coal', 'iron_mine', 'coal_mine', 'quarry', 'stone_camp', 'automated_quarry', 'automated_iron_mine', 'automated_coal_mine', 'uranium_mine'],
  },
  industry: {
    name: 'Industry',
    description: 'Processing & manufacturing',
    color: '#00ffff', // Neon Cyan
    buildings: ['workshop', 'bloomery', 'smelter', 'electric_smelter', 'tool_factory', 'automated_toolworks', 'concrete_factory', 'electric_kiln', 'steel_mill', 'electric_arc_furnace', 'coal_power_plant', 'solar_array', 'machine_works', 'precision_works', 'manufactory', 'assembly_line', 'export_port', 'enrichment_plant', 'nuclear_reactor'],
  },
  residential: {
    name: 'Residential',
    description: 'Housing & population',
    color: '#ff69b4', // Neon Pink
    buildings: ['settlement', 'town', 'city'],
  },
};

export const ERA_MILESTONES: Record<number, {
  type: 'cumulative' | 'rate' | 'price';
  requirements?: Partial<Record<ResourceType, number>>;
  tradeValueTarget?: number;
  priceThreshold?: number;
  priceCount?: number;
  label: string;
}> = {
  2: { type: 'cumulative', requirements: { food: 250, wood: 250 }, label: 'Agriculture' },
  3: { type: 'cumulative', requirements: { iron_ingot: 500 }, label: 'Industry' },
  4: { type: 'cumulative', requirements: { steel: 1500 }, label: 'Industrialization' },
  5: { type: 'price', priceThreshold: 0.5, priceCount: 5, label: 'Global Trade' },
  6: { type: 'price', priceThreshold: 0.25, priceCount: 8, label: 'Market Dominance' },
};

export const WIN_PRICE_THRESHOLD = 0.10;

export const MARKET_CONFIG: Record<string, { base_value: number; saturation: number }> = {
  food:        { base_value: 1,   saturation: 1000 },
  wood:        { base_value: 1,   saturation: 1000 },
  stone:       { base_value: 1,   saturation: 1000 },
  iron_ore:    { base_value: 1.5, saturation: 800 },
  coal:        { base_value: 1.5, saturation: 800 },
  iron_ingot:  { base_value: 3,   saturation: 2000 },
  tools:       { base_value: 4,   saturation: 3000 },
  concrete:    { base_value: 3,   saturation: 2000 },
  steel:       { base_value: 5,   saturation: 3000 },
  machinery:   { base_value: 8,   saturation: 4000 },
  goods:       { base_value: 10,  saturation: 4000 },
};
