// ── server/game/sprites.js ── (server-only subset — no pixel-art stamp data)
import { T } from './constants.js';

export const STRUCT_NAME         = ['House','Bakery','Wall','Tower','Farmland','Mine','Barracks','Forge','Road','Outpost','Gate'];
export const STRUCT_BUILD_TIME   = [15,20,8,25,10,30,25,20,0,45,10];
export const STRUCT_MAX_BUILDERS = 3;
export const STRUCT_SIZE         = [[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1],[1,1]];

export const STRUCT_VALID = [
  new Set([T.GRASS,T.SAND,T.HILL]),
  new Set([T.GRASS,T.SAND,T.HILL]),
  new Set([T.GRASS,T.SAND,T.HILL]),
  new Set([T.GRASS,T.SAND,T.HILL]),
  new Set([T.GRASS,T.SAND]),
  new Set([T.GRASS,T.SAND,T.HILL]),
  new Set([T.GRASS,T.SAND,T.HILL]),
  new Set([T.GRASS,T.SAND,T.HILL]),
  new Set([T.GRASS,T.SAND,T.HILL,T.FOREST,T.RIVER]),
  new Set([T.GRASS,T.SAND,T.HILL]),
  new Set([T.GRASS,T.SAND,T.HILL]), // Gate — same tiles as wall
];

// BLDG_HEIGHT drives HP calculation in mkBuilding; used server-side too
export const BLDG_HEIGHT = [1.10,1.15,1.00,1.70,1.00,1.20,1.35,1.20,1.00,1.80,1.00];
