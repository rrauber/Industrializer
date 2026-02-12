import React from 'react';

// Icons are designed on a 24x24 grid, centered at 12,12.
// We use translate(-12, -12) to place the center of the grid (12,12) at the SVG origin.

interface IconProps {
  color: string;
  size: number;
}

const SvgWrapper: React.FC<IconProps & { children: React.ReactNode }> = ({ color, size, children }) => (
  <g transform={`scale(${size / 24}) translate(-12, -12)`} stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none">
    {children}
  </g>
);

export const BuildingIcons: Record<string, React.FC<IconProps>> = {
  // --- TIER 0: PRIMITIVE ---
  
  forager: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 11h16l-2 10H6L4 11z" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      <path d="M12 15v2" strokeOpacity="0.5" />
    </SvgWrapper>
  ),

  wood_camp: (props) => (
    <SvgWrapper {...props}>
      <path d="M12 22V10" />
      <path d="M12 2l-4 8h8z" /> 
      <path d="M16 20l-6-6" />
      <path d="M11.5 12.5l-2.5-1l1-2l2 1z" /> 
    </SvgWrapper>
  ),

  stone_camp: (props) => (
    <SvgWrapper {...props}>
      <circle cx="8" cy="15.5" r="3" />
      <circle cx="16" cy="15.5" r="3" />
      <circle cx="12" cy="8.5" r="3" />
    </SvgWrapper>
  ),

  workshop: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 19h16v2H4z" />
      <path d="M7 19v-4h10v4" />
      <path d="M7 15c0-2 4-2 4-2h6v2" />
      <path d="M14 5l-2 6" />
      <rect x="10" y="3" width="8" height="3" transform="rotate(-15 14 4.5)" />
    </SvgWrapper>
  ),

  surface_mine: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 18.5l8-8 8 8" />
      <path d="M12 10.5v8" />
      <path d="M9 5.5l6 6" strokeWidth="1.5" />
      <path d="M15 5.5l-6 6" />
    </SvgWrapper>
  ),

  surface_coal: (props) => (
    <SvgWrapper {...props}>
      <path d="M3 18.5l9-6 9 6" />
      <path d="M12 12.5v6" />
      <path d="M7 15.5l2 3" />
      <path d="M17 15.5l-2 3" />
      <circle cx="12" cy="7.5" r="2.5" fill={props.color} fillOpacity="0.5" stroke="none" />
      <circle cx="12" cy="7.5" r="2.5" />
    </SvgWrapper>
  ),

  bloomery: (props) => (
    <SvgWrapper {...props}>
      <path d="M8 20h8" />
      <path d="M9 20L10 4h4l1 16" />
      <path d="M12 2v2" />
      <path d="M10 2l-1-1" strokeOpacity="0.5" />
      <path d="M14 2l1-1" strokeOpacity="0.5" />
    </SvgWrapper>
  ),

  // --- TIER 1: INDUSTRIAL ---

  farm: (props) => (
    <SvgWrapper {...props}>
       <path d="M12 19V5" />
       <path d="M12 5l-3-3" />
       <path d="M12 5l3-3" />
       <path d="M12 9l-3-2" />
       <path d="M12 9l3-2" />
       <path d="M12 13l-3-2" />
       <path d="M12 13l3-2" />
    </SvgWrapper>
  ),

  lumber_mill: (props) => (
    <SvgWrapper {...props}>
       <circle cx="12" cy="12" r="8" />
       <circle cx="12" cy="12" r="2" fill={props.color} fillOpacity="0.3" />
       <path d="M12 4l-1.5-2 3 0z" />
       <path d="M20 12l2 -1.5 0 3z" />
       <path d="M12 20l1.5 2 -3 0z" />
       <path d="M4 12l-2 1.5 0 -3z" />
    </SvgWrapper>
  ),

  quarry: (props) => (
    <SvgWrapper {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeOpacity="0.3" />
      <path d="M3 3l4 4h10l4-4" />
      <path d="M7 7l4 4h2l4-4" />
      <rect x="11" y="11" width="2" height="2" fill={props.color} fillOpacity="0.5" stroke="none" />
    </SvgWrapper>
  ),

  iron_mine: (props) => (
    <SvgWrapper {...props}>
      <path d="M6 20V10a6 6 0 1 1 12 0v10" />
      <path d="M6 20h12" />
      <path d="M10 20l1-5" />
      <path d="M14 20l-1-5" />
      <path d="M10.5 17h3" />
    </SvgWrapper>
  ),

  coal_mine: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 17h16" />
      <path d="M6 17l2-10h8l2 10" />
      <circle cx="12" cy="14" r="1.5" />
      <path d="M9 12h6v-3h-6z" />
    </SvgWrapper>
  ),

  smelter: (props) => (
    <SvgWrapper {...props}>
      <path d="M6 19h12" />
      <path d="M8 19L10 5h4l2 14" />
      <path d="M8 13h8" />
      <path d="M18 9h3v4" strokeOpacity="0.6" />
    </SvgWrapper>
  ),

  tool_factory: (props) => (
    <SvgWrapper {...props}>
      <path d="M18 6l-9 9" />
      <path d="M16 4l4 4" /> 
      <path d="M6 18l9-9" />
      <path d="M4 16l2 2" />
      <circle cx="5" cy="19" r="1" fill={props.color} stroke="none" />
    </SvgWrapper>
  ),

  concrete_factory: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 19h16" />
      <path d="M8 19l-2-6" />
      <path d="M16 19l2-6" />
      <path d="M6 13l2-8h8l2 8H6z" />
      <path d="M12 5v8" strokeOpacity="0.3" />
    </SvgWrapper>
  ),

  steel_mill: (props) => (
    <SvgWrapper {...props}>
      <path d="M6 6h12" strokeWidth="2" />
      <path d="M6 18h12" strokeWidth="2" />
      <path d="M12 6v12" strokeWidth="2" />
      <path d="M8 6v2" strokeOpacity="0.4" strokeWidth="1"/>
      <path d="M16 6v2" strokeOpacity="0.4" strokeWidth="1"/>
      <path d="M8 18v-2" strokeOpacity="0.4" strokeWidth="1"/>
      <path d="M16 18v-2" strokeOpacity="0.4" strokeWidth="1"/>
    </SvgWrapper>
  ),

  // --- T3 RESOURCE EXTRACTION ---

  industrial_farm: (props) => (
    <SvgWrapper {...props}>
      <path d="M12 19V5" />
      <path d="M12 5l-3-3" />
      <path d="M12 5l3-3" />
      <path d="M12 9l-3-2" />
      <path d="M12 9l3-2" />
      <path d="M12 13l-3-2" />
      <path d="M12 13l3-2" />
      <path d="M5 16l-1 2h2l-1 2" strokeWidth="1" strokeOpacity="0.5" />
    </SvgWrapper>
  ),

  automated_sawmill: (props) => (
    <SvgWrapper {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" fill={props.color} fillOpacity="0.3" />
      <path d="M12 4l-1.5-2 3 0z" />
      <path d="M20 12l2 -1.5 0 3z" />
      <path d="M12 20l1.5 2 -3 0z" />
      <path d="M4 12l-2 1.5 0 -3z" />
      <path d="M18 6l-2 3h2l-2 3" strokeWidth="1" strokeOpacity="0.5" />
    </SvgWrapper>
  ),

  automated_quarry: (props) => (
    <SvgWrapper {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeOpacity="0.3" />
      <path d="M3 3l4 4h10l4-4" />
      <path d="M7 7l4 4h2l4-4" />
      <rect x="11" y="11" width="2" height="2" fill={props.color} fillOpacity="0.5" stroke="none" />
      <path d="M18 14l-2 3h2l-2 3" strokeWidth="1" strokeOpacity="0.5" />
    </SvgWrapper>
  ),

  automated_iron_mine: (props) => (
    <SvgWrapper {...props}>
      <path d="M6 20V10a6 6 0 1 1 12 0v10" />
      <path d="M6 20h12" />
      <path d="M10 20l1-5" />
      <path d="M14 20l-1-5" />
      <path d="M10.5 17h3" />
      <path d="M17 5l-2 3h2l-2 3" strokeWidth="1" strokeOpacity="0.5" />
    </SvgWrapper>
  ),

  automated_coal_mine: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 17h16" />
      <path d="M6 17l2-10h8l2 10" />
      <circle cx="12" cy="14" r="1.5" />
      <path d="M9 12h6v-3h-6z" />
      <path d="M17 5l-2 3h2l-2 3" strokeWidth="1" strokeOpacity="0.5" />
    </SvgWrapper>
  ),

  // --- TIER 2: ADVANCED ---

  machine_works: (props) => (
    <SvgWrapper {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M22 12h-3" />
      <path d="M5 12H2" />
      <path d="M19.07 4.93l-2.12 2.12" />
      <path d="M7.05 16.95l-2.12 2.12" />
      <path d="M19.07 19.07l-2.12-2.12" />
      <path d="M7.05 7.05L4.93 4.93" />
    </SvgWrapper>
  ),

  manufactory: (props) => (
    <SvgWrapper {...props}>
      <path d="M3 18h18" />
      <path d="M3 18V10l6-4v4l6-4v4l6-4v8" />
      <path d="M9 12v4" strokeOpacity="0.3" />
      <path d="M15 12v4" strokeOpacity="0.3" />
    </SvgWrapper>
  ),

  export_port: (props) => (
    <SvgWrapper {...props}>
      <circle cx="12" cy="6" r="2" />
      <path d="M12 8v12" />
      <path d="M12 16h-4" />
      <path d="M12 16h4" />
      <path d="M6 14a6 6 0 0 0 12 0" />
    </SvgWrapper>
  ),

  trade_depot: (props) => (
    <SvgWrapper {...props}>
      <rect x="3" y="12.5" width="8" height="8" rx="1" />
      <rect x="13" y="12.5" width="8" height="8" rx="1" />
      <rect x="8" y="3.5" width="8" height="8" rx="1" />
    </SvgWrapper>
  ),

  station: (props) => (
    <SvgWrapper {...props}>
      <rect x="4" y="12" width="16" height="8" rx="1" />
      <path d="M6 12V8h12v4" />
      <path d="M12 8V4" />
      <path d="M8 12V10" strokeOpacity="0.4" />
      <path d="M16 12V10" strokeOpacity="0.4" />
    </SvgWrapper>
  ),

  // --- TIER 3: ELECTRIC ---

  coal_power_plant: (props) => (
    <SvgWrapper {...props}>
      <rect x="4" y="10" width="16" height="10" rx="1" />
      <path d="M7 10V6h4v4" />
      <path d="M17 10V4" strokeWidth="2" />
      <path d="M17 4c0 0 -1-2 0-3" strokeOpacity="0.4" />
      <path d="M17 4c0 0 1-2 0-3" strokeOpacity="0.4" />
    </SvgWrapper>
  ),

  solar_array: (props) => (
    <SvgWrapper {...props}>
      <rect x="3" y="12" width="8" height="6" rx="0.5" transform="skewY(-10)" />
      <rect x="13" y="12" width="8" height="6" rx="0.5" transform="skewY(-10)" />
      <line x1="7" y1="18" x2="7" y2="22" strokeWidth="1.5" />
      <line x1="17" y1="18" x2="17" y2="22" strokeWidth="1.5" />
      <circle cx="12" cy="5" r="3" fill="none" strokeWidth="1" />
      <line x1="12" y1="0" x2="12" y2="2" strokeWidth="0.8" />
      <line x1="16" y1="5" x2="18" y2="5" strokeWidth="0.8" />
      <line x1="6" y1="5" x2="8" y2="5" strokeWidth="0.8" />
      <line x1="14.8" y1="2.2" x2="16" y2="1" strokeWidth="0.8" />
      <line x1="9.2" y1="2.2" x2="8" y2="1" strokeWidth="0.8" />
    </SvgWrapper>
  ),

  electric_arc_furnace: (props) => (
    <SvgWrapper {...props}>
      <path d="M3 7h12" strokeWidth="2.5" />
      <path d="M3 17h12" strokeWidth="2.5" />
      <path d="M9 7v10" strokeWidth="2" />
      <path d="M18 5l-3 5h3l-3 5" strokeWidth="1.3" />
    </SvgWrapper>
  ),

  automated_toolworks: (props) => (
    <SvgWrapper {...props}>
      <path d="M18 6l-9 9" />
      <path d="M16 4l4 4" />
      <path d="M6 18l9-9" />
      <circle cx="5" cy="19" r="1" fill={props.color} stroke="none" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="17" cy="17" r="1" fill={props.color} fillOpacity="0.3" />
    </SvgWrapper>
  ),

  assembly_line: (props) => (
    <SvgWrapper {...props}>
      <path d="M3 18h18" />
      <path d="M3 18V10l6-4v4l6-4v4l6-4v8" />
      <path d="M6 15h3" strokeWidth="1.5" />
      <path d="M12 15h3" strokeWidth="1.5" />
      <circle cx="7.5" cy="13" r="1" fill={props.color} fillOpacity="0.4" stroke="none" />
      <circle cx="13.5" cy="13" r="1" fill={props.color} fillOpacity="0.4" stroke="none" />
    </SvgWrapper>
  ),

  // --- NUCLEAR ---

  uranium_mine: (props) => (
    <SvgWrapper {...props}>
      <path d="M6 20V10a6 6 0 1 1 12 0v10" />
      <path d="M6 20h12" />
      <circle cx="12" cy="13" r="3" />
      <path d="M12 10.5v1" strokeWidth="1.5" />
      <path d="M10 14.5l-0.5 0.87" strokeWidth="1.5" />
      <path d="M14 14.5l0.5 0.87" strokeWidth="1.5" />
    </SvgWrapper>
  ),

  enrichment_plant: (props) => (
    <SvgWrapper {...props}>
      <rect x="4" y="8" width="16" height="12" rx="1" />
      <path d="M8 8V5" strokeWidth="1.5" />
      <path d="M12 8V5" strokeWidth="1.5" />
      <path d="M16 8V5" strokeWidth="1.5" />
      <ellipse cx="8" cy="14" rx="2" ry="4" />
      <ellipse cx="12" cy="14" rx="2" ry="4" />
      <ellipse cx="16" cy="14" rx="2" ry="4" />
    </SvgWrapper>
  ),

  nuclear_reactor: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 20h16" />
      <path d="M6 20c0 0 0-6 6-14c6 8 6 14 6 14" />
      <circle cx="12" cy="14" r="3" />
      <path d="M12 11.5v1" strokeWidth="1.5" />
      <path d="M10 15.5l-0.5 0.87" strokeWidth="1.5" />
      <path d="M14 15.5l0.5 0.87" strokeWidth="1.5" />
    </SvgWrapper>
  ),

  university: (props) => (
    <SvgWrapper {...props}>
      <path d="M12 3L2 8l10 5 10-5z" />
      <path d="M6 10v6c0 2 6 4 6 4s6-2 6-4v-6" />
      <path d="M20 8v8" />
    </SvgWrapper>
  ),

  electric_smelter: (props) => (
    <SvgWrapper {...props}>
      <path d="M6 19h12" />
      <path d="M8 19L10 5h4l2 14" />
      <path d="M8 13h8" />
      <path d="M13 7l-2 3h2l-2 3" strokeWidth="1.2" />
    </SvgWrapper>
  ),

  electric_kiln: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 19h16" />
      <path d="M6 13l2-8h8l2 8H6z" />
      <path d="M8 19l-2-6" />
      <path d="M16 19l2-6" />
      <path d="M13 5l-2 3h2l-2 3" strokeWidth="1.2" />
    </SvgWrapper>
  ),

  precision_works: (props) => (
    <SvgWrapper {...props}>
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1.5" fill={props.color} fillOpacity="0.3" />
      <path d="M12 2v3M12 19v3M22 12h-3M5 12H2" />
      <path d="M18 6l-2 2M8 16l-2 2M18 18l-2-2M8 8L6 6" />
      <path d="M14 4l-2 3h2l-2 3" strokeWidth="1" strokeOpacity="0.6" />
    </SvgWrapper>
  ),

  // --- RESIDENTIAL ---

  settlement: (props) => (
    <SvgWrapper {...props}>
      <path d="M12 3.5L4 9.5v11h16V9.5l-8-6z" />
      <path d="M10 20.5v-6h4v6" />
    </SvgWrapper>
  ),

  town: (props) => (
    <SvgWrapper {...props}>
       <path d="M2 12l5-4 5 4v8H2z" />
       <path d="M12 8l5-4 5 4v12h-10V8" />
    </SvgWrapper>
  ),

  city: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 19h16" />
      <rect x="5" y="11" width="4" height="8" />
      <rect x="10" y="5" width="4" height="14" />
      <rect x="15" y="8" width="4" height="11" />
      <path d="M11 7h2" strokeWidth="1" strokeOpacity="0.5" />
      <path d="M11 10h2" strokeWidth="1" strokeOpacity="0.5" />
    </SvgWrapper>
  ),
};

export const ResourceIcons: Record<string, React.FC<IconProps>> = {
  food: (props) => (
    <SvgWrapper {...props}>
      <path d="M12 22a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" />
      <path d="M12 8V2" />
      <path d="M12 5c2 0 4 1 4 3" strokeOpacity="0.5" />
    </SvgWrapper>
  ),
  wood: (props) => (
    <SvgWrapper {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="6" strokeOpacity="0.5" />
      <circle cx="12" cy="12" r="3" strokeOpacity="0.3" />
    </SvgWrapper>
  ),
  stone: (props) => (
    <SvgWrapper {...props}>
      <path d="M20 20H4l2-12 6-4 8 4z" />
    </SvgWrapper>
  ),
  iron_ore: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 20l4-12 6-4 6 4 2 12z" />
      <circle cx="9" cy="12" r="1" fill={props.color} stroke="none" />
      <circle cx="15" cy="10" r="1" fill={props.color} stroke="none" />
    </SvgWrapper>
  ),
  coal: (props) => (
    <SvgWrapper {...props}>
      <path d="M12 2l-8 10 8 10 8-10z" fill={props.color} fillOpacity="0.2" />
    </SvgWrapper>
  ),
  iron_ingot: (props) => (
    <SvgWrapper {...props}>
      <rect x="4" y="8" width="16" height="8" rx="1" />
      <path d="M4 11h16" strokeOpacity="0.3" />
    </SvgWrapper>
  ),
  tools: (props) => (
    <SvgWrapper {...props}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </SvgWrapper>
  ),
  concrete: (props) => (
    <SvgWrapper {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M4 12h16" strokeOpacity="0.3" />
      <path d="M12 4v16" strokeOpacity="0.3" />
    </SvgWrapper>
  ),
  steel: (props) => (
    <SvgWrapper {...props}>
      <path d="M6 6h12M6 18h12M12 6v12" strokeWidth="2" />
    </SvgWrapper>
  ),
  machinery: (props) => (
    <SvgWrapper {...props}>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M19 19l-3-3M5 19l3-3M19 5l-3 3" />
    </SvgWrapper>
  ),
  goods: (props) => (
    <SvgWrapper {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M10 4v16" strokeOpacity="0.3" />
    </SvgWrapper>
  ),
  electricity: (props) => (
    <SvgWrapper {...props}>
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" fill={props.color} fillOpacity="0.2" />
    </SvgWrapper>
  ),
  uranium_ore: (props) => (
    <SvgWrapper {...props}>
      <path d="M4 20l4-12 6-4 6 4 2 12z" />
      <circle cx="12" cy="13" r="3" fill={props.color} fillOpacity="0.3" stroke="none" />
      <circle cx="12" cy="13" r="3" />
    </SvgWrapper>
  ),
  enriched_uranium: (props) => (
    <SvgWrapper {...props}>
      <rect x="9" y="3" width="6" height="18" rx="2" />
      <circle cx="12" cy="12" r="2" fill={props.color} fillOpacity="0.4" stroke="none" />
      <path d="M9 8h6" strokeOpacity="0.4" />
      <path d="M9 16h6" strokeOpacity="0.4" />
    </SvgWrapper>
  ),
  population: (props) => (
    <SvgWrapper {...props}>
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" />
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    </SvgWrapper>
  ),
};
