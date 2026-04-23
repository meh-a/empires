// ── server/game/GameRoom.js ──
import { MAP_W, MAP_H, DAY_LENGTH, TC_HP_MAX, SEASON_LENGTH, SEASON_NAMES } from './constants.js';
import { register as acRegister, login as acLogin, purchaseSlot as acPurchase, addGold as acAddGold } from './accounts.js';
import { generate, generateTrees, preGenerateKingdomSites, WALKABLE_TILES } from './world.js';
import { rebuildNavBlocked, placeBuilding, upgradeBuilding } from './buildings.js';
import {
  initKingdom, updateVillagers, updateRegrowth,
  updateSpawning, updateGold, updateFeeding,
  moveVillagerTo, upgradeBasicTo,
} from './villager-ai.js';
import { updateCombat, updateBotKingdoms, initBotKingdoms } from './combat.js';
import { updateNPCs, updateBandits, handleNPCAction } from './npcs.js';
import { Kingdom } from './Kingdom.js';

const FOG_RADIUS         = 9;
const EXPLORER_FOG_RADIUS = 16;

export class GameRoom {
  constructor(id) {
    this.id   = id;
    this.seed = Math.floor(Math.random() * 1_000_000);

    // ── Shared world state ────────────────────────
    this.mapTiles     = [];
    this.mapHeight    = [];
    this.mapVariant   = [];
    this.mapMoisture  = [];
    this.mapFertility = [];
    this.trees           = [];
    this._treeId         = 0;
    this.resourceNodes   = [];
    this.regrowthQueue   = [];
    this.enemyKingdomSites = [];

    // ── Shared time ───────────────────────────────
    this.dayTime = 0.3;
    this.day     = 1;

    // ── Bot kingdoms (shared enemies for all players) ──
    this.botKingdoms    = [];
    this._ekId          = 0;
    this._ekBldId       = -100;
    this._ekVilId       = -200;
    this._nextBotTimer  = 0;
    this._totalBotWaves = 0;
    this._botsInitialised = false;

    // ── Player kingdoms ───────────────────────────
    this.kingdoms   = [];   // active Kingdom objects
    this._kidCounter = 0;

    // ── WebSocket clients ──────────────────────────
    this.clients = new Set();

    // ── Tick state ────────────────────────────────
    this._tickInterval = null;
    this._lastTick     = Date.now();
  }

  // ── Lifecycle ────────────────────────────────────
  async init() {
    console.log(`[room ${this.id}] generating world (seed ${this.seed})…`);
    await generate(this, this.seed, pct => {
      this._broadcastRaw(JSON.stringify({ type: 'loading', pct }));
    });
    generateTrees(this);
    preGenerateKingdomSites(this);
    console.log(`[room ${this.id}] world ready`);
    this._broadcastRaw(JSON.stringify({ type: 'ready', seed: this.seed }));
  }

  // Load from a save — regenerates terrain arrays from seed, then overlays saved state.
  async initFromSave(saveData, restoreRoom) {
    console.log(`[room ${this.id}] loading saved world (seed ${saveData.seed}, day ${saveData.day})…`);
    this.seed = saveData.seed;
    await generate(this, this.seed, () => {}); // silent — no clients yet
    restoreRoom(this, saveData);
    console.log(`[room ${this.id}] world restored (${this.kingdoms.length} kingdoms)`);
  }

  start() {
    this._lastTick = Date.now();
    this._tickInterval = setInterval(() => this._tick(), 100); // 10 Hz
  }

  stop() {
    if (this._tickInterval) { clearInterval(this._tickInterval); this._tickInterval = null; }
  }

  // ── Add a player kingdom when a client connects ───
  addPlayer(ws, playerName, isNewPlayer = false) {
    const name = (playerName || '').trim() || `Player ${this._kidCounter + 1}`;
    const now  = Date.now();

    // Restore a disconnected kingdom — match by name (account username matched later via WS login)
    const existing = this.kingdoms.find(k => k.ws === null && k.name === name);
    if (existing) {
      existing.ws = ws;
      existing._disconnectedAt  = null;
      existing._gracefulOffline = false;
      console.log(`[room ${this.id}] kingdom ${existing.id} (${existing.name}) reconnected`);
      return existing;
    }

    const kingdom = new Kingdom(this, this._kidCounter++);
    kingdom.ws = ws;
    kingdom.name = name;

    const cx = this._pickSpawnPoint();
    initKingdom(kingdom, cx.x, cx.y);

    if (isNewPlayer) {
      kingdom.wood += 5;
    }

    const currentSeason = Math.floor((this.day - 1) / SEASON_LENGTH) % 4;
    if (currentSeason === 3) {
      kingdom.food += 50;
      kingdom.pendingEvents.push({ type: 'notify', msg: 'You arrived in winter. You\'ve been given extra food stores to survive.', notifyType: 'info' });
    }

    this.kingdoms.push(kingdom);
    console.log(`[room ${this.id}] kingdom ${kingdom.id} (${kingdom.name}) spawned at ${cx.x},${cx.y}`);
    return kingdom;
  }

  removePlayer(ws) {
    const k = this.kingdoms.find(k => k.ws === ws);
    if (k) { k.ws = null; k._disconnectedAt = Date.now(); }
  }

  _pickSpawnPoint() {
    const existing = [
      ...this.kingdoms.filter(k => k.townCenter).map(k => ({ tx: k.townCenter.tx, ty: k.townCenter.ty })),
      ...this.botKingdoms.map(ek => ({ tx: ek.tx, ty: ek.ty })),
    ];
    for (let attempt = 0; attempt < 300; attempt++) {
      const x = 10 + Math.floor(Math.random() * (MAP_W - 20));
      const y = 10 + Math.floor(Math.random() * (MAP_H - 20));
      if (!this.mapTiles[y]?.[x]) continue;
      if (!WALKABLE_TILES.has(this.mapTiles[y][x])) continue;
      if (existing.some(p => Math.hypot(p.tx - x, p.ty - y) < 50)) continue;
      return { x, y };
    }
    // Fallback: quadrant based on kingdom count
    const q = this.kingdoms.length % 4;
    return {
      x: (q % 2 === 0 ? MAP_W * 0.25 : MAP_W * 0.75) | 0,
      y: (q < 2       ? MAP_H * 0.25 : MAP_H * 0.75) | 0,
    };
  }

  // ── Place town center for a kingdom ──────────────
  placeTownCenter(kingdom, tx, ty) {
    if (kingdom.settled || kingdom.townCenter) return false;
    kingdom.townCenter = { tx, ty, hp: TC_HP_MAX, maxHp: TC_HP_MAX };
    kingdom.settled    = true;

    // Initialise shared bots the first time anyone settles
    if (!this._botsInitialised) {
      this._botsInitialised = true;
      initBotKingdoms(this);
    }
    return true;
  }

  // ── Notify all kingdoms ───────────────────────────
  notifyAll(msg, type = 'info') {
    for (const k of this.kingdoms) k.notify(msg, type);
  }

  // ── Main tick ─────────────────────────────────────
  _tick() {
    try {
      this._tickInner();
    } catch (e) {
      console.error('[tick] unhandled error:', e);
    }
  }

  _tickInner() {
    const now = Date.now();
    const dt  = Math.min((now - this._lastTick) / 1000, 0.1);
    this._lastTick = now;

    this._elapsed = (this._elapsed || 0) + dt;
    // Drop ungraceful disconnects after 3 minutes; graceful offline kingdoms persist
    this.kingdoms = this.kingdoms.filter(k =>
      k.ws !== null ||
      k._gracefulOffline ||
      (k._disconnectedAt !== null && now - k._disconnectedAt < 3 * 60 * 1000)
    );

    if (!this.kingdoms.length) return;

    // Shared day/night
    const prevDayTime = this.dayTime;
    this.dayTime = (this.dayTime + dt / DAY_LENGTH) % 1;
    if (prevDayTime > 0.9 && this.dayTime < 0.1) {
      this.day++;
      this.notifyAll(`Day ${this.day}`);
      const newSeason  = Math.floor((this.day - 1) / SEASON_LENGTH) % 4;
      const prevSeason = Math.floor((this.day - 2) / SEASON_LENGTH) % 4;
      if (newSeason !== prevSeason) {
        const msgs = [
          `${SEASON_NAMES[newSeason]} has arrived. Crops grow quickly — build up your stores.`,
          `${SEASON_NAMES[newSeason]} is here. Fields are thriving.`,
          `${SEASON_NAMES[newSeason]} brings cooler days. Harvest what you can.`,
          `${SEASON_NAMES[newSeason]} has come. Fields lie barren — live off your stores.`,
        ];
        this.notifyAll(msgs[newSeason], 'info');
      }
    }

    // World regrowth (once per tick, shared)
    updateRegrowth(this, dt);

    // Rebuild nav for all kingdoms each tick (trees are shared)
    for (const k of this.kingdoms) rebuildNavBlocked(k);

    // Build each kingdom's enemy view (bots + other player kingdoms)
    for (const k of this.kingdoms) {
      k.enemyKingdoms = [
        ...this.botKingdoms,
        ...this.kingdoms
          .filter(other => other !== k && other.settled)
          .map(other => _playerKingdomEnemyView(other)),
      ];
    }

    // Snapshot tree IDs before simulation to detect chopped trees
    const prevTreeIds = new Set(this.trees.map(t => t.id));

    // Per-kingdom simulation
    for (const k of this.kingdoms) {
      if (k.gameState !== 'playing') continue;
      updateVillagers(k, dt);
      updateSpawning(k, dt);
      updateGold(k, dt);
      updateFeeding(k, dt);
      updateCombat(this, k, dt);
      updateNPCs(k, dt);
      updateBandits(k, dt);
      this._updateFog(k); // needed for server-side fog checks (combat targeting, outpost placement)
    }

    // Shared bot management
    updateBotKingdoms(this, dt);

    // Notify all kingdoms of any trees that were chopped this tick
    for (const id of prevTreeIds) {
      if (!this.trees.some(t => t.id === id)) {
        for (const k of this.kingdoms) k._removedTreeIds.push(id);
      }
    }

    this._broadcast();
  }

  // ── Per-kingdom fog of war ─────────────────────────
  _updateFog(kingdom) {
    kingdom.fogVisible.fill(0);
    for (const v of kingdom.villagers) {
      const r  = v.role === 'Explorer' ? EXPLORER_FOG_RADIUS : FOG_RADIUS;
      const tx = Math.floor(v.x), ty = Math.floor(v.y);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx*dx + dy*dy > r*r) continue;
          const nx = tx+dx, ny = ty+dy;
          if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
          const ni = ny*MAP_W+nx;
          kingdom.fogVisible[ni]  = 1;
          kingdom.fogExplored[ni] = 1;
        }
      }
    }
    if (kingdom.townCenter) {
      const { tx, ty } = kingdom.townCenter;
      const r = 5;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = tx+dx, ny = ty+dy;
          if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
          const ni = ny*MAP_W+nx;
          kingdom.fogVisible[ni]  = 1;
          kingdom.fogExplored[ni] = 1;
        }
      }
    }
  }

  // ── Client message handler ────────────────────────
  handleMessage(ws, msg) {
    const kingdom = this.kingdoms.find(k => k.ws === ws);
    if (!kingdom) return;
    try {
      const data = JSON.parse(Buffer.from(msg));
      switch (data.type) {
        case 'place_town_center':
          this.placeTownCenter(kingdom, data.tx, data.ty);
          break;
        case 'place_building':
          placeBuilding(kingdom, data.tx, data.ty, data.buildingType);
          break;
        case 'npc_action':
          handleNPCAction(kingdom, data.npcId, data.action, data.offerIndex);
          break;
        case 'move_villager': {
          const mv = kingdom.villagers.find(v => v.id === data.villagerId);
          if (mv) moveVillagerTo(kingdom, mv, data.tx, data.ty);
          break;
        }
        case 'upgrade_building': {
          upgradeBuilding(kingdom, data.buildingId);
          break;
        }
        case 'account_register':
        case 'account_login': {
          const fn = data.type === 'account_register' ? acRegister : acLogin;
          const result = fn(data.username, data.password);
          if (result.error) {
            kingdom.ws.send(JSON.stringify({ type: 'account_error', msg: result.error }));
          } else {
            kingdom._accountUsername = data.username;
            kingdom.tier4Slots = result.tier4Slots;
            kingdom.tier5Slots = result.tier5Slots;
            kingdom.ws.send(JSON.stringify({ type: 'account_data', username: data.username, ...result }));
          }
          break;
        }
        case 'account_purchase': {
          if (!kingdom._accountUsername) break;
          const result = acPurchase(kingdom._accountUsername, data.tier);
          if (result.error) {
            kingdom.ws.send(JSON.stringify({ type: 'account_error', msg: result.error }));
          } else {
            kingdom.tier4Slots = result.tier4Slots;
            kingdom.tier5Slots = result.tier5Slots;
            kingdom.ws.send(JSON.stringify({ type: 'account_data', username: kingdom._accountUsername, ...result }));
          }
          break;
        }
        case 'account_save_gold': {
          if (!kingdom._accountUsername) break;
          const saved = acAddGold(kingdom._accountUsername, kingdom.gold);
          kingdom.ws.send(JSON.stringify({ type: 'account_saved', newBalance: saved }));
          break;
        }
        case 'go_offline': {
          kingdom._gracefulOffline = true;
          console.log(`[room ${this.id}] kingdom ${kingdom.id} (${kingdom.name}) went offline gracefully`);
          break;
        }
        case 'account_logout': {
          kingdom._accountUsername = null;
          kingdom.tier4Slots = 0;
          kingdom.tier5Slots = 0;
          break;
        }
        case 'upgrade_villager': {
          const uv = kingdom.villagers.find(v => v.id === data.villagerId);
          if (uv && uv.role === 'Basic') upgradeBasicTo(kingdom, uv, data.role);
          break;
        }
        case 'chat': {
          const text = (data.text || '').toString().trim().slice(0, 120);
          if (!text) break;
          const sender = kingdom.name;
          for (const k of this.kingdoms) {
            if (k === kingdom) continue; // sender sees their own message via local echo
            k.pendingEvents.push({ type: 'chat', name: sender, text });
          }
          break;
        }
        case 'quest_reward': {
          const qid = data.questId;
          if (!qid || kingdom.claimedQuests.has(qid)) break;
          kingdom.claimedQuests.add(qid);
          const CAPS = { gold:500, wood:200, stone:200, iron:10, food:100, crops:100 };
          const reward = data.reward;
          if (reward && typeof reward === 'object') {
            for (const [res, amt] of Object.entries(reward)) {
              if (CAPS[res] && typeof amt === 'number' && amt > 0) {
                kingdom[res] = (kingdom[res] || 0) + Math.min(amt, CAPS[res]);
              }
            }
          }
          break;
        }
      }
    } catch (e) {
      console.error(`[room ${this.id}] bad message:`, e.message);
    }
  }

  // ── Broadcast per-kingdom state to each ws ────────
  _broadcast() {
    for (const k of this.kingdoms) {
      if (!k.ws) continue;
      try {
        k.ws.send(JSON.stringify(this._serializeKingdom(k)));
      } catch (_) {}
    }
  }

  _broadcastRaw(str) {
    for (const ws of this.clients) {
      try { ws.send(str); } catch (_) {}
    }
  }

  _serializeKingdom(k) {
    const tileChanges = k._tileChanges.splice(0);
    return {
      type: 'state',
      tick: this._lastTick,
      // Economy
      gold: k.gold, wood: k.wood, food: k.food,
      crops: k.crops, stone: k.stone, iron: k.iron,
      toolStock: k.toolStock,
      // World
      dayTime: this.dayTime, day: this.day,
      season: Math.floor((this.day - 1) / SEASON_LENGTH) % 4,
      settled:    k.settled,
      townCenter: k.townCenter,
      gameState:  k.gameState,
      alertMode:  k.alertMode,
      tier4Slots: k.tier4Slots, tier5Slots: k.tier5Slots,
      // Entities
      villagers:      k.villagers.map(_stripVillager),
      buildings:      k.buildings,
      removedTreeIds: k._removedTreeIds.splice(0),
      enemyKingdoms:  k.enemyKingdoms.map(_stripEK),
      enemyUnits:    k.enemyUnits,
      projectiles:   k.projectiles,
      npcs:          k.npcs.map(_stripNPC),
      bandits:       k.bandits,
      // Map
      tileChanges: tileChanges.length ? tileChanges : undefined,
      roadTiles:   [...k.roadTiles],
      // Quests
      claimedQuests: [...k.claimedQuests],
      // Events
      events: k.pendingEvents.splice(0),
    };
  }
}

// ── Build a read-only "enemy view" of another player kingdom ─────────
function _playerKingdomEnemyView(other) {
  return {
    id:    other.id,
    name:  other.name,
    tx:    other.townCenter?.tx ?? -1,
    ty:    other.townCenter?.ty ?? -1,
    hp:    other.townCenter?.hp    ?? 0,
    maxHp: other.townCenter?.maxHp ?? TC_HP_MAX,
    buildings: other.buildings,
    villagers: other.villagers,
    raidTimer: 0, raidInterval: Infinity,
    difficulty: 0,
    isPlayer: true,
    _playerKingdom: other,  // back-reference for PvP damage routing
  };
}

// ── Serialization helpers ─────────────────────────────────────────────
function _stripVillager(v) {
  return {
    id: v.id, role: v.role, name: v.name,
    x: v.x, y: v.y, tx: v.tx, ty: v.ty,
    state: v.state,
    hunger: v.hunger, tired: v.tired,
    hp: v.hp, maxHp: v.maxHp,
    tier: v.tier, xp: v.xp, toolTier: v.toolTier,
    attackAnim: v.attackAnim, _hitFlash: v._hitFlash,
    _goingSleep: v._goingSleep,
    buildTarget:    v.buildTarget,
    chopTarget:     v.chopTarget ? { id: v.chopTarget.id, tx: v.chopTarget.tx, ty: v.chopTarget.ty } : null,
    upgradeTimer:   v.upgradeTimer,
    _trainingRole:  v._trainingRole,
    _trainingTimer: v._trainingTimer,
    pathLen:        v.path ? v.path.length : 0,
    dest:           v.path?.length ? v.path[v.path.length - 1] : null,
  };
}

function _stripEK(ek) {
  return {
    id: ek.id, name: ek.name,
    tx: ek.tx, ty: ek.ty,
    hp:    ek._playerKingdom ? (ek._playerKingdom.townCenter?.hp    ?? 0) : ek.hp,
    maxHp: ek._playerKingdom ? (ek._playerKingdom.townCenter?.maxHp ?? TC_HP_MAX) : ek.maxHp,
    buildings: ek.buildings,
    villagers: _stripEKVillagers([
      ...(ek.villagers || []),
      ...(ek.guards  || []).filter(g => !g._despawn),
      ...(ek.scouts  || []).filter(s => !s._despawn),
    ]),
    isPlayer: !!ek.isPlayer,
  };
}

function _stripEKVillagers(villagers) {
  return (villagers || []).map(v => ({
    id: v.id, role: v.role,
    x: v.x, y: v.y, tx: v.tx ?? Math.floor(v.x), ty: v.ty ?? Math.floor(v.y),
    state: v.state || 'idle',
    hp: v.hp ?? 10, maxHp: v.maxHp ?? 10,
    attackAnim: v.attackAnim || 0,
    _hitFlash:  v._hitFlash  || 0,
  }));
}

function _stripNPC(npc) {
  return {
    id: npc.id, type: npc.type, name: npc.name,
    x: npc.x, y: npc.y, state: npc.state,
    waitTimer: npc.waitTimer,
    offers: npc.offers,
    strength: npc.strength,
    caravan: npc.caravan || false,
    path: npc.path ? npc.path.slice(0, 2) : [],
  };
}

function _rleEncode(arr) {
  const out = [];
  let cur = arr[0], count = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur) { count++; }
    else { out.push(cur, count); cur = arr[i]; count = 1; }
  }
  out.push(cur, count);
  return out;
}
