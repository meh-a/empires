// ── server/game/constants.js ── (pure constants, no mutable state)

export const MAP_W   = 200;
export const MAP_H   = 200;
export const TILE_SZ = 32;

// Tile type enum
export const T = Object.freeze({
  DEEP:0, WATER:1, SAND:2, GRASS:3, FOREST:4, HILL:5, MOUNTAIN:6, PEAK:7, RIVER:8
});

// Villager roles
export const VROLE = Object.freeze({
  WOODCUTTER:'Woodcutter', BUILDER:'Builder', KNIGHT:'Knight', BASIC:'Basic',
  FARMER:'Farmer', BAKER:'Baker', STONE_MINER:'StoneMiner', TOOLSMITH:'Toolsmith',
  ARCHER:'Archer', MECHANIC:'Mechanic', EXPLORER:'Explorer',
});

// Day / Night
export const DAY_LENGTH   = 120;
export const LEASH_RADIUS = 35;
export const CHOP_TIME    = 14;
export const CHOP_YIELD   = 3;
export const HUNGER_RATE  = 1/300;
export const TIRED_RATE   = 0.12;
export const FEED_TICK    = 20;
export const FEED_RESTORE = 0.35;

// Villager movement
export const VILLAGER_SPEED = 3.0;
export const ROAM_RADIUS    = 7;
export const PATROL_RADIUS  = 12;
export const POSSESS_SPEED  = 4.5;
export const BASIC_UPGRADE_TIME = 100;
export const GOLD_TICK      = 20;
export const SPAWN_INTERVAL = 45;
export const MAX_VILLAGERS  = 20;

// Work constants
export const FARM_TIME        = 24;
export const FARM_YIELD       = 3;
export const BAKE_TIME        = 8;
export const BAKE_COST        = 2;
export const BAKE_YIELD       = 5;
export const MINE_TIME        = 26;
export const MINE_YIELD       = 2;
export const MINE_IRON_CHANCE = 0.25;
export const REPAIR_TIME      = 6;
export const REPAIR_RATE      = 20;
export const REPAIR_STONE     = 1;

// Tool tiers: 0=wood, 1=stone, 2=iron
export const TOOL_SPEED  = [1.0, 1.30, 1.65];
export const CRAFT_TIME  = [0, 18, 28];
export const CRAFT_COST  = [{}, {stone:4}, {iron:5}];

// Villager tiers
export const TIER_XP_REQ  = [10, 30, 60, 100];           // T1→T2, T2→T3, T3→T4, T4→T5
export const TIER_SPEED   = [1.0, 1.15, 1.35, 1.55, 1.80]; // T1–T5 work speed multipliers

// Combat constants
export const BLDG_HP_MAX    = [80, 30, 100, 120, 20, 50, 80, 50, 1, 120, 80]; // Gate=80
export const TC_HP_MAX      = 250;
export const UNIT_HP_MAX    = { Woodcutter:15, Builder:20, Knight:55, Basic:12, Farmer:10, Baker:10, StoneMiner:20, Toolsmith:15, Archer:22, Mechanic:18 };
export const KNIGHT_ATK_DMG   = 14;
export const KNIGHT_ATK_RANGE = 1.6;
export const KNIGHT_ATK_SPD   = 1.3;
export const ARCHER_ATK_DMG   = 9;
export const ARCHER_ATK_RANGE = 7.0;
export const ARCHER_ATK_SPD   = 2.0;
export const ENEMY_INF_HP    = 30;
export const ENEMY_ARC_HP    = 18;
export const ENEMY_INF_DMG   = 14;
export const ENEMY_ARC_DMG   = 9;
export const ENEMY_MELEE_RNG = 1.3;
export const ENEMY_ARC_RNG   = 5.5;
export const ENEMY_ATK_SPD   = 1.4;
export const ENEMY_SPEED     = 1.8;
export const RAID_INTERVAL   = 120;

// Building tier names — null means not upgradeable
export const BLDG_TIER_NAMES = [
  ['House','Manor','Estate'],          // 0 House
  ['Bakery','Mill','Granary'],         // 1 Bakery
  null,                                // 2 Wall
  ['Tower','Watchtower','Fortress'],   // 3 Tower
  null,                                // 4 Farmland
  ['Mine','Deep Mine','Iron Works'],   // 5 Mine
  ['Barracks','War Camp','Citadel'],   // 6 Barracks
  ['Forge','Smithy','Foundry'],        // 7 Forge
  null, null, null,                    // 8,9,10
];

// Tier upgrade costs — index 0 = T1→T2, index 1 = T2→T3
export const BLDG_TIER_COSTS = [
  [{wood:30,stone:20},        {wood:50,stone:30,gold:20}],  // House
  [{wood:20,stone:10,iron:10},{iron:20,gold:30}],            // Bakery
  null,                                                       // Wall
  [{stone:40,iron:20},        {stone:60,iron:40}],           // Tower
  null,                                                       // Farmland
  [{wood:20,iron:20},         {iron:40,stone:20}],           // Mine
  [{iron:30,gold:20},         {iron:60,gold:40}],            // Barracks
  [{iron:50,stone:30},        {iron:80,gold:60}],            // Forge
  null, null, null,                                          // 8,9,10
];

// Wave scaling
export const WAVE_TC_HP    = [250, 340, 440, 560];
export const WAVE_RAID_INT = [120, 95, 75, 60];
export const WAVE_RAID_MIN = [3, 5, 8, 11];
export const WAVE_RAID_MAX = [6, 10, 15, 20];
export const WAVE_NAMES    = ['Iron Keep','Ashgate','Dreadholm','Shadowmere','Ironfang'];
export const NEXT_WAVE_DELAY = 90;

// Building costs
export const STRUCT_COST = [
  {wood:5},
  {wood:6},
  {stone:4},
  {stone:8},
  {wood:3},
  {wood:8},
  {wood:6,stone:4},
  {wood:4,stone:6},
  {wood:1},
  {wood:40, stone:20, iron:4},
  {stone:5},                   // Gate
];

// Adjacency bonus table
export const ADJACENCY_TABLE = {
  1: { 4: 0.30, 9: 0.20 },   // Bakery: +20% near Outpost
  7: { 5: 0.40, 9: 0.25 },   // Forge: +25% near Outpost
  6: { 7: 0.25, 9: 0.20 },   // Barracks: +20% near Outpost
  5: { 5: 0.15, 9: 0.30 },   // Mine: +30% near Outpost (supply lines)
  0: { 0: 0.10, 1: 0.20 },
  4: { 4: -0.10, 9: 0.25 },  // Farmland: +25% near Outpost (supply lines)
};

// Resource nodes
export const NODE_NAMES = {
  quarry:   'Stone Quarry',
  iron:     'Iron Vein',
  farmland: 'Fertile Farmland',
  forest:   'Ancient Forest',
  delta:    'River Delta',
};

// Trees
export const TREE_SPAWN_CHANCE = 0.65;

// NPC constants (also used in combat.js for raid sizing)
export const NPC_VISIT_INTERVAL = 90;
export const NPC_TERRITORY_REQ  = 22;
export const NPC_VISIT_CHANCE   = 0.72;
export const NPC_APPROACH_DIST  = 28;
export const NPC_WAIT_TIME      = 40;
export const NPC_SPEED          = 2.4;

// Fog
export const FOG_RADIUS          = 9;
export const EXPLORER_FOG_RADIUS = 16;

// Villager names pool
export const V_NAMES = ['Aldric','Bram','Celt','Dorset','Erwin','Finn',
                        'Gord','Holt','Ivan','Jorn','Kern','Lothar','Mord','Neth','Oswin'];

// Tool roles set
export const TOOL_ROLES = new Set([VROLE.WOODCUTTER, VROLE.BUILDER, VROLE.STONE_MINER]);

// House capacity
export const HOUSE_CAP    = 4;
export const TRAIN_TIME   = 25;

// Seasons
export const SEASON_LENGTH = 10;   // days per season
export const SEASON_NAMES  = ['Spring','Summer','Autumn','Winter'];
export const FARM_SPEED    = [1.1, 1.3, 0.9, 0.5]; // timer speed multiplier; winter yield is blocked separately
export const REGROWTH_BASE = 60;   // seconds (was hardcoded in villager-ai)
export const REGROWTH_MULT = [1.0, 0.9, 1.1, 2.0]; // Winter doubles regrowth time

// Building prerequisites for manual upgrade
export const UPGRADE_PREREQ = {
  Knight:      6,
  Archer:      3,
  Baker:       1,
  StoneMiner:  5,
  Toolsmith:   7,
  Farmer:      4,
};
