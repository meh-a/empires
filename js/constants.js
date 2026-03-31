// ── constants.js ──
'use strict';

// ═══════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════
const MAP_W   = 200;
const MAP_H   = 200;
const TILE_SZ = 32;   // base pixel size per tile

// Tile type enum
const T = Object.freeze({
  DEEP:0, WATER:1, SAND:2, GRASS:3, FOREST:4, HILL:5, MOUNTAIN:6, PEAK:7, RIVER:8
});

const TILE_NAME = [
  'Deep Water','Shallow Water','Sandy Shore',
  'Grassland','Forest','Hills','Mountains','Snowy Peak','River'
];

// Minimap / legend colors
const TILE_COL_HEX = [
  '#1a4878','#2462a0','#b89650',
  '#4a7830','#28501a','#7a6848','#6a5e50','#ccc8c0','#3c7ab8'
];
const TILE_RGB = TILE_COL_HEX.map(h=>[
  parseInt(h.slice(1,3),16),
  parseInt(h.slice(3,5),16),
  parseInt(h.slice(5,7),16)
]);

const ZOOM_MIN   = 0.3;
const ZOOM_MAX   = 4.5;
const PAN_PX     = 300; // pixels per second when keyboard panning
const EDGE_PX    = 44;  // edge-scroll activation zone
const FOG_RADIUS          = 9;   // tile vision radius per villager
const EXPLORER_FOG_RADIUS = 16;  // explorers see further

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let SEED = Math.floor(Math.random() * 1_000_000);

let mapTiles    = [];  // Uint8Array rows
let mapHeight   = [];  // Float32Array rows  (0..1)
let mapVariant  = [];  // Float32Array rows  (0..1, texture noise)
let mapMoisture = [];  // Float32Array rows  (0..1, kept after biome pass)

// Fog of war (flat arrays for speed)
let fogVisible  = new Uint8Array(MAP_W * MAP_H); // 1 = currently in vision
let fogExplored = new Uint8Array(MAP_W * MAP_H); // 1 = ever visited

// ── Resources ──────────────────────────────────────
let gold  = 100;
let wood  = 0;
let food  = 20;
let crops = 0;
let stone = 0;
let iron  = 0;

// ── Day / Night ────────────────────────────────────
const DAY_LENGTH   = 120;   // seconds per full cycle
const LEASH_RADIUS = 35;    // tiles from town center
const CHOP_TIME    = 7;     // seconds per tree chop
const CHOP_YIELD   = 3;     // wood produced per chop
const HUNGER_RATE  = 1/300; // hunger drained/sec (full→empty in 5 min)
const TIRED_RATE   = 0.12;  // tiredness/sec when awake at deep night
const FEED_TICK    = 20;    // seconds between feeding rounds
const FEED_RESTORE = 0.35;  // hunger restored per feeding event
let dayTime = 0.3;          // 0=midnight, 0.5=noon; start at morning

// ── Possession ──────────────────────────────────────
let possessedVillager = null;  // the knight currently being body-controlled
const POSSESS_SPEED   = 4.5;   // tiles/sec when possessed (faster than normal)

// ── Town Center ─────────────────────────────────────
let settled           = false;
let placingTownCenter = false;
let townCenter        = null;   // {tx, ty}
let trees             = [];     // individual tree objects
let _choppingIds      = new Set(); // tree ids currently being chopped (for wobble)
let spawnTimer        = 0;
let goldTimer         = 0;
let feedTimer         = 0;

function getTerritoryRadius() {
  if (!settled) return LEASH_RADIUS;
  const built = buildings.filter(b => b.complete).length;
  const goldBonus = Math.floor(gold / 100);
  return Math.min(60, 20 + built * 3 + goldBonus);
}

let zoom    = 1.0;
let zoomTarget = 1.0;
let zoomAnchorWX = 0, zoomAnchorWY = 0; // world-tile anchor for smooth zoom
let zoomAnchorSX = 0, zoomAnchorSY = 0; // screen-pixel anchor for smooth zoom
let camX    = 0;      // world-pixel of top-left of viewport
let camY    = 0;
let camVX   = 0, camVY = 0;     // inertia velocity (px/s)
let camTargetX = null, camTargetY = null; // minimap pan destination
let time    = 0;
let showGrid = false;
let mmCache  = null;  // offscreen minimap canvas

// ── Villager role constants ──────────────────────────────────────
const VROLE = { WOODCUTTER:'Woodcutter', BUILDER:'Builder', KNIGHT:'Knight', BASIC:'Basic', FARMER:'Farmer', BAKER:'Baker', STONE_MINER:'StoneMiner', TOOLSMITH:'Toolsmith', ARCHER:'Archer', MECHANIC:'Mechanic', EXPLORER:'Explorer' };

const ROLE_COLOR = {
  Woodcutter: [139, 69,  19],
  Builder:    [212,116,  10],
  Knight:     [160,168, 176],
  Basic:      [200,168, 122],
  Farmer:     [ 60,140,  40],
  Baker:      [220,200, 160],
  StoneMiner: [128,110,  90],
  Toolsmith:  [ 90, 70,  48],
  Archer:     [ 60,160,  50],
  Mechanic:   [ 80,120, 180],
  Explorer:   [ 40,180, 160],
};

const ROLE_LETTER = { Woodcutter:'W', Builder:'B', Knight:'K', Basic:'V', Farmer:'F', Baker:'A', StoneMiner:'M', Toolsmith:'T', Archer:'R', Mechanic:'X', Explorer:'E' };

// ── Gameplay constants ──────────────────────────────
const FARM_TIME        = 12;   // seconds per farming cycle
const FARM_YIELD       = 3;    // crops per cycle
const BAKE_TIME        = 8;    // seconds per baking cycle
const BAKE_COST        = 2;    // crops consumed per bake
const BAKE_YIELD       = 5;    // food produced per bake
const PATROL_RADIUS    = 12;   // tiles from town center for knight patrol
const MINE_TIME        = 15;   // seconds per mining cycle
const MINE_YIELD       = 2;    // stone per cycle
const MINE_IRON_CHANCE = 0.25; // chance tier-3 miner also gets iron
// Tool tiers: 0=wood, 1=stone, 2=iron  (Woodcutter, Builder, StoneMiner benefit)
const TOOL_SPEED    = [1.0, 1.30, 1.65]; // work-speed multiplier per tool tier
const CRAFT_TIME    = [0, 18, 28];       // seconds to forge stone/iron tools (index = tier)
const CRAFT_COST    = [{}, {stone:4}, {iron:5}]; // resources consumed per tool tier
const REPAIR_TIME   = 6;    // seconds per repair cycle
const REPAIR_RATE   = 20;   // HP restored per cycle
const REPAIR_STONE  = 1;    // stone consumed per cycle
// Villager tiers: 1/2/3 — gained by completing work cycles
const TIER_XP_REQ   = [10, 30];          // cycles needed to reach tier 2, then 3
const TIER_SPEED    = [1.0, 1.15, 1.35]; // work-speed multiplier per villager tier
// Tool inventory
let toolStock = [999, 0, 0];  // count of available tools per tier (wood is unlimited)
// ── Combat constants ─────────────────────────────────────────────
// Building HP: [House, Bakery, Wall, Tower, Farmland, Mine, Barracks, Forge, Road, Outpost]
const BLDG_HP_MAX    = [80, 30, 100, 120, 20, 50, 80, 50, 1, 120];
const TC_HP_MAX      = 250;
const UNIT_HP_MAX    = { Woodcutter:15, Builder:20, Knight:55, Basic:12, Farmer:10, Baker:10, StoneMiner:20, Toolsmith:15, Archer:22, Mechanic:18 };
// Player knight melee
const KNIGHT_ATK_DMG   = 14;
const KNIGHT_ATK_RANGE = 1.6;   // tiles
const KNIGHT_ATK_SPD   = 1.3;   // seconds/attack
// Player archer ranged
const ARCHER_ATK_DMG   = 9;
const ARCHER_ATK_RANGE = 7.0;
const ARCHER_ATK_SPD   = 2.0;
// Enemy units
const ENEMY_INF_HP    = 30;
const ENEMY_ARC_HP    = 18;
const ENEMY_INF_DMG   = 10;
const ENEMY_ARC_DMG   = 6;
const ENEMY_MELEE_RNG = 1.3;
const ENEMY_ARC_RNG   = 5.5;
const ENEMY_ATK_SPD   = 1.8;
const ENEMY_SPEED     = 1.8;   // tiles/sec
// Raid pacing
const RAID_INTERVAL   = 300;   // seconds between raids (at base territory)
const RAID_SIZE_MIN   = 3;
const RAID_SIZE_MAX   = 10;

// ── Building costs (matches STRUCT_NAME order) ──────────────────
// [House, Bakery, Wall, Tower, Farmland, Mine, Barracks, Forge, Road, Outpost]
const STRUCT_COST = [
  {wood:5},                    // House
  {wood:6},                    // Bakery
  {stone:4},                   // Wall
  {stone:8},                   // Tower
  {wood:3},                    // Farmland
  {wood:8},                    // Mine
  {wood:6,stone:4},            // Barracks
  {wood:4,stone:6},            // Forge
  {wood:1},                    // Road (instant, no builder)
  {wood:40, stone:20},         // Outpost (Camp)
];

// Tracks how many of each building type has been placed (for cost scaling)
let buildCounts = new Array(STRUCT_COST.length).fill(0);

let day = 1;               // current in-game day counter

const SPAWN_INTERVAL   = 45;   // seconds between new-villager checks
const MAX_VILLAGERS    = 20;   // soft pop cap
const BASIC_UPGRADE_TIME = 100; // seconds before a basic auto-upgrades
const GOLD_TICK        = 20;   // seconds between passive gold income

// ── Buildings state ──────────────────────────────────
let buildings  = [];
let buildMode  = false;
let placingType = null; // null or 0-7
let _bid = 0;

// ── Villager state ────────────────────────────────────
const V_NAMES = ['Aldric','Bram','Celt','Dorset','Erwin','Finn',
                 'Gord','Holt','Ivan','Jorn','Kern','Lothar','Mord','Neth','Oswin'];
let _usedNames = new Set();

let villagers = [];
let selectedVillager = null;
let cameraFollow = true;
let _vid = 0;

// ── Navigation blocked grids ──────────────────────────────────────
let navBlocked      = new Uint8Array(MAP_W * MAP_H); // enemies: walls + solid buildings
let villagerBlocked = new Uint8Array(MAP_W * MAP_H); // villagers: solid buildings + trees

// ── Enemy kingdom sites (pre-computed during world gen) ───────────
let enemyKingdomSites = []; // {tx, ty} candidates, consumed by _spawnKingdom

// ── Roads ────────────────────────────────────────────
let roadTiles = new Set();  // flat tile indices (ty*MAP_W+tx) covered by roads

// ── Bandits ───────────────────────────────────────────
let bandits = [];
let _banditId = 0;
let _banditSpawnTimer = 0;

// Adjacency bonus table: building type → { neighbour type: bonus fraction }
const ADJACENCY_TABLE = {
  1: { 4: 0.30 },                // Bakery + Farmland = +30%
  7: { 5: 0.40 },                // Forge + Mine = +40%
  6: { 7: 0.25 },                // Barracks + Forge = +25%
  5: { 5: 0.15 },                // Mine + Mine = +15%
  0: { 0: 0.10, 1: 0.20 },      // House + House / Bakery
  4: { 4: -0.10 },               // Farm + Farm = soil competition
};

// ── Resource nodes ────────────────────────────────────
let resourceNodes = [];  // { id, type, tx, ty, radius, bonus, discovered, active }
let regrowthQueue = [];  // { tx, ty, timer } — ancient forest tree respawns

const NODE_NAMES = {
  quarry:   'Stone Quarry',
  iron:     'Iron Vein',
  farmland: 'Fertile Farmland',
  forest:   'Ancient Forest',
  delta:    'River Delta',
};

// Minimap dot colours per node type
const NODE_MM_COL = {
  quarry:   '#c8c8a0',
  iron:     '#b06040',
  farmland: '#60c060',
  forest:   '#1a5c1a',
  delta:    '#4080c0',
};

// ── Tree constants ────────────────────────────────────
const TREE_SPAWN_CHANCE = 0.65; // probability a forest tile gets a pine tree
let _treeId = 0;

// ── Villager movement constants ───────────────────────
const VILLAGER_SPEED = 3.0; // tiles/sec
const ROAM_RADIUS   = 7;
