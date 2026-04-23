// ── server/game/Kingdom.js ──
// Per-player (or per-bot) state.
// World data (mapTiles, trees, etc.) is proxied to the parent GameRoom
// so all existing AI functions work unchanged when passed a Kingdom.

import { MAP_W, MAP_H, TOOL_ROLES } from './constants.js';

export class Kingdom {
  constructor(room, id) {
    this.id   = id;
    this._room = room;
    this.ws   = null;   // set for human players
    this.name = `Player ${id + 1}`;

    // ── Economy ──────────────────────────────────────
    this.gold  = 100; this.wood  = 0; this.food  = 20;
    this.crops = 0;   this.stone = 0; this.iron  = 0;
    this.toolStock  = [999, 0, 0];
    this.buildCounts = new Array(10).fill(0);
    this._TOOL_ROLES = TOOL_ROLES;

    // ── Settlement ───────────────────────────────────
    this.settled    = false;
    this.townCenter = null;

    // ── Entities ─────────────────────────────────────
    this.villagers = [];
    this.buildings = [];
    this.roadTiles = new Set();

    // ── Navigation ───────────────────────────────────
    this.navBlocked        = new Uint8Array(MAP_W * MAP_H);
    this.villagerBlocked   = new Uint8Array(MAP_W * MAP_H);
    this.navBlockedVersion = 0;   // bumped by rebuildNavBlocked; invalidates path caches

    // ── Pathfinding stagger ───────────────────────────
    this._pfRound   = 0;   // incremented each updateVillagers call
    this._pfCounter = 0;   // assigns _pfSlot to new villagers

    // ── Combat (enemy units attacking THIS kingdom) ──
    this.enemyKingdoms = [];  // rebuilt each tick: botKingdoms + other player views
    this.enemyUnits    = [];
    this.projectiles   = [];
    this._eid = 0; this._pid = 0;
    this.gameState         = 'playing';
    this.alertMode         = false;
    this._defendRerouteTimer = 0;
    this._alertNotified    = false;

    // ── Fog ──────────────────────────────────────────
    this.fogVisible  = new Uint8Array(MAP_W * MAP_H);
    this.fogExplored = new Uint8Array(MAP_W * MAP_H);

    // ── NPCs ─────────────────────────────────────────
    this.npcs = []; this._npcId = 0;
    this.npcVisitTimer = 0; this.npcModal = null;

    // ── Bandits ──────────────────────────────────────
    this.bandits = []; this._banditId = 0; this._banditSpawnTimer = 0;

    // ── Timers / counters ─────────────────────────────
    this.spawnTimer = 0; this.goldTimer = 0; this.feedTimer = 0;
    this._vid = 0; this._bid = 0;
    this._usedNames = new Set();

    // ── Enemy-kingdom entity ID pools (negative to avoid collisions) ──
    this._ekBldId = -100;
    this._ekVilId = -200;

    // ── Events ───────────────────────────────────────
    this.pendingEvents   = [];
    this._tileChanges    = [];
    this._removedTreeIds = [];

    // ── Quests ───────────────────────────────────────
    this.claimedQuests = new Set();

    // ── Account ──────────────────────────────────────
    this._accountUsername = null; // set when player is logged in
    this.tier4Slots = 0;          // how many villagers may reach T4
    this.tier5Slots = 0;          // how many villagers may reach T5

    // ── Reconnect state ───────────────────────────────
    this._disconnectedAt  = null;
    this._gracefulOffline = false; // set by go_offline — kingdom persists indefinitely

    // ── Proxy shared world data to GameRoom ──────────
    const r = room;
    Object.defineProperties(this, {
      mapTiles:    { get: () => r.mapTiles,    enumerable: true },
      mapHeight:   { get: () => r.mapHeight,   enumerable: true },
      mapVariant:  { get: () => r.mapVariant,  enumerable: true },
      mapMoisture: { get: () => r.mapMoisture, enumerable: true },
      mapFertility:{ get: () => r.mapFertility,enumerable: true },
      trees:       { get: () => r.trees, set: v => { r.trees = v; }, enumerable: true },
      resourceNodes:     { get: () => r.resourceNodes, enumerable: true },
      regrowthQueue:     { get: () => r.regrowthQueue, set: v => { r.regrowthQueue = v; }, enumerable: true },
      enemyKingdomSites: { get: () => r.enemyKingdomSites, set: v => { r.enemyKingdomSites = v; }, enumerable: true },
      dayTime: { get: () => r.dayTime, enumerable: true },
      day:     { get: () => r.day,     enumerable: true },
      _treeId: { get: () => r._treeId, set: v => { r._treeId = v; }, enumerable: true },
    });
  }

  notify(msg, type = 'info') {
    this.pendingEvents.push({ type: 'notify', msg, notifyType: type });
  }
}
