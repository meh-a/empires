// ── server/game/persistence.js ──
// World save/load. Terrain (mapHeight/mapVariant/mapMoisture/mapFertility) is
// regenerated from seed on load; only mutable state is stored.

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { MAP_W, MAP_H } from './constants.js';
import { Kingdom } from './Kingdom.js';
import { rebuildNavBlocked } from './buildings.js';

const MAX_SAVE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Encoding helpers ──────────────────────────────────────────────
function u8ToB64(arr) {
  return Buffer.from(arr).toString('base64');
}
function b64ToU8(str, len) {
  const buf = Buffer.from(str, 'base64');
  const out = new Uint8Array(len);
  out.set(buf.slice(0, len));
  return out;
}
// Flatten 2D tile array → Uint8Array → base64
function tilesToB64(tiles) {
  const flat = new Uint8Array(MAP_H * MAP_W);
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      flat[y * MAP_W + x] = tiles[y]?.[x] ?? 0;
  return u8ToB64(flat);
}
function b64ToTiles(str) {
  const flat = b64ToU8(str, MAP_H * MAP_W);
  const tiles = [];
  for (let y = 0; y < MAP_H; y++) {
    tiles[y] = [];
    for (let x = 0; x < MAP_W; x++) tiles[y][x] = flat[y * MAP_W + x];
  }
  return tiles;
}

// ── Villager serialization ────────────────────────────────────────
function saveVillager(v) {
  // Clear paths — they'll re-route from saved targets next tick
  const state = (v.state === 'moving' || v.state === 'roaming' || v.state === 'patrolling')
    ? 'idle' : v.state;
  return {
    id: v.id, name: v.name, role: v.role,
    x: v.x, y: v.y, tx: v.tx, ty: v.ty,
    state, idleTimer: Math.max(0, v.idleTimer ?? 0),
    hunger: v.hunger, tired: v.tired,
    hp: v.hp, maxHp: v.maxHp,
    tier: v.tier, xp: v.xp, toolTier: v.toolTier ?? 0,
    upgradeTimer: v.upgradeTimer,
    _trainingRole: v._trainingRole ?? null,
    _trainingTimer: v._trainingTimer ?? null,
    _trainingBuilding: v._trainingBuilding ?? null,
    _goingSleep: v._goingSleep ?? false,
    _sleepTarget: v._sleepTarget ?? null,
    buildTarget: v.buildTarget ?? null,
    chopTarget: v.chopTarget ? { id: v.chopTarget.id, tx: v.chopTarget.tx, ty: v.chopTarget.ty } : null,
    mineTarget: v.mineTarget ? v.mineTarget.id : null,
    farmTarget: v.farmTarget ? v.farmTarget.id : null,
    bakeryTarget: v.bakeryTarget ? v.bakeryTarget.id : null,
    forgeTarget: v.forgeTarget ? v.forgeTarget.id : null,
    repairTarget: v.repairTarget ?? null,
    towerTarget: v.towerTarget ?? null,
    _pfSlot: v._pfSlot ?? 0,
  };
}
function loadVillager(d, room) {
  // Re-resolve building references from saved IDs
  const bldById = id => room.buildings.find(b => b.id === id) ?? null;
  const v = {
    id: d.id, name: d.name, role: d.role,
    x: d.x, y: d.y, tx: d.tx, ty: d.ty,
    state: d.state, idleTimer: d.idleTimer,
    hunger: d.hunger, tired: d.tired,
    hp: d.hp, maxHp: d.maxHp,
    tier: d.tier, xp: d.xp, toolTier: d.toolTier,
    upgradeTimer: d.upgradeTimer,
    _trainingRole: d._trainingRole, _trainingTimer: d._trainingTimer,
    _trainingBuilding: d._trainingBuilding,
    _goingSleep: d._goingSleep, _sleepTarget: d._sleepTarget,
    buildTarget: d.buildTarget,
    chopTarget: d.chopTarget,
    mineTarget: d.mineTarget != null ? bldById(d.mineTarget) : null,
    farmTarget: d.farmTarget != null ? bldById(d.farmTarget) : null,
    bakeryTarget: d.bakeryTarget != null ? bldById(d.bakeryTarget) : null,
    forgeTarget: d.forgeTarget != null ? bldById(d.forgeTarget) : null,
    repairTarget: d.repairTarget,
    towerTarget: d.towerTarget,
    attackAnim: 0, _hitFlash: 0, _stuckTimer: 0,
    chopTimer: 0, buildTimer: 0, farmTimer: 0, bakeTimer: 0,
    mineTimer: 0, forgeTimer: 0, repairTimer: 0,
    path: [], _pathCache: null,
    _pfSlot: d._pfSlot ?? 0,
    _despawn: false, _usedNames: new Set(),
  };
  return v;
}

// ── Kingdom serialization ─────────────────────────────────────────
function saveKingdom(k) {
  return {
    id: k.id, name: k.name,
    gold: k.gold, wood: k.wood, food: k.food,
    crops: k.crops, stone: k.stone, iron: k.iron,
    toolStock: [...k.toolStock],
    buildCounts: [...k.buildCounts],
    settled: k.settled,
    townCenter: k.townCenter,
    villagers: k.villagers.filter(v => !v._despawn).map(saveVillager),
    buildings: k.buildings.map(b => ({
      ...b,
      assignedBuilders: [...(b.assignedBuilders ?? [])],
    })),
    roadTiles: [...k.roadTiles],
    fogExplored: u8ToB64(k.fogExplored),
    gameState: k.gameState,
    alertMode: k.alertMode,
    _accountUsername: k._accountUsername,
    _gracefulOffline: k._gracefulOffline ?? false,
    tier4Slots: k.tier4Slots,
    tier5Slots: k.tier5Slots,
    _vid: k._vid, _bid: k._bid,
    spawnTimer: k.spawnTimer, goldTimer: k.goldTimer, feedTimer: k.feedTimer,
    navBlockedVersion: k.navBlockedVersion,
    _pfRound: k._pfRound, _pfCounter: k._pfCounter,
  };
}
function loadKingdom(room, d) {
  const k = new Kingdom(room, d.id);
  k.name = d.name;
  k.gold = d.gold; k.wood = d.wood; k.food = d.food;
  k.crops = d.crops; k.stone = d.stone; k.iron = d.iron;
  k.toolStock = [...d.toolStock];
  k.buildCounts = [...d.buildCounts];
  k.settled = d.settled;
  k.townCenter = d.townCenter;
  k.buildings = d.buildings.map(b => ({
    ...b,
    assignedBuilders: [...(b.assignedBuilders ?? [])],
  }));
  k.roadTiles = new Set(d.roadTiles);
  k.fogExplored = b64ToU8(d.fogExplored, MAP_W * MAP_H);
  k.fogVisible = new Uint8Array(MAP_W * MAP_H);
  k.gameState = d.gameState;
  k.alertMode = d.alertMode;
  k._accountUsername  = d._accountUsername;
  k._gracefulOffline  = d._gracefulOffline ?? false;
  k.tier4Slots = d.tier4Slots;
  k.tier5Slots = d.tier5Slots;
  k._vid = d._vid; k._bid = d._bid;
  k.spawnTimer = d.spawnTimer; k.goldTimer = d.goldTimer; k.feedTimer = d.feedTimer;
  k.navBlockedVersion = d.navBlockedVersion ?? 0;
  k._pfRound = d._pfRound ?? 0; k._pfCounter = d._pfCounter ?? 0;
  // Villagers are loaded after kingdom so building refs resolve
  k.villagers = d.villagers.map(vd => loadVillager(vd, k));
  rebuildNavBlocked(k);
  return k;
}

// ── Bot kingdom serialization ─────────────────────────────────────
function saveBotUnit(u) {
  return {
    id: u.id, role: u.role ?? null,
    x: u.x, y: u.y, tx: u.tx, ty: u.ty,
    hp: u.hp, maxHp: u.maxHp,
    state: (u.state === 'moving' || u.state === 'patrolling') ? 'idle' : (u.state ?? 'idle'),
  };
}
function saveBotKingdom(ek) {
  return {
    id: ek.id, difficulty: ek.difficulty,
    tx: ek.tx, ty: ek.ty,
    hp: ek.hp, maxHp: ek.maxHp,
    raidTimer: ek.raidTimer, raidInterval: ek.raidInterval,
    name: ek.name,
    buildings: ek.buildings ?? [],
    villagers: (ek.villagers ?? []).map(saveBotUnit),
    guards:    (ek.guards    ?? []).filter(g => !g._despawn).map(saveBotUnit),
    scouts:    (ek.scouts    ?? []).filter(s => !s._despawn).map(saveBotUnit),
    _scoutTimer: ek._scoutTimer ?? 60,
  };
}
function loadBotUnit(d) {
  return {
    ...d,
    path: [], attackTarget: null, attackTimer: 0, attackAnim: 0,
    _hitFlash: 0, _despawn: false, _stuckTimer: 0,
  };
}
function loadBotKingdom(d) {
  return {
    id: d.id, difficulty: d.difficulty,
    tx: d.tx, ty: d.ty,
    hp: d.hp, maxHp: d.maxHp,
    raidTimer: d.raidTimer, raidInterval: d.raidInterval,
    name: d.name,
    buildings: d.buildings ?? [],
    villagers: (d.villagers ?? []).map(loadBotUnit),
    guards:    (d.guards    ?? []).map(loadBotUnit),
    scouts:    (d.scouts    ?? []).map(loadBotUnit),
    _scoutTimer: d._scoutTimer ?? 60,
  };
}

// ── Public API ────────────────────────────────────────────────────
export function serializeRoom(room) {
  return {
    version: 2,
    savedAt: Date.now(),
    seed: room.seed,
    dayTime: room.dayTime,
    day: room.day,
    mapTiles: tilesToB64(room.mapTiles),
    trees: room.trees,
    _treeId: room._treeId,
    resourceNodes: room.resourceNodes,
    regrowthQueue: room.regrowthQueue,
    enemyKingdomSites: room.enemyKingdomSites,
    botKingdoms: room.botKingdoms.filter(ek => ek.hp > 0).map(saveBotKingdom),
    _ekId: room._ekId, _ekBldId: room._ekBldId, _ekVilId: room._ekVilId,
    _nextBotTimer: room._nextBotTimer,
    _totalBotWaves: room._totalBotWaves,
    _botsInitialised: room._botsInitialised,
    _kidCounter: room._kidCounter,
    kingdoms: room.kingdoms.map(saveKingdom),
  };
}

// Called after generate() has already populated terrain arrays.
// Overlays saved mutable state onto the room.
export function restoreRoom(room, data) {
  room.seed    = data.seed;
  room.dayTime = data.dayTime;
  room.day     = data.day;
  // Override mapTiles from save (has tree-chopped changes etc.)
  room.mapTiles = b64ToTiles(data.mapTiles);
  room.trees    = data.trees ?? [];
  room._treeId  = data._treeId ?? 0;
  room.resourceNodes    = data.resourceNodes ?? [];
  room.regrowthQueue    = data.regrowthQueue ?? [];
  room.enemyKingdomSites = data.enemyKingdomSites ?? [];
  room._ekId        = data._ekId ?? 0;
  room._ekBldId     = data._ekBldId ?? -100;
  room._ekVilId     = data._ekVilId ?? -200;
  room._nextBotTimer   = data._nextBotTimer ?? 0;
  room._totalBotWaves  = data._totalBotWaves ?? 0;
  room._botsInitialised = data._botsInitialised ?? false;
  room._kidCounter = data._kidCounter ?? 0;
  room.botKingdoms = (data.botKingdoms ?? []).map(loadBotKingdom);
  room.kingdoms    = (data.kingdoms    ?? []).map(d => loadKingdom(room, d));
}

export function saveToFile(room, filePath) {
  try {
    const data = serializeRoom(room);
    writeFileSync(filePath, JSON.stringify(data));
    console.log(`[persist] world saved (${room.kingdoms.length} kingdoms, day ${room.day})`);
  } catch (e) {
    console.error('[persist] save failed:', e.message);
  }
}

export function loadFromFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!data.version || !data.savedAt) return null;
    if (Date.now() - data.savedAt > MAX_SAVE_AGE_MS) {
      console.log('[persist] save is older than 24 h — starting fresh');
      return null;
    }
    console.log(`[persist] found save from ${new Date(data.savedAt).toISOString()}, day ${data.day}`);
    return data;
  } catch (e) {
    console.error('[persist] load failed:', e.message);
    return null;
  }
}
