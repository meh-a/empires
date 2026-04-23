// ── server/game/combat.js ──
import {
  MAP_W, MAP_H, VROLE,
  BLDG_HP_MAX, TC_HP_MAX, UNIT_HP_MAX,
  KNIGHT_ATK_DMG, KNIGHT_ATK_RANGE, KNIGHT_ATK_SPD,
  ARCHER_ATK_DMG, ARCHER_ATK_RANGE, ARCHER_ATK_SPD,
  ENEMY_INF_HP, ENEMY_ARC_HP, ENEMY_INF_DMG, ENEMY_ARC_DMG,
  ENEMY_MELEE_RNG, ENEMY_ARC_RNG, ENEMY_ATK_SPD, ENEMY_SPEED,
  WAVE_TC_HP, WAVE_RAID_INT, WAVE_RAID_MIN, WAVE_RAID_MAX,
  WAVE_NAMES, NEXT_WAVE_DELAY, TIER_SPEED,
} from './constants.js';
import { STRUCT_NAME } from './sprites.js';
import { WALKABLE_TILES, findPath } from './world.js';
import { getTerritoryRadius, rebuildNavBlocked, updateNeighborBonuses } from './buildings.js';
import { NPC_TERRITORY_REQ } from './constants.js';

// ═══════════════════════════════════════════════════
//  FACTORIES
// ═══════════════════════════════════════════════════
export function mkEnemyUnit(room, role, tx, ty) {
  const hp = role==='archer' ? ENEMY_ARC_HP : ENEMY_INF_HP;
  return {
    id: room._eid++, role, team:'enemy',
    x: tx+0.5, y: ty+0.5, tx, ty,
    path: [],
    state: 'marching',
    hp, maxHp: hp,
    attackTarget: null,
    attackTimer: 0,
    attackAnim: 0,
    _hitFlash: 0,
    _despawn: false,
  };
}

// ── Guard / defender constants ───────────────────────
const GUARD_DETECT_RADIUS = 14;   // tiles from bot TC to trigger guards
const GUARD_PATROL_RADIUS = 3;    // tiles from home position during patrol
const GUARD_SPEED         = 2.2;  // tiles/sec when chasing
const GUARD_ATK_SPD       = 1.5;  // seconds per attack
const GUARD_INF_DMG       = 8;
const GUARD_ARC_DMG       = 5;
const GUARD_MELEE_RNG     = 1.4;
const GUARD_ARCHER_RNG    = 5.5;
const GUARD_RESPAWN_TIME  = 50;   // seconds per dead guard respawn

// ═══════════════════════════════════════════════════
//  KINGDOM INIT
// ═══════════════════════════════════════════════════
function _compassDir(fromTx, fromTy, toTx, toTy) {
  const dx = toTx - fromTx, dy = toTy - fromTy;
  const a = Math.atan2(dy, dx) * 180 / Math.PI;
  const dirs = ['East','Southeast','South','Southwest','West','Northwest','North','Northeast'];
  return dirs[Math.round((a + 360 + 22.5) / 45) % 8];
}

// Tiny seeded RNG scoped to each village so layouts are deterministic
function _makeRng(ek) {
  let s = ((ek.tx * 1619) ^ (ek.ty * 31337) ^ (ek.id * 7919)) >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    s = Math.imul(s ^ (s >>> 16), 0xac4dbbed) >>> 0;
    return (s >>> 0) / 0x100000000;
  };
}

export function generateEnemyVillage(room, ek) {
  if (!ek) return;
  ek.buildings = [];
  ek.villagers = [];
  ek.guards    = [];
  ek._guardRespawnTimer = 0;

  const cx = ek.tx, cy = ek.ty;
  const rng = _makeRng(ek);
  const placedTiles = new Set();

  // Returns true and records the placement if all tiles are valid and empty
  function tryPlace(type, tx, ty) {
    if (tx < 1 || tx >= MAP_W-1 || ty < 1 || ty >= MAP_H-1) return false;
    const tile = room.mapTiles[ty]?.[tx];
    if (!tile || !WALKABLE_TILES.has(tile)) return false;
    // Farmland needs grass (3), mine needs hill (5)
    if (type === 4 && tile !== 3) return false;
    if (type === 5 && tile !== 5) return false;
    const key = ty * MAP_W + tx;
    if (placedTiles.has(key)) return false;
    placedTiles.add(key);
    const maxHp = BLDG_HP_MAX[type] || 50;
    ek.buildings.push({ id: room._ekBldId--, type, tx, ty, w:1, h:1, hp: maxHp, maxHp, complete: true });
    return true;
  }

  // Try to place a building at a random angle and radius from TC
  function tryPlaceRing(type, minR, maxR, attempts = 14) {
    for (let i = 0; i < attempts; i++) {
      const angle = rng() * Math.PI * 2;
      const r = minR + rng() * (maxR - minR);
      const tx = Math.round(cx + Math.cos(angle) * r);
      const ty = Math.round(cy + Math.sin(angle) * r);
      if (tryPlace(type, tx, ty)) return true;
    }
    return false;
  }

  // Houses — inner ring
  for (let i = 0; i < 5; i++) tryPlaceRing(0, 2, 4);
  // Bakery
  tryPlaceRing(1, 2, 4);
  // Farmland — outer ring, grass only
  for (let i = 0; i < 4; i++) tryPlaceRing(4, 4, 8, 20);
  // Mine — outer ring, hill only
  for (let i = 0; i < 2; i++) tryPlaceRing(5, 5, 10, 20);
  // Barracks
  tryPlaceRing(6, 3, 6);
  // Forge
  tryPlaceRing(7, 3, 5);
  // Walls — partial ring at fixed radius, varying start angle
  const wallStart = rng() * Math.PI * 2;
  const wallCount = 6 + Math.floor(rng() * 4); // 6–9 wall segments
  for (let i = 0; i < wallCount; i++) {
    const angle = wallStart + (i / wallCount) * Math.PI * 2;
    const tx = Math.round(cx + Math.cos(angle) * 3.8);
    const ty = Math.round(cy + Math.sin(angle) * 3.8);
    tryPlace(2, tx, ty);
  }
  // Towers at two corners of the wall ring
  for (let i = 0; i < 2; i++) {
    const angle = wallStart + (i / 2) * Math.PI * 2;
    const tx = Math.round(cx + Math.cos(angle) * 4.5);
    const ty = Math.round(cy + Math.sin(angle) * 4.5);
    tryPlace(3, tx, ty);
  }

  // Civilian villagers
  const vRoles = ['Woodcutter','Farmer','Builder','Baker','Basic'];
  for (let i = 0; i < vRoles.length; i++) {
    const angle = (i / vRoles.length) * Math.PI * 2 + rng() * 0.8;
    const r = 3 + rng() * 3;
    const tx = Math.round(cx + Math.cos(angle) * r);
    const ty = Math.round(cy + Math.sin(angle) * r);
    if (tx<1||tx>=MAP_W-1||ty<1||ty>=MAP_H-1) continue;
    if (!WALKABLE_TILES.has(room.mapTiles[ty]?.[tx])) continue;
    ek.villagers.push({
      id: room._ekVilId--, role: vRoles[i],
      x: tx+0.5, y: ty+0.5, tx, ty,
      state: 'idle', idleTimer: rng()*4,
      targetX: tx+0.5, targetY: ty+0.5,
      path: [], hp: 10, maxHp: 10,
    });
  }

  // Guards — scale with difficulty
  const guardCount = 2 + Math.min(Math.floor(ek.difficulty * 0.6), 4);
  for (let i = 0; i < guardCount; i++) {
    const isArcher = i === guardCount - 1 && guardCount >= 4;
    const role = isArcher ? 'Archer' : 'Knight';
    const homeAngle = (i / guardCount) * Math.PI * 2;
    const tx = cx + Math.round(Math.cos(homeAngle) * 2);
    const ty = cy + Math.round(Math.sin(homeAngle) * 2);
    const hp = isArcher ? 22 : 55;
    ek.guards.push({
      id: room._ekVilId--, role,
      x: tx + 0.5, y: ty + 0.5, tx, ty,
      hp, maxHp: hp,
      homeAngle,
      state: 'patrol',
      attackTimer: 0, attackAnim: 0, _hitFlash: 0,
      _despawn: false, path: [],
    });
  }
}

// Spawn a unit at the bot keep with a path toward the target kingdom's TC
function _spawnAtKeep(room, targetKingdom, ek, role) {
  if (!ek || !targetKingdom.townCenter) return null;
  const tc = targetKingdom.townCenter;
  for (let a = 0; a < 25; a++) {
    const tx = ek.tx + Math.round(Math.random()*5-2.5);
    const ty = ek.ty + Math.round(Math.random()*5-2.5);
    if (tx<1||tx>=MAP_W-1||ty<1||ty>=MAP_H-1) continue;
    if (!WALKABLE_TILES.has(room.mapTiles[ty][tx])) continue;
    const eu = mkEnemyUnit(targetKingdom, role, tx, ty);
    const path = findPath(tx, ty, tc.tx, tc.ty, targetKingdom.navBlocked, room);
    if (!path || path.length < 2) continue;
    eu.path = path.slice(1);
    return eu;
  }
  return null;
}

// Spawn a new bot kingdom on the shared room. cx/cy is a reference centre for
// placement — defaults to map centre when not provided.
export function _spawnKingdom(room, difficulty, preferredAngle, initialRaidDelay, cx, cy) {
  cx = cx ?? MAP_W / 2;
  cy = cy ?? MAP_H / 2;
  const wi = Math.min(difficulty - 1, WAVE_TC_HP.length - 1);

  let site = null;
  if (room.enemyKingdomSites.length > 0) {
    if (preferredAngle !== undefined) {
      let bestDiff = Infinity, bestIdx = 0;
      for (let i = 0; i < room.enemyKingdomSites.length; i++) {
        const s = room.enemyKingdomSites[i];
        let diff = Math.abs(Math.atan2(s.ty-cy, s.tx-cx) - preferredAngle);
        if (diff > Math.PI) diff = Math.PI*2 - diff;
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      }
      [site] = room.enemyKingdomSites.splice(bestIdx, 1);
    } else {
      [site] = room.enemyKingdomSites.splice(0, 1);
    }
    if (room.botKingdoms.some(ek => Math.hypot(site.tx-ek.tx, site.ty-ek.ty) < 30)) site = null;
  }

  if (!site) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const nx = 5 + Math.floor(Math.random()*(MAP_W-10));
      const ny = 5 + Math.floor(Math.random()*(MAP_H-10));
      if (!WALKABLE_TILES.has(room.mapTiles[ny][nx])) continue;
      if (Math.hypot(nx-cx, ny-cy) < 45) continue;
      if (room.botKingdoms.some(ek => Math.hypot(nx-ek.tx, ny-ek.ty) < 30)) continue;
      site = { tx: nx, ty: ny }; break;
    }
  }

  if (!site) return;
  const ek = {
    id: room._ekId++, difficulty,
    tx: site.tx, ty: site.ty,
    hp: WAVE_TC_HP[wi], maxHp: WAVE_TC_HP[wi],
    raidTimer: initialRaidDelay !== undefined ? initialRaidDelay : 60,
    raidInterval: WAVE_RAID_INT[wi],
    name: WAVE_NAMES[(room._ekId-1) % WAVE_NAMES.length],
    buildings: [], villagers: [],
    scouts: [],
    _scoutTimer: 10 + Math.random() * 20, // 10–30 s after bots init
  };
  room.botKingdoms.push(ek);
  generateEnemyVillage(room, ek);
  room.notifyAll(`A new enemy kingdom rises — ${ek.name}!`, 'warn');
}

// Initialise shared bot kingdoms. Call this once when the first player settles.
export function initBotKingdoms(room) {
  room.botKingdoms      = [];
  room._ekId            = 0;
  room._ekBldId         = -100;
  room._ekVilId         = -200;
  room._nextBotTimer    = 0;
  room._totalBotWaves   = 0;

  // Use average position of settled kingdoms as spawn reference
  const settled = room.kingdoms.filter(k => k.settled && k.townCenter);
  const cx = settled.length ? settled.reduce((s,k)=>s+k.townCenter.tx,0)/settled.length : MAP_W/2;
  const cy = settled.length ? settled.reduce((s,k)=>s+k.townCenter.ty,0)/settled.length : MAP_H/2;

  const INITIAL_COUNT = 3;
  const startAngle = Math.random() * Math.PI * 2;
  for (let i = 0; i < INITIAL_COUNT; i++) {
    room._totalBotWaves++;
    const angle = startAngle + (i / INITIAL_COUNT) * Math.PI * 2;
    _spawnKingdom(room, 1, angle, 90 + i * 90, cx, cy);
  }
}

// Legacy single-kingdom entry point kept for compatibility
export function initEnemyKingdom(room) {
  initBotKingdoms(room);
}

// ═══════════════════════════════════════════════════
//  RAIDS
// ═══════════════════════════════════════════════════
// Launch a bot raid against a specific player kingdom.
export function launchRaid(room, targetKingdom, ek) {
  if (!ek || !targetKingdom.townCenter) return;
  const tc = targetKingdom.townCenter;
  const wi = Math.min(ek.difficulty-1, WAVE_RAID_MIN.length-1);
  const terr   = getTerritoryRadius(targetKingdom);
  const excess = Math.max(0, terr - NPC_TERRITORY_REQ);
  const timeScale = 1 + Math.floor((room._elapsed || 0) / 300) * 0.4; // +40% every 5 min
  const baseSize = WAVE_RAID_MIN[wi] + Math.floor(excess / 4);
  const size = Math.min(WAVE_RAID_MAX[wi], Math.ceil(baseSize * timeScale));

  const marchPath = findPath(ek.tx, ek.ty, tc.tx, tc.ty, targetKingdom.navBlocked, room);
  if (!marchPath || marchPath.length < 2) return;

  let archers = 0;
  for (let i = 0; i < size; i++) {
    const isArcher = size >= 5 && archers < Math.floor(size/3) && Math.random() < 0.35;
    const role = isArcher ? 'archer' : 'infantry';
    if (isArcher) archers++;
    let stx = ek.tx, sty = ek.ty;
    for (let a = 0; a < 15; a++) {
      const nx = ek.tx + Math.round(Math.random()*6-3);
      const ny = ek.ty + Math.round(Math.random()*6-3);
      if (nx<1||nx>=MAP_W-1||ny<1||ny>=MAP_H-1) continue;
      if (WALKABLE_TILES.has(room.mapTiles[ny][nx])) { stx=nx; sty=ny; break; }
    }
    const eu = mkEnemyUnit(targetKingdom, role, stx, sty);
    eu.path = marchPath.slice(1).map(p => ({ x: p.x, y: p.y }));
    targetKingdom.enemyUnits.push(eu);
  }

  const dir = _compassDir(tc.tx, tc.ty, ek.tx, ek.ty);
  targetKingdom.notify(`${ek.name} raids from the ${dir}! (${size} warriors)`, 'warn');
}

// ═══════════════════════════════════════════════════
//  DAMAGE HELPERS
// ═══════════════════════════════════════════════════
function _dmgVillager(room, v, dmg) {
  v.hp = Math.max(0, v.hp - dmg);
  v._hitFlash = 1.0;
  if (room.pendingEvents) room.pendingEvents.push({ type: 'hit', wx: v.x, wy: v.y, dmg, color: '#ff4444' });
  if (v.hp <= 0) {
    v._despawn = true;
    room.pendingEvents.push({ type: 'unit_killed', wx: v.x, wy: v.y, color: '#8866aa' });
  }
}

function _dmgBuilding(room, b, dmg) {
  if (!b.complete) return;
  b.hp = Math.max(0, b.hp - dmg);
  if (room.pendingEvents) room.pendingEvents.push({ type: 'hit', wx: b.tx+0.5, wy: b.ty+0.5, dmg, color: '#ff4444' });
  if (b.hp <= 0) {
    const btx=b.tx, bty=b.ty;
    room.buildings = room.buildings.filter(x=>x.id!==b.id);
    for (const v of room.villagers) {
      if (v._seekBakery === b.id) v._seekBakery = null;
      if (v._seekForge?.id === b.id) { room.toolStock[v._seekForge.tier]++; v._seekForge = null; }
    }
    rebuildNavBlocked(room);
    updateNeighborBonuses(room, btx, bty);
    room.notify(`${STRUCT_NAME[b.type]} destroyed!`, 'warn');
  }
}

function _dmgEnemyBuilding(room, ek, b, dmg) {
  b.hp = Math.max(0, b.hp - dmg);
  if (room.pendingEvents) room.pendingEvents.push({ type: 'hit', wx: b.tx+0.5, wy: b.ty+0.5, dmg, color: '#ffdd44' });
  if (b.hp <= 0 && ek) {
    ek.buildings = ek.buildings.filter(x => x.id !== b.id);
    room.notify('Enemy building destroyed!', 'warn');
  }
}

function _dmgEnemyUnit(room, eu, dmg) {
  eu.hp = Math.max(0, eu.hp - dmg);
  eu._hitFlash = 1.0;
  if (room.pendingEvents) room.pendingEvents.push({ type: 'hit', wx: eu.x, wy: eu.y, dmg, color: '#ffdd44' });
  if (eu.hp <= 0) {
    eu._despawn = true;
    const loot = 2 + Math.floor(Math.random() * 4);
    room.gold += loot;
    room.pendingEvents.push({ type: 'loot_drop', wx: eu.x, wy: eu.y, amount: loot });
    room.pendingEvents.push({ type: 'unit_killed', wx: eu.x, wy: eu.y, color: '#c04020' });
  }
}

// Check if only one player remains — award victory
function _checkVictory(room) {
  if (!room || !room.kingdoms) return;
  const playing  = room.kingdoms.filter(k => k.settled && k.gameState === 'playing');
  const defeated = room.kingdoms.filter(k => k.settled && k.gameState === 'defeat');
  if (playing.length === 1 && defeated.length > 0) {
    const winner = playing[0];
    winner.pendingEvents.push({ type: 'victory' });
    winner.notify('Victory! You are the last kingdom standing!', 'warn');
    for (const k of defeated) {
      k.notify(`${winner.name} has won the war.`, 'warn');
    }
  }
}

// kingdom = the attacking player kingdom; ek = enemy kingdom entry (bot or player view)
function _dmgEnemyKingdom(kingdom, ek, dmg) {
  if (!ek) return;

  // PvP — damage another player's town center directly
  if (ek._playerKingdom) {
    const pk = ek._playerKingdom;
    if (!pk.townCenter || pk.gameState !== 'playing') return;
    pk.townCenter.hp = Math.max(0, pk.townCenter.hp - dmg);
    kingdom.pendingEvents.push({ type: 'hit', wx: ek.tx+0.5, wy: ek.ty+0.5, dmg, color: '#ffdd44' });
    if (pk.townCenter.hp <= 0) {
      pk.gameState = 'defeat';
      pk.pendingEvents.push({ type: 'defeat' });
      pk.notify('Your town center has fallen!', 'warn');
      kingdom.notify(`${pk.name} has been defeated!`, 'warn');
      _checkVictory(kingdom._room);
    }
    return;
  }

  // Bot kingdom
  if (ek.hp <= 0) return;
  ek.hp = Math.max(0, ek.hp - dmg);
  kingdom.pendingEvents.push({ type: 'hit', wx: ek.tx+0.5, wy: ek.ty+0.5, dmg, color: '#ffdd44' });
  if (ek.hp <= 0 && kingdom.gameState === 'playing') {
    ek.buildings = []; ek.villagers = [];
    const wi = Math.min(ek.difficulty-1, WAVE_TC_HP.length-1);
    const reward = { gold: 60+wi*40+Math.floor(Math.random()*40), wood: 20+wi*10, stone: 15+wi*8 };
    kingdom.gold  += reward.gold;
    kingdom.wood  += reward.wood;
    kingdom.stone += reward.stone;
    kingdom.notify(`${ek.name} has fallen! +${reward.gold}⚜ +${reward.wood}🪵 +${reward.stone}🪨`, 'warn');
    // Schedule next bot wave at room level
    const room = kingdom._room;
    if (room) { room._totalBotWaves++; room._nextBotTimer = NEXT_WAVE_DELAY; }
  }
}

// kingdom here is actually the target Kingdom (called as _dmgTC(kingdom, dmg))
function _dmgTC(kingdom, dmg) {
  if (!kingdom.townCenter || kingdom.gameState !== 'playing') return;
  kingdom.townCenter.hp = Math.max(0, kingdom.townCenter.hp - dmg);
  kingdom.pendingEvents.push({ type: 'hit', wx: kingdom.townCenter.tx+0.5, wy: kingdom.townCenter.ty+0.5, dmg, color: '#ff4444' });
  if (kingdom.townCenter.hp <= 0) {
    kingdom.gameState = 'defeat';
    kingdom.pendingEvents.push({ type: 'defeat' });
    kingdom.notify('Your town center has fallen!', 'warn');
    _checkVictory(kingdom._room);
  }
}

// ═══════════════════════════════════════════════════
//  PROJECTILES
// ═══════════════════════════════════════════════════
function spawnProjectile(room, fx, fy, tx, ty, type) {
  const dx=tx-fx, dy=ty-fy;
  const dist=Math.sqrt(dx*dx+dy*dy)||1;
  room.projectiles.push({
    id:room._pid++, type,
    x:fx, y:fy,
    vx:dx/dist, vy:dy/dist,
    speed:10,
    life: dist/10 + 0.08,
    _done:false,
  });
}

function updateProjectiles(room, dt) {
  for (const p of room.projectiles) {
    if (p._done) continue;
    p.life -= dt;
    if (p.life <= 0) { p._done=true; continue; }
    p.x += p.vx * p.speed * dt;
    p.y += p.vy * p.speed * dt;
  }
  if (room.projectiles.some(p=>p._done)) room.projectiles = room.projectiles.filter(p=>!p._done);
}

// ═══════════════════════════════════════════════════
//  ENEMY AI
// ═══════════════════════════════════════════════════
function _pickEnemyTarget(room, eu) {
  const range = eu.role==='archer' ? ENEMY_ARC_RNG : ENEMY_MELEE_RNG;
  let best=null, bestDist=range;
  for (const v of room.villagers) {
    const d=Math.hypot(v.x-eu.x, v.y-eu.y);
    if (d<bestDist) { bestDist=d; best={kind:'villager',obj:v}; }
  }
  for (const b of room.buildings) {
    if (!b.complete) continue;
    const d=Math.hypot(b.tx+b.w*0.5-eu.x, b.ty+b.h*0.5-eu.y);
    if (d<bestDist) { bestDist=d; best={kind:'building',obj:b}; }
  }
  if (room.townCenter) {
    const d=Math.hypot(room.townCenter.tx+0.5-eu.x, room.townCenter.ty+0.5-eu.y);
    if (d<bestDist) { bestDist=d; best={kind:'tc'}; }
  }
  return best;
}

function _targetAlive(room, t) {
  if (!t) return false;
  if (t.kind==='villager') return room.villagers.includes(t.obj) && t.obj.hp>0;
  if (t.kind==='building') return room.buildings.includes(t.obj) && t.obj.hp>0;
  if (t.kind==='tc')       return room.townCenter && room.townCenter.hp>0;
  return false;
}

function _inRange(room, eu) {
  if (!eu.attackTarget) return false;
  const range = eu.role==='archer' ? ENEMY_ARC_RNG : ENEMY_MELEE_RNG;
  let tx, ty;
  const t=eu.attackTarget;
  if (t.kind==='villager') { tx=t.obj.x; ty=t.obj.y; }
  else if (t.kind==='building') { tx=t.obj.tx+t.obj.w*0.5; ty=t.obj.ty+t.obj.h*0.5; }
  else if (t.kind==='tc') { tx=room.townCenter.tx+0.5; ty=room.townCenter.ty+0.5; }
  else return false;
  return Math.hypot(tx-eu.x, ty-eu.y) <= range;
}

function _doEnemyHit(kingdom, eu) {
  const dmg = eu.role==='archer' ? ENEMY_ARC_DMG : ENEMY_INF_DMG;
  const t=eu.attackTarget;
  let hx=eu.x, hy=eu.y;
  if (t.kind==='villager') { _dmgVillager(kingdom, t.obj, dmg); hx=t.obj.x; hy=t.obj.y; }
  else if (t.kind==='building') { _dmgBuilding(kingdom, t.obj, dmg); hx=t.obj.tx+0.5; hy=t.obj.ty+0.5; }
  else if (t.kind==='tc') { _dmgTC(kingdom, dmg); hx=kingdom.townCenter.tx+0.5; hy=kingdom.townCenter.ty+0.5; }
  if (eu.role==='archer') spawnProjectile(kingdom, eu.x, eu.y, hx, hy, 'arrow');
}

function updateEnemyAI(kingdom, dt) {
  for (const eu of kingdom.enemyUnits) {
    if (eu._despawn) continue;
    if (!_targetAlive(kingdom, eu.attackTarget)) eu.attackTarget = null;
    if (!eu.attackTarget) eu.attackTarget = _pickEnemyTarget(kingdom, eu);
    if (eu.attackTarget && _inRange(kingdom, eu)) {
      eu.attackTimer += dt;
      if (eu.attackTimer >= ENEMY_ATK_SPD) {
        eu.attackTimer = 0;
        _doEnemyHit(kingdom, eu);
      }
      continue;
    }
    eu.attackTimer = 0;
    if (eu.path.length > 0) {
      const tgt = eu.path[0];
      const wx=tgt.x+0.5, wy=tgt.y+0.5;
      const dx=wx-eu.x, dy=wy-eu.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if (dist <= ENEMY_SPEED*dt+0.01) {
        const _rem = dist < 0.001 ? dt : dt - dist/ENEMY_SPEED;
        eu.x=wx; eu.y=wy; eu.tx=tgt.x; eu.ty=tgt.y;
        eu.path.shift();
        if (eu.path.length > 0 && _rem > 0.001) {
          const n=eu.path[0]; const ndx=n.x+0.5-eu.x, ndy=n.y+0.5-eu.y;
          const nd=Math.sqrt(ndx*ndx+ndy*ndy);
          if (nd>0) { const mv=Math.min(nd,ENEMY_SPEED*_rem); eu.x+=ndx/nd*mv; eu.y+=ndy/nd*mv; }
        }
      } else {
        eu.x+=dx*ENEMY_SPEED*dt/dist;
        eu.y+=dy*ENEMY_SPEED*dt/dist;
      }
    } else {
      if (!eu.attackTarget) eu.attackTarget = {kind:'tc'};
    }
  }

  for (let i=0; i<kingdom.enemyUnits.length; i++) {
    for (let j=i+1; j<kingdom.enemyUnits.length; j++) {
      const a=kingdom.enemyUnits[i], b=kingdom.enemyUnits[j];
      if (a._despawn||b._despawn) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if (dist<1.0&&dist>0.001) {
        const push=(1.0-dist)*0.4;
        const nx=dx/dist, ny=dy/dist;
        a.x-=nx*push; a.y-=ny*push;
        b.x+=nx*push; b.y+=ny*push;
      }
    }
  }
  kingdom.enemyUnits = kingdom.enemyUnits.filter(eu=>!eu._despawn);
}

function updateEnemyVillagers(room, dt) {
  for (const ek of room.enemyKingdoms) {
    for (const ev of ek.villagers) {
      const fi = Math.floor(ev.y)*MAP_W + Math.floor(ev.x);
      if (!room.fogVisible[fi]) continue;
      if (ev.state === 'moving') {
        const dx = ev.targetX - ev.x, dy = ev.targetY - ev.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < 0.08) { ev.state='idle'; ev.idleTimer=2+Math.random()*4; }
        else { ev.x+=dx/d*1.5*dt; ev.y+=dy/d*1.5*dt; ev.tx=Math.floor(ev.x); ev.ty=Math.floor(ev.y); }
      } else {
        ev.idleTimer -= dt;
        if (ev.idleTimer <= 0) {
          let moved = false;
          for (let tries=0; tries<8; tries++) {
            const angle = Math.random()*Math.PI*2, r = 1+Math.random()*5;
            const nx = ek.tx+0.5+Math.cos(angle)*r, ny = ek.ty+0.5+Math.sin(angle)*r;
            const tnx=Math.floor(nx), tny=Math.floor(ny);
            if (tnx<1||tnx>=MAP_W-1||tny<1||tny>=MAP_H-1) continue;
            if (!WALKABLE_TILES.has(room.mapTiles[tny]?.[tnx])) continue;
            ev.targetX=nx; ev.targetY=ny; ev.state='moving'; moved=true; break;
          }
          if (!moved) ev.idleTimer = 1+Math.random()*2;
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════
//  PLAYER COMBAT
// ═══════════════════════════════════════════════════
function _barracksMult(kingdom) {
  const best = kingdom.buildings.filter(b => b.type === 6 && b.complete)
    .reduce((t, b) => Math.max(t, b.tier || 1), 1);
  return best === 3 ? 1.5 : best === 2 ? 1.25 : 1.0;
}

function updatePlayerKnightCombat(kingdom, dt) {
  const baseKnightDmg = Math.round(KNIGHT_ATK_DMG * _barracksMult(kingdom));
  const warlordNearby  = (v) => kingdom.villagers.some(u =>
    u !== v && u.role === VROLE.KNIGHT && u.tier === 5 && Math.hypot(u.x-v.x, u.y-v.y) <= 6
  );
  const outpostNearby = (v) => kingdom.buildings.some(b =>
    b.type === 9 && b.complete && Math.abs(b.tx - Math.floor(v.x)) <= 6 && Math.abs(b.ty - Math.floor(v.y)) <= 6
  );
  for (const v of kingdom.villagers) {
    if (v.role !== VROLE.KNIGHT || v.state==='sleeping') continue;
    if (v._runicBuff > 0) v._runicBuff -= dt;
    const knightDmg = Math.round(baseKnightDmg * (v._runicBuff > 0 ? 1.3 : 1.0) * (warlordNearby(v) ? 1.15 : 1.0) * (outpostNearby(v) ? 1.15 : 1.0));
    let nearestEnemy = null, nearestDist = KNIGHT_ATK_RANGE;
    for (const eu of kingdom.enemyUnits) {
      if (eu._despawn) continue;
      const d = Math.hypot(eu.x-v.x, eu.y-v.y);
      if (d < nearestDist) { nearestDist=d; nearestEnemy=eu; }
    }
    if (nearestEnemy) {
      v.attackTimer += dt;
      if (v.attackTimer >= KNIGHT_ATK_SPD) {
        v.attackTimer = 0; v.attackAnim = 1.0;
        _dmgEnemyUnit(kingdom, nearestEnemy, knightDmg);
        if (v.tier === 5 && !nearestEnemy._despawn) { // Warlord knockback
          const kbx = nearestEnemy.x - v.x, kby = nearestEnemy.y - v.y;
          const kbl = Math.sqrt(kbx*kbx + kby*kby) || 1;
          nearestEnemy.x += (kbx/kbl) * 1.5; nearestEnemy.y += (kby/kbl) * 1.5;
        }
      }
      v.state = 'fighting';
      continue;
    }
    // Check for bot guards (defenders at enemy village)
    let nearestGuard = null, nearestGuardEk = null, guardDist = KNIGHT_ATK_RANGE;
    let nearestEkBld = null, nearestEkBldOwner = null, nekDist = KNIGHT_ATK_RANGE;
    let nearestEkTC = null, nekTCDist = KNIGHT_ATK_RANGE;
    for (const ek of kingdom.enemyKingdoms) {
      if (ek.guards) {
        for (const g of ek.guards) {
          if (g._despawn) continue;
          const d = Math.hypot(g.x - v.x, g.y - v.y);
          if (d < guardDist) { guardDist = d; nearestGuard = g; nearestGuardEk = ek; }
        }
      }
      for (const b of ek.buildings) {
        const d = Math.hypot(b.tx+0.5-v.x, b.ty+0.5-v.y);
        if (d < nekDist) { nekDist=d; nearestEkBld=b; nearestEkBldOwner=ek; }
      }
      const ekHp = ek._playerKingdom ? (ek._playerKingdom.townCenter?.hp ?? 0) : ek.hp;
      if (ekHp > 0) {
        const dTC = Math.hypot(ek.tx+0.5-v.x, ek.ty+0.5-v.y);
        if (dTC < nekTCDist) { nekTCDist=dTC; nearestEkTC=ek; }
      }
    }
    if (nearestGuard) {
      v.attackTimer += dt;
      if (v.attackTimer >= KNIGHT_ATK_SPD) {
        v.attackTimer = 0; v.attackAnim = 1.0;
        nearestGuard.hp = Math.max(0, nearestGuard.hp - knightDmg);
        nearestGuard._hitFlash = 1.0;
        if (nearestGuard.hp <= 0) nearestGuard._despawn = true;
        if (v.tier === 5 && !nearestGuard._despawn) { // Warlord knockback
          const kbx = nearestGuard.x - v.x, kby = nearestGuard.y - v.y;
          const kbl = Math.sqrt(kbx*kbx + kby*kby) || 1;
          nearestGuard.x += (kbx/kbl) * 1.5; nearestGuard.y += (kby/kbl) * 1.5;
        }
      }
      v.state = 'fighting'; continue;
    }
    if (nearestEkBld) {
      v.attackTimer += dt;
      if (v.attackTimer >= KNIGHT_ATK_SPD) {
        v.attackTimer = 0; v.attackAnim = 1.0;
        _dmgEnemyBuilding(kingdom, nearestEkBldOwner, nearestEkBld, knightDmg);
      }
      v.state='fighting'; continue;
    }
    if (nearestEkTC) {
      v.attackTimer += dt;
      if (v.attackTimer >= KNIGHT_ATK_SPD) {
        v.attackTimer = 0; v.attackAnim = 1.0;
        _dmgEnemyKingdom(kingdom, nearestEkTC, knightDmg);
      }
      v.state='fighting'; continue;
    }
    v.attackTimer = 0;
    if (v.hp < v.maxHp) {
      const hasBarracks = kingdom.buildings.some(b => b.type === 6 && b.complete);
      const regenRate = hasBarracks ? 2.5 : 1.0;
      v.hp = Math.min(v.maxHp, v.hp + regenRate * dt);
    }
  }
}

function updateArcherCombat(kingdom, dt) {
  for (const v of kingdom.villagers) {
    if (v.role !== VROLE.ARCHER || v.state !== 'guarding') continue;
    const tower = v.towerTarget ? kingdom.buildings.find(b => b.id === v.towerTarget) : null;
    const sharpshooter = v.tier === 5;
    const towerTier = tower ? (tower.tier || 1) : 1;
    const towerRangeMult = towerTier === 3 ? 2.0 : towerTier === 2 ? 1.5 : 1.0;
    const towerDmgMult   = towerTier === 3 ? 1.5 : towerTier === 2 ? 1.25 : 1.0;
    let bestDist = ARCHER_ATK_RANGE * towerRangeMult * (sharpshooter ? 3.0 : 1.0); // Sharpshooter: 3x range
    let targetX=null, targetY=null, targetRef = null;
    // Sharpshooter: prioritize archer-type enemies
    const shooterUnits = sharpshooter
      ? [...kingdom.enemyUnits].sort((a,b) => (b.role==='archer'?1:0) - (a.role==='archer'?1:0))
      : kingdom.enemyUnits;
    for (const eu of shooterUnits) {
      const d = Math.hypot(eu.x-v.x, eu.y-v.y);
      if (d < bestDist) { bestDist=d; targetX=eu.x; targetY=eu.y; targetRef={eu,isTC:false}; }
    }
    if (!targetRef) {
      for (const ek of kingdom.enemyKingdoms) {
        // Guards first
        if (ek.guards) {
          for (const g of ek.guards) {
            if (g._despawn) continue;
            const d = Math.hypot(g.x - v.x, g.y - v.y);
            if (d < bestDist) { bestDist=d; targetX=g.x; targetY=g.y; targetRef={guard:g, isTC:false}; }
          }
        }
        if (targetRef) break;
        const ekHp = ek._playerKingdom ? (ek._playerKingdom.townCenter?.hp ?? 0) : ek.hp;
        if (ekHp <= 0) continue;
        const d = Math.hypot(ek.tx+0.5-v.x, ek.ty+0.5-v.y);
        if (d < bestDist) {
          targetX=ek.tx+0.5; targetY=ek.ty+0.5;
          targetRef={eu:null, ek, isTC:true}; break;
        }
      }
    }
    if (targetRef) {
      v.attackTimer += dt;
      const archerAtkSpd = ARCHER_ATK_SPD * (sharpshooter ? 2.5 : 1.0); // Sharpshooter: slow but powerful
      if (v.attackTimer >= archerAtkSpd) {
        v.attackTimer = 0;
        const dmg = Math.round(ARCHER_ATK_DMG * (TIER_SPEED[v.tier-1]||1.0) * towerDmgMult * (sharpshooter ? 2.0 : 1.0));
        spawnProjectile(kingdom, v.x, v.y, targetX, targetY, 'arrow');
        if (targetRef.guard) {
          const g = targetRef.guard;
          g.hp = Math.max(0, g.hp - dmg); g._hitFlash = 1.0;
          if (g.hp <= 0) g._despawn = true;
        } else if (targetRef.isTC) { _dmgEnemyKingdom(kingdom, targetRef.ek, dmg); }
        else                       { _dmgEnemyUnit(kingdom, targetRef.eu, dmg); }
      }
    } else {
      v.attackTimer = 0;
    }
  }
}

// ═══════════════════════════════════════════════════
//  AUTO-DEFEND
// ═══════════════════════════════════════════════════
function updateKnightDefend(kingdom, dt) {
  kingdom._defendRerouteTimer -= dt;
  if (kingdom._defendRerouteTimer > 0) return;
  kingdom._defendRerouteTimer = 2.5;

  if (!kingdom.enemyUnits.length) { kingdom.alertMode = false; kingdom._alertNotified = false; return; }
  const radius = getTerritoryRadius(kingdom) + 8;
  const tc = kingdom.townCenter;
  if (!tc) return;

  const threat = kingdom.enemyUnits.find(eu =>
    Math.hypot(eu.x - (tc.tx+0.5), eu.y - (tc.ty+0.5)) < radius
  );
  if (!threat) return;

  if (!kingdom.alertMode) {
    kingdom.alertMode = true;
    if (!kingdom._alertNotified) { kingdom.notify('Your kingdom is under attack!', 'warn'); kingdom._alertNotified = true; }
  }

  const DEFEND_RADIUS = 8;
  const tcX = tc.tx + 0.5, tcY = tc.ty + 0.5;

  for (const v of kingdom.villagers) {
    if (v.role !== VROLE.KNIGHT) continue;
    if (v.state === 'fighting') continue;
    if (v.state === 'sleeping') {
      v.state = 'idle'; v.idleTimer = 0.1; v._goingSleep = false;
    }
    const shouldReroute = v.state === 'idle' || v.state === 'patrolling' ||
      v._goingSleep || (v.state === 'moving' && v.path.length < 4);
    if (!shouldReroute) continue;

    let nearest = null, nearDist = Infinity;
    for (const eu of kingdom.enemyUnits) {
      const d = Math.hypot(eu.x - v.x, eu.y - v.y);
      if (d < nearDist) { nearDist = d; nearest = eu; }
    }
    if (!nearest) continue;

    const edx = nearest.x - tcX, edy = nearest.y - tcY;
    const eDist = Math.hypot(edx, edy);
    let tgtX, tgtY;
    if (eDist <= DEFEND_RADIUS) {
      tgtX = nearest.x; tgtY = nearest.y;
    } else {
      tgtX = tcX + (edx / eDist) * DEFEND_RADIUS;
      tgtY = tcY + (edy / eDist) * DEFEND_RADIUS;
    }

    const path = findPath(Math.floor(v.x), Math.floor(v.y), Math.floor(tgtX), Math.floor(tgtY), kingdom.villagerBlocked, kingdom);
    if (!path || path.length < 2) continue;
    v.path = path.slice(1);
    v.state = 'moving';
    v._goingSleep = false; v._sleepTarget = null;
  }
}

// ═══════════════════════════════════════════════════
//  MAIN UPDATE
// ═══════════════════════════════════════════════════
// Per-kingdom combat simulation — call once per kingdom per tick
export function updateCombat(room, kingdom, dt) {
  if (!kingdom.settled || kingdom.gameState !== 'playing') return;

  updateEnemyAI(kingdom, dt);
  updateEnemyVillagers(kingdom, dt);
  updatePlayerKnightCombat(kingdom, dt);
  updateArcherCombat(kingdom, dt);
  updateProjectiles(kingdom, dt);
  updateKnightDefend(kingdom, dt);

  for (const v of kingdom.villagers) {
    if (v.attackAnim > 0) v.attackAnim = Math.max(0, v.attackAnim - dt * 3.2);
    if (v._hitFlash > 0)  v._hitFlash  = Math.max(0, v._hitFlash  - dt * 6);
  }
  for (const eu of kingdom.enemyUnits) {
    if (eu.attackAnim > 0) eu.attackAnim = Math.max(0, eu.attackAnim - dt * 3.2);
    if (eu._hitFlash > 0)  eu._hitFlash  = Math.max(0, eu._hitFlash  - dt * 6);
  }
}

// ═══════════════════════════════════════════════════
//  BOT DEFENDERS
// ═══════════════════════════════════════════════════
function updateBotDefenders(room, dt) {
  for (const ek of room.botKingdoms) {
    if (ek.hp <= 0) continue;
    if (!ek.guards) { ek.guards = []; ek._guardRespawnTimer = 0; }

    // Tick down respawn timer and revive one dead guard at a time
    const deadCount = ek.guards.filter(g => g._despawn).length;
    if (deadCount > 0) {
      ek._guardRespawnTimer += dt;
      if (ek._guardRespawnTimer >= GUARD_RESPAWN_TIME) {
        ek._guardRespawnTimer = 0;
        const g = ek.guards.find(g => g._despawn);
        if (g) {
          const angle = g.homeAngle ?? 0;
          g.x = ek.tx + Math.cos(angle) * 2 + 0.5;
          g.y = ek.ty + Math.sin(angle) * 2 + 0.5;
          g.tx = Math.floor(g.x); g.ty = Math.floor(g.y);
          g.hp = g.maxHp;
          g._despawn = false; g._hitFlash = 0; g.attackTimer = 0;
        }
      }
    } else {
      ek._guardRespawnTimer = 0;
    }

    // Find the nearest player knight/archer within detection radius
    let threat = null, threatDist = GUARD_DETECT_RADIUS;
    for (const k of room.kingdoms) {
      if (k.gameState !== 'playing') continue;
      for (const v of k.villagers) {
        if (v.role !== VROLE.KNIGHT && v.role !== VROLE.ARCHER) continue;
        if (v._despawn || v.hp <= 0) continue;
        const d = Math.hypot(v.x - (ek.tx + 0.5), v.y - (ek.ty + 0.5));
        if (d < threatDist) { threatDist = d; threat = v; }
      }
    }

    for (const g of ek.guards) {
      if (g._despawn) continue;
      if (g._hitFlash  > 0) g._hitFlash  = Math.max(0, g._hitFlash  - dt * 6);
      if (g.attackAnim > 0) g.attackAnim = Math.max(0, g.attackAnim - dt * 3.2);

      if (threat && !threat._despawn && threat.hp > 0) {
        const range = g.role === 'Archer' ? GUARD_ARCHER_RNG : GUARD_MELEE_RNG;
        const d = Math.hypot(threat.x - g.x, threat.y - g.y);

        if (d <= range) {
          g.attackTimer += dt;
          if (g.attackTimer >= GUARD_ATK_SPD) {
            g.attackTimer = 0; g.attackAnim = 1.0;
            const dmg = g.role === 'Archer' ? GUARD_ARC_DMG : GUARD_INF_DMG;
            threat.hp = Math.max(0, threat.hp - dmg);
            threat._hitFlash = 1.0;
            if (threat.hp <= 0) threat._despawn = true;
          }
          g.state = 'fighting';
        } else {
          g.attackTimer = 0;
          g.state = 'moving';
          const dx = threat.x - g.x, dy = threat.y - g.y;
          g.x += (dx / d) * GUARD_SPEED * dt;
          g.y += (dy / d) * GUARD_SPEED * dt;
          g.tx = Math.floor(g.x); g.ty = Math.floor(g.y);
        }
      } else {
        // No threat — drift back to patrol post
        g.attackTimer = 0;
        g.state = 'patrol';
        const homeX = ek.tx + Math.cos(g.homeAngle ?? 0) * GUARD_PATROL_RADIUS + 0.5;
        const homeY = ek.ty + Math.sin(g.homeAngle ?? 0) * GUARD_PATROL_RADIUS + 0.5;
        const d = Math.hypot(homeX - g.x, homeY - g.y);
        if (d > 0.3) {
          const speed = GUARD_SPEED * 0.45;
          g.x += ((homeX - g.x) / d) * speed * dt;
          g.y += ((homeY - g.y) / d) * speed * dt;
          g.tx = Math.floor(g.x); g.ty = Math.floor(g.y);
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════
//  BOT SCOUTS
// ═══════════════════════════════════════════════════
const SCOUT_SPEED        = 2.8;  // tiles/sec
const SCOUT_SPOT_RADIUS  = 10;   // tiles from TC — auto-spotted even if fog not revealed

const SCOUT_MESSAGES = [
  n => `A scout from ${n} has spotted your kingdom!`,
  n => `${n} has sent a scout — they know where you are.`,
  n => `You've been scouted by ${n}. Prepare your defences.`,
];

function updateBotScouts(room, dt) {
  const players = room.kingdoms.filter(k => k.settled && k.townCenter && k.gameState === 'playing');
  if (!players.length) return;

  for (const ek of room.botKingdoms) {
    if (ek.hp <= 0) continue;
    if (!ek.scouts) { ek.scouts = []; }

    // Spawn scout when timer fires
    if (ek._scoutTimer > 0) {
      ek._scoutTimer -= dt;
      if (ek._scoutTimer <= 0) {
        ek._scoutTimer = 0;
        const target = players[Math.floor(Math.random() * players.length)];
        const tc = target.townCenter;
        const path = findPath(ek.tx, ek.ty, tc.tx, tc.ty, null, room);
        if (path && path.length > 1) {
          ek.scouts.push({
            id: room._ekVilId--,
            role: 'Explorer',
            x: ek.tx + 0.5, y: ek.ty + 0.5,
            tx: ek.tx, ty: ek.ty,
            state: 'approaching',
            targetId: target.id,
            _notified: false,
            _despawn: false,
            path: path.slice(1),
            hp: 12, maxHp: 12,
            attackTimer: 0, attackAnim: 0, _hitFlash: 0,
          });
        }
      }
    }

    for (const s of ek.scouts) {
      if (s._despawn) continue;
      if (s._hitFlash > 0) s._hitFlash = Math.max(0, s._hitFlash - dt * 6);

      if (s.state === 'approaching') {
        const target = players.find(k => k.id === s.targetId);
        if (!target) { s._despawn = true; continue; }

        // Check if spotted: in player fog OR close enough to TC
        if (!s._notified) {
          const fi = Math.floor(s.y) * MAP_W + Math.floor(s.x);
          const distToTC = Math.hypot(s.x - (target.townCenter.tx + 0.5), s.y - (target.townCenter.ty + 0.5));
          const spotted = target.fogVisible[fi] || distToTC <= SCOUT_SPOT_RADIUS;
          if (spotted) {
            s._notified = true;
            const msg = SCOUT_MESSAGES[Math.floor(Math.random() * SCOUT_MESSAGES.length)](ek.name);
            target.notify(msg, 'warn');
            // Turn around immediately
            s.state = 'retreating';
            const ret = findPath(Math.floor(s.x), Math.floor(s.y), ek.tx, ek.ty, null, room);
            s.path = ret ? ret.slice(1) : [];
          }
        }

        // Advance along path
        if (s.state === 'approaching') _scoutStep(s, dt);

      } else {
        // Retreating — follow path home, then despawn
        _scoutStep(s, dt);
        if (s.path.length === 0) s._despawn = true;
      }
    }

    ek.scouts = ek.scouts.filter(s => !s._despawn);
  }
}

function _scoutStep(s, dt) {
  if (!s.path.length) return;
  const tgt = s.path[0];
  const wx = tgt.x + 0.5, wy = tgt.y + 0.5;
  const dx = wx - s.x, dy = wy - s.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= SCOUT_SPEED * dt + 0.01) {
    const _rem = dist < 0.001 ? dt : dt - dist/SCOUT_SPEED;
    s.x = wx; s.y = wy; s.tx = tgt.x; s.ty = tgt.y;
    s.path.shift();
    if (s.path.length > 0 && _rem > 0.001) {
      const n=s.path[0]; const ndx=n.x+0.5-s.x, ndy=n.y+0.5-s.y;
      const nd=Math.sqrt(ndx*ndx+ndy*ndy);
      if (nd>0) { const mv=Math.min(nd,SCOUT_SPEED*_rem); s.x+=ndx/nd*mv; s.y+=ndy/nd*mv; }
    }
  } else {
    s.x += (dx / dist) * SCOUT_SPEED * dt;
    s.y += (dy / dist) * SCOUT_SPEED * dt;
  }
}

// Room-level bot kingdom management — call once per tick (not per kingdom)
export function updateBotKingdoms(room, dt) {
  const settled = room.kingdoms.filter(k => k.settled && k.gameState === 'playing');
  if (!settled.length) return;
  room._elapsed = (room._elapsed || 0) + dt;

  for (const ek of room.botKingdoms) {
    if (ek.hp <= 0) continue;
    ek.raidTimer += dt;
    if (ek.raidTimer >= ek.raidInterval) {
      // Pick a random settled player to raid
      const target = settled[Math.floor(Math.random() * settled.length)];
      // Don't raid until the player has at least 2 knights
      if (target.villagers.filter(v => v.role === 'Knight').length >= 2) {
        // Random jitter so bots can't re-sync after multiple blocked attempts
        ek.raidTimer = -(30 + Math.random() * 60);
        launchRaid(room, target, ek);
      } else {
        // Retry in 30s — don't reset to 0 or all bots stay in sync
        ek.raidTimer = ek.raidInterval - 30;
      }
    }
  }

  updateBotDefenders(room, dt);
  updateBotScouts(room, dt);

  if (room._nextBotTimer > 0) {
    room._nextBotTimer -= dt;
    if (room._nextBotTimer <= 0) {
      room._nextBotTimer = 0;
      _spawnKingdom(room, room._totalBotWaves);
      room._totalBotWaves++;
      room._nextBotTimer = NEXT_WAVE_DELAY;
    }
  }
}
