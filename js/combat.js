// ── combat.js ──

// ═══════════════════════════════════════════════════
//  ENEMY SPRITE PALETTES  (re-use villager sprite rows)
// ═══════════════════════════════════════════════════
// Enemy infantry: crimson plate (Knight sprite rows)
const ENEMY_INF_PAL  = { '.':null, 'K':'#b02828','k':'#501010','V':'#080306','A':'#882020','L':'#d04040' };
// Enemy archer: dark red cloak (Archer sprite rows)
const ENEMY_ARC_PAL  = { '.':null, 'V':'#5a1a1a','v':'#3a0e0e','s':'#d4a060','e':'#180800','G':'#6a2020','g':'#4a1010','Q':'#3a1a08','L':'#4a2010','l':'#2a1008' };

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let enemyKingdom = null;   // { tx, ty, hp, maxHp, raidTimer }
let enemyUnits   = [];     // enemy unit objects
let projectiles  = [];     // visual projectiles
let _eid = 0, _pid = 0;
let gameState    = 'playing'; // 'playing' | 'victory' | 'defeat'
let alertMode    = false;

// ═══════════════════════════════════════════════════
//  INIT  (called from placeTownCenter)
// ═══════════════════════════════════════════════════
function initEnemyKingdom() {
  if (!townCenter) return;
  enemyKingdom = null;
  enemyUnits   = [];
  projectiles  = [];
  gameState    = 'playing';
  document.getElementById('gameover').classList.add('go-hidden');

  const cx = townCenter.tx, cy = townCenter.ty;
  const targetDist = 70;

  // Try angles pointing away from centre to find a walkable home for the enemy
  const angles = [Math.PI, Math.PI*1.3, Math.PI*0.7, Math.PI*1.6, Math.PI*0.4, Math.PI*0.5, Math.PI*1.5];
  let found = false;

  for (const angle of angles) {
    if (found) break;
    let ex = Math.round(cx + Math.cos(angle)*targetDist);
    let ey = Math.round(cy + Math.sin(angle)*targetDist);
    ex = Math.max(5, Math.min(MAP_W-6, ex));
    ey = Math.max(5, Math.min(MAP_H-6, ey));

    for (let r=0; r<=12 && !found; r++) {
      for (let dy=-r; dy<=r; dy++) {
        for (let dx=-r; dx<=r; dx++) {
          if (Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
          const nx=ex+dx, ny=ey+dy;
          if (nx<4||nx>=MAP_W-4||ny<4||ny>=MAP_H-4) continue;
          if (!WALKABLE_TILES.has(mapTiles[ny][nx])) continue;
          const dist = Math.hypot(nx-cx, ny-cy);
          if (dist < 45) continue;
          const testPath = findPath(nx, ny, cx, cy);
          if (!testPath || testPath.length < 8) continue;
          enemyKingdom = { tx:nx, ty:ny, hp:TC_HP_MAX, maxHp:TC_HP_MAX,
                           raidTimer: 60 }; // first raid fires at ~4 minutes (300-60=240s after settling)
          found = true;
          break;
        }
        if (found) break;
      }
    }
  }

  if (!found) {
    // Fallback: brute-force search
    for (let attempt=0; attempt<80 && !found; attempt++) {
      const nx = 5 + Math.floor(Math.random()*(MAP_W-10));
      const ny = 5 + Math.floor(Math.random()*(MAP_H-10));
      if (!WALKABLE_TILES.has(mapTiles[ny][nx])) continue;
      if (Math.hypot(nx-cx, ny-cy) < 45) continue;
      const testPath = findPath(nx, ny, cx, cy);
      if (!testPath || testPath.length < 8) continue;
      enemyKingdom = { tx:nx, ty:ny, hp:TC_HP_MAX, maxHp:TC_HP_MAX, raidTimer: 60 };
      found = true;
    }
  }

  if (!found) return; // map topology too restrictive — no enemy this game

  notify('An enemy kingdom lurks in the distance…', 'warn');
}

function _spawnAtKeep(role) {
  if (!enemyKingdom) return null;
  for (let a=0; a<25; a++) {
    const tx = enemyKingdom.tx + Math.round(Math.random()*5-2.5);
    const ty = enemyKingdom.ty + Math.round(Math.random()*5-2.5);
    if (tx<1||tx>=MAP_W-1||ty<1||ty>=MAP_H-1) continue;
    if (!WALKABLE_TILES.has(mapTiles[ty][tx])) continue;
    const eu = mkEnemyUnit(role, tx, ty);
    const path = findPath(tx, ty, townCenter.tx, townCenter.ty, navBlocked);
    if (!path || path.length < 2) continue;
    eu.path = path.slice(1);
    return eu;
  }
  return null;
}

// ═══════════════════════════════════════════════════
//  ENEMY UNIT FACTORY
// ═══════════════════════════════════════════════════
function mkEnemyUnit(role, tx, ty) {
  const hp = role==='archer' ? ENEMY_ARC_HP : ENEMY_INF_HP;
  return {
    id: _eid++, role, team:'enemy',
    x: tx+0.5, y: ty+0.5, tx, ty,
    path: [],
    state: 'marching',
    hp, maxHp: hp,
    attackTarget: null,
    attackTimer: 0,
    attackAnim: 0,
    _despawn: false,
  };
}

// ═══════════════════════════════════════════════════
//  RAIDS
// ═══════════════════════════════════════════════════
function launchRaid() {
  if (!enemyKingdom || !townCenter) return;
  const terr   = getTerritoryRadius();
  const excess = Math.max(0, terr - NPC_TERRITORY_REQ);
  const size   = Math.min(RAID_SIZE_MAX, RAID_SIZE_MIN + Math.floor(excess / 4));

  const marchPath = findPath(enemyKingdom.tx, enemyKingdom.ty, townCenter.tx, townCenter.ty, navBlocked);
  if (!marchPath || marchPath.length < 2) return;

  let archers = 0;
  for (let i=0; i<size; i++) {
    const isArcher = size >= 5 && archers < Math.floor(size/4) && Math.random() < 0.35;
    const role = isArcher ? 'archer' : 'infantry';
    if (isArcher) archers++;

    // Find spawn near enemy keep
    let stx = enemyKingdom.tx, sty = enemyKingdom.ty;
    for (let a=0; a<15; a++) {
      const nx = enemyKingdom.tx + Math.round(Math.random()*6-3);
      const ny = enemyKingdom.ty + Math.round(Math.random()*6-3);
      if (nx<1||nx>=MAP_W-1||ny<1||ny>=MAP_H-1) continue;
      if (WALKABLE_TILES.has(mapTiles[ny][nx])) { stx=nx; sty=ny; break; }
    }

    const eu = mkEnemyUnit(role, stx, sty);
    // All raiders share a copy of the march path from node-1 onward
    eu.path = marchPath.slice(1).map(p=>({x:p.x, y:p.y}));
    enemyUnits.push(eu);
  }

  notify(`Raid incoming! ${size} enemy warriors approach!`, 'warn');
}

// ═══════════════════════════════════════════════════
//  ENEMY AI
// ═══════════════════════════════════════════════════
function updateEnemyAI(dt) {
  for (const eu of enemyUnits) {
    if (eu._despawn) continue;

    // Re-acquire target if current one is dead
    if (!_targetAlive(eu.attackTarget)) eu.attackTarget = null;
    if (!eu.attackTarget) eu.attackTarget = _pickEnemyTarget(eu);

    // Attack when target is in range
    if (eu.attackTarget && _inRange(eu)) {
      eu.attackTimer += dt;
      if (eu.attackTimer >= ENEMY_ATK_SPD) {
        eu.attackTimer = 0;
        _doEnemyHit(eu);
      }
      // Archers: shoot projectile every attack tick
      continue; // don't march while actively attacking
    }

    eu.attackTimer = 0; // reset if nothing in range

    // March along path
    if (eu.path.length > 0) {
      const tgt = eu.path[0];
      const wx=tgt.x+0.5, wy=tgt.y+0.5;
      const dx=wx-eu.x, dy=wy-eu.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if (dist <= ENEMY_SPEED*dt+0.01) {
        eu.x=wx; eu.y=wy; eu.tx=tgt.x; eu.ty=tgt.y;
        eu.path.shift();
      } else {
        eu.x+=dx*ENEMY_SPEED*dt/dist;
        eu.y+=dy*ENEMY_SPEED*dt/dist;
      }
    } else {
      // Reached destination — attack TC
      if (!eu.attackTarget) eu.attackTarget = {kind:'tc'};
    }
  }

  enemyUnits = enemyUnits.filter(eu=>!eu._despawn);
}

function _pickEnemyTarget(eu) {
  const range = eu.role==='archer' ? ENEMY_ARC_RNG : ENEMY_MELEE_RNG;
  let best=null, bestDist=range;

  for (const v of villagers) {
    const d=Math.hypot(v.x-eu.x, v.y-eu.y);
    if (d<bestDist) { bestDist=d; best={kind:'villager',obj:v}; }
  }
  for (const b of buildings) {
    if (!b.complete) continue;
    const d=Math.hypot(b.tx+b.w*0.5-eu.x, b.ty+b.h*0.5-eu.y);
    if (d<bestDist) { bestDist=d; best={kind:'building',obj:b}; }
  }
  if (townCenter) {
    const d=Math.hypot(townCenter.tx+0.5-eu.x, townCenter.ty+0.5-eu.y);
    if (d<bestDist) { bestDist=d; best={kind:'tc'}; }
  }
  return best;
}

function _targetAlive(t) {
  if (!t) return false;
  if (t.kind==='villager') return villagers.includes(t.obj) && t.obj.hp>0;
  if (t.kind==='building') return buildings.includes(t.obj) && t.obj.hp>0;
  if (t.kind==='tc')       return townCenter && townCenter.hp>0;
  return false;
}

function _inRange(eu) {
  if (!eu.attackTarget) return false;
  const range = eu.role==='archer' ? ENEMY_ARC_RNG : ENEMY_MELEE_RNG;
  let tx, ty;
  const t=eu.attackTarget;
  if (t.kind==='villager') { tx=t.obj.x; ty=t.obj.y; }
  else if (t.kind==='building') { tx=t.obj.tx+t.obj.w*0.5; ty=t.obj.ty+t.obj.h*0.5; }
  else if (t.kind==='tc') { tx=townCenter.tx+0.5; ty=townCenter.ty+0.5; }
  else return false;
  return Math.hypot(tx-eu.x, ty-eu.y) <= range;
}

function _doEnemyHit(eu) {
  const dmg = eu.role==='archer' ? ENEMY_ARC_DMG : ENEMY_INF_DMG;
  const t=eu.attackTarget;
  let hx=eu.x, hy=eu.y;

  if (t.kind==='villager') { _dmgVillager(t.obj, dmg); hx=t.obj.x; hy=t.obj.y; }
  else if (t.kind==='building') { _dmgBuilding(t.obj, dmg); hx=t.obj.tx+0.5; hy=t.obj.ty+0.5; }
  else if (t.kind==='tc') { _dmgTC(dmg); hx=townCenter.tx+0.5; hy=townCenter.ty+0.5; }

  if (eu.role==='archer') spawnProjectile(eu.x, eu.y, hx, hy, 'arrow');
}

// ═══════════════════════════════════════════════════
//  PLAYER COMBAT
// ═══════════════════════════════════════════════════
function updatePlayerKnightCombat(dt) {
  for (const v of villagers) {
    if (v.role !== VROLE.KNIGHT || v.state==='sleeping') continue;

    // Find nearest enemy in auto-attack range
    let bestDist = KNIGHT_ATK_RANGE;
    let bestTarget = null;
    for (const eu of enemyUnits) {
      const d = Math.hypot(eu.x-v.x, eu.y-v.y);
      if (d < bestDist) { bestDist=d; bestTarget={eu, isTC:false}; }
    }
    if (!bestTarget && enemyKingdom && enemyKingdom.hp>0) {
      const d = Math.hypot(enemyKingdom.tx+0.5-v.x, enemyKingdom.ty+0.5-v.y);
      if (d < KNIGHT_ATK_RANGE) bestTarget = {eu:null, isTC:true};
    }

    if (bestTarget) {
      v.attackTimer += dt;
      if (v.attackTimer >= KNIGHT_ATK_SPD) {
        v.attackTimer = 0;
        const dmg = Math.round(KNIGHT_ATK_DMG * (TIER_SPEED[v.tier-1]||1.0));
        v.attackAnim = 1.0;
        if (bestTarget.isTC) {
          _dmgEnemyTC(dmg);
        } else {
          _dmgEnemyUnit(bestTarget.eu, dmg);
          spawnProjectile(v.x, v.y, bestTarget.eu.x, bestTarget.eu.y, 'slash');
        }
      }
    } else {
      v.attackTimer = 0;
    }
  }
}

function updateArcherCombat(dt) {
  for (const v of villagers) {
    if (v.role !== VROLE.ARCHER || v.state !== 'guarding') continue;

    let bestDist = ARCHER_ATK_RANGE;
    let targetX=null, targetY=null;
    let targetRef = null;

    for (const eu of enemyUnits) {
      const d = Math.hypot(eu.x-v.x, eu.y-v.y);
      if (d < bestDist) { bestDist=d; targetX=eu.x; targetY=eu.y; targetRef={eu,isTC:false}; }
    }
    if (!targetRef && enemyKingdom && enemyKingdom.hp>0) {
      const d = Math.hypot(enemyKingdom.tx+0.5-v.x, enemyKingdom.ty+0.5-v.y);
      if (d < ARCHER_ATK_RANGE) {
        targetX=enemyKingdom.tx+0.5; targetY=enemyKingdom.ty+0.5;
        targetRef={eu:null, isTC:true};
      }
    }

    if (targetRef) {
      v.attackTimer += dt;
      if (v.attackTimer >= ARCHER_ATK_SPD) {
        v.attackTimer = 0;
        const dmg = Math.round(ARCHER_ATK_DMG * (TIER_SPEED[v.tier-1]||1.0));
        spawnProjectile(v.x, v.y, targetX, targetY, 'arrow');
        if (targetRef.isTC) { _dmgEnemyTC(dmg); }
        else                { _dmgEnemyUnit(targetRef.eu, dmg); }
      }
    } else {
      v.attackTimer = 0;
    }
  }
}

// ═══════════════════════════════════════════════════
//  PROJECTILES
// ═══════════════════════════════════════════════════
function spawnProjectile(fx, fy, tx, ty, type) {
  const dx=tx-fx, dy=ty-fy;
  const dist=Math.sqrt(dx*dx+dy*dy)||1;
  projectiles.push({
    id:_pid++, type,
    x:fx, y:fy,
    vx:dx/dist, vy:dy/dist,
    speed:10,
    life: dist/10 + 0.08,
    _done:false,
  });
}

function updateProjectiles(dt) {
  for (const p of projectiles) {
    if (p._done) continue;
    p.life -= dt;
    if (p.life <= 0) { p._done=true; continue; }
    p.x += p.vx * p.speed * dt;
    p.y += p.vy * p.speed * dt;
  }
  if (projectiles.some(p=>p._done)) projectiles = projectiles.filter(p=>!p._done);
}

// ═══════════════════════════════════════════════════
//  DAMAGE HELPERS
// ═══════════════════════════════════════════════════
function _dmgVillager(v, dmg) {
  v.hp = Math.max(0, v.hp - dmg);
  if (v.hp <= 0) { v._despawn = true; }
}

function _dmgBuilding(b, dmg) {
  if (!b.complete) return;
  b.hp = Math.max(0, b.hp - dmg);
  if (b.hp <= 0) {
    buildings = buildings.filter(x=>x.id!==b.id);
    rebuildNavBlocked();
    buildMinimap();
    notify(`${STRUCT_NAME[b.type]} destroyed!`, 'warn');
  }
}

function _dmgEnemyUnit(eu, dmg) {
  eu.hp = Math.max(0, eu.hp - dmg);
  if (eu.hp <= 0) eu._despawn = true;
}

function _dmgEnemyTC(dmg) {
  if (!enemyKingdom || enemyKingdom.hp <= 0) return;
  enemyKingdom.hp = Math.max(0, enemyKingdom.hp - dmg);
  if (enemyKingdom.hp <= 0 && gameState==='playing') {
    const reward = { gold: 80+Math.floor(Math.random()*50), wood: 30, stone: 20 };
    gold  += reward.gold;
    wood  += reward.wood;
    stone += reward.stone;
    gameState = 'victory';
    _showEndScreen(true, `+${reward.gold}⚜  +${reward.wood}🪵  +${reward.stone}🪨`);
  }
}

function _dmgTC(dmg) {
  if (!townCenter || gameState!=='playing') return;
  townCenter.hp = Math.max(0, townCenter.hp - dmg);
  if (townCenter.hp <= 0) {
    gameState = 'defeat';
    _showEndScreen(false, '');
  }
}

function _showEndScreen(victory, rewardStr) {
  const el = document.getElementById('gameover');
  document.getElementById('go-icon').textContent  = victory ? '⚜' : '☠';
  document.getElementById('go-title').textContent = victory ? 'Victory!' : 'Your Kingdom Has Fallen';
  document.getElementById('go-sub').textContent   = victory ? 'The enemy keep has fallen.' : 'Your town center was destroyed.';
  document.getElementById('go-reward').textContent = rewardStr;
  el.classList.remove('go-hidden');
}

// ═══════════════════════════════════════════════════
//  COMBAT CLICK  (called from game.js mousedown)
// ═══════════════════════════════════════════════════
function findCombatTarget(wx, wy) {
  for (const eu of enemyUnits) {
    if (Math.hypot(eu.x-wx, eu.y-wy) < 0.7) return {kind:'unit', obj:eu};
  }
  if (enemyKingdom && enemyKingdom.hp>0) {
    if (Math.hypot(enemyKingdom.tx+0.5-wx, enemyKingdom.ty+0.5-wy) < 1.1)
      return {kind:'keep'};
  }
  return null;
}

function directKnightAttack(v, target) {
  let destTx, destTy;
  if (target.kind==='unit') { destTx=Math.floor(target.obj.x); destTy=Math.floor(target.obj.y); }
  else if (target.kind==='keep') { destTx=enemyKingdom.tx; destTy=enemyKingdom.ty; }
  else return;

  const path = findPath(Math.floor(v.x), Math.floor(v.y), destTx, destTy, villagerBlocked);
  if (!path || path.length < 2) return;
  v.path  = path.slice(1);
  v.state = 'moving';
  if (v.selected) updateVillagerPanel();
}

// ═══════════════════════════════════════════════════
//  AUTO-DEFEND: re-route idle knights toward enemies
// ═══════════════════════════════════════════════════
let _defendRerouteTimer = 0;
let _alertNotified = false;

function updateKnightDefend(dt) {
  _defendRerouteTimer -= dt;
  if (_defendRerouteTimer > 0) return;
  _defendRerouteTimer = 2.5;

  if (!enemyUnits.length) { alertMode = false; _alertNotified = false; return; }

  const radius = getTerritoryRadius() + 8;
  const tc = townCenter;
  if (!tc) return;

  // Check if any enemy is within threat radius
  const threat = enemyUnits.find(eu =>
    Math.hypot(eu.x - (tc.tx+0.5), eu.y - (tc.ty+0.5)) < radius
  );
  if (!threat) return;

  if (!alertMode) {
    alertMode = true;
    if (!_alertNotified) { notify('Your kingdom is under attack!', 'warn'); _alertNotified = true; }
  }

  for (const v of villagers) {
    if (v.role !== VROLE.KNIGHT) continue;
    if (v.state === 'fighting') continue;
    // Re-route if idle, patrolling, or path is short (already near end)
    const shouldReroute = v.state === 'idle' || v.state === 'patrolling' ||
      (v.state === 'moving' && v.path.length < 4);
    if (!shouldReroute) continue;

    // Find nearest enemy
    let nearest = null, nearDist = Infinity;
    for (const eu of enemyUnits) {
      const d = Math.hypot(eu.x - v.x, eu.y - v.y);
      if (d < nearDist) { nearDist = d; nearest = eu; }
    }
    if (!nearest) continue;

    const path = findPath(Math.floor(v.x), Math.floor(v.y), Math.floor(nearest.x), Math.floor(nearest.y), villagerBlocked);
    if (!path || path.length < 2) continue;
    v.path = path.slice(1);
    v.state = 'moving';
    if (v.selected) updateVillagerPanel();
  }
}

// ═══════════════════════════════════════════════════
//  MAIN UPDATE
// ═══════════════════════════════════════════════════
function updateCombat(dt) {
  if (!settled || gameState !== 'playing') return;

  updateEnemyAI(dt);
  updatePlayerKnightCombat(dt);
  updateArcherCombat(dt);
  updateProjectiles(dt);
  updateKnightDefend(dt);

  // Decay attackAnim for all units
  for (const v of villagers) {
    if (v.attackAnim > 0) v.attackAnim = Math.max(0, v.attackAnim - dt * 3.2);
  }
  for (const eu of enemyUnits) {
    if (eu.attackAnim > 0) eu.attackAnim = Math.max(0, eu.attackAnim - dt * 3.2);
  }

  // Advance raid timer
  if (enemyKingdom && enemyKingdom.hp > 0) {
    enemyKingdom.raidTimer += dt;
    if (enemyKingdom.raidTimer >= RAID_INTERVAL) {
      enemyKingdom.raidTimer = 0;
      launchRaid();
    }
  }
}
