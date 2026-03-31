// ── combat.js ──

// ═══════════════════════════════════════════════════
//  ENEMY SPRITE PALETTES  (re-use villager sprite rows)
// ═══════════════════════════════════════════════════
// Enemy infantry: crimson plate (Knight sprite rows)
const ENEMY_INF_PAL  = { '.':null, 'K':'#b02828','k':'#501010','V':'#080306','A':'#882020','L':'#d04040' };
// Enemy archer: dark red cloak (Archer sprite rows)
const ENEMY_ARC_PAL  = { '.':null, 'V':'#5a1a1a','v':'#3a0e0e','s':'#d4a060','e':'#180800','G':'#6a2020','g':'#4a1010','Q':'#3a1a08','L':'#4a2010','l':'#2a1008' };
// Enemy civilian villager: muted reddish-earth tones
const ENEMY_VILLAGER_PAL = { '.':null,'V':'#7a4040','v':'#4a2020','s':'#b08060','e':'#180800','G':'#5a3030','g':'#3a1818','L':'#6a4040','l':'#3a2020','O':'#d06040','o':'#a04030','A':'#8a5050','D':'#4a2828','d':'#3a1818','c':'#6a3030','C':'#8a4040','b':'#7a4040','B':'#602020','r':'#5a2020','R':'#7a3030','m':'#4a2828','M':'#6a3838','S':'#8a5a50','Q':'#3a1a08' };

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════.════════════════════
let enemyKingdoms = [];    // array of { id, wave, tx, ty, hp, maxHp, raidTimer, raidInterval, buildings:[], villagers:[] }
let enemyUnits   = [];     // enemy raider objects (all kingdoms share pool)
let projectiles  = [];     // visual projectiles
let _eid = 0, _pid = 0, _ekId = 0;
let gameState    = 'playing'; // 'playing' | 'defeat'
let alertMode    = false;
let _nextKingdomTimer = 0;  // countdown to next wave spawn (0 = not pending)
let _totalWaves   = 0;      // how many kingdoms have been spawned total

// Wave scaling: index 0=wave1, 1=wave2, 2=wave3, 3+=wave4
const WAVE_TC_HP    = [250, 340, 440, 560];
const WAVE_RAID_INT = [300, 255, 210, 170];
const WAVE_RAID_MIN = [1, 3, 5, 7];
const WAVE_RAID_MAX = [2, 6, 9, 12];
const WAVE_NAMES    = ['Iron Keep','Ashgate','Dreadholm','Shadowmere','Ironfang'];
const NEXT_WAVE_DELAY = 90; // seconds between destroying one kingdom and the next spawning

// ═══════════════════════════════════════════════════
//  INIT  (called from placeTownCenter)
// ═══════════════════════════════════════════════════
// difficulty = total kingdoms ever spawned (drives HP/raid scaling)
// preferredAngle = optional radian hint so initial kingdoms spread out
function _spawnKingdom(difficulty, preferredAngle, initialRaidDelay) {
  if (!townCenter) return;
  const cx = townCenter.tx, cy = townCenter.ty;
  const wi = Math.min(difficulty - 1, WAVE_TC_HP.length - 1);

  // Pick pre-generated site closest to the preferred angle (from the actual town center)
  let site = null;
  if (enemyKingdomSites.length > 0) {
    if (preferredAngle !== undefined) {
      let bestDiff = Infinity, bestIdx = 0;
      for (let i = 0; i < enemyKingdomSites.length; i++) {
        const s = enemyKingdomSites[i];
        let diff = Math.abs(Math.atan2(s.ty-cy, s.tx-cx) - preferredAngle);
        if (diff > Math.PI) diff = Math.PI*2 - diff;
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      }
      [site] = enemyKingdomSites.splice(bestIdx, 1);
    } else {
      [site] = enemyKingdomSites.splice(0, 1);
    }
    // Discard if too close to an existing kingdom (can happen if player settled far off-center)
    if (enemyKingdoms.some(ek => Math.hypot(site.tx-ek.tx, site.ty-ek.ty) < 30)) site = null;
  }

  // Fallback: random walkable spot (no pathfind — only reached when pool is exhausted)
  if (!site) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const nx = 5+Math.floor(Math.random()*(MAP_W-10));
      const ny = 5+Math.floor(Math.random()*(MAP_H-10));
      if (!WALKABLE_TILES.has(mapTiles[ny][nx])) continue;
      if (Math.hypot(nx-cx, ny-cy) < 45) continue;
      if (enemyKingdoms.some(ek => Math.hypot(nx-ek.tx, ny-ek.ty) < 30)) continue;
      site = {tx: nx, ty: ny}; break;
    }
  }

  if (!site) return;
  const ek = {
    id: _ekId++, difficulty,
    tx: site.tx, ty: site.ty,
    hp: WAVE_TC_HP[wi], maxHp: WAVE_TC_HP[wi],
    raidTimer: initialRaidDelay !== undefined ? initialRaidDelay : 60,
    raidInterval: WAVE_RAID_INT[wi],
    name: WAVE_NAMES[(_ekId-1) % WAVE_NAMES.length],
    buildings: [], villagers: [],
  };
  enemyKingdoms.push(ek);
  generateEnemyVillage(ek);
  notify(`A new enemy kingdom rises — ${ek.name}!`, 'warn');
}

function initEnemyKingdom() {
  if (!townCenter) return;
  enemyKingdoms = [];
  enemyUnits    = [];
  projectiles   = [];
  gameState     = 'playing';
  _nextKingdomTimer = 0;
  _totalWaves   = 0;
  _ekBldId      = -100;
  _ekVilId      = -200;
  document.getElementById('gameover').classList.add('go-hidden');

  // Spawn 3 kingdoms spread around the player at evenly-spaced angles
  const startAngle = Math.random() * Math.PI * 2;
  const INITIAL_COUNT = 3;
  for (let i = 0; i < INITIAL_COUNT; i++) {
    _totalWaves++;
    const angle = startAngle + (i / INITIAL_COUNT) * Math.PI * 2;
    // Stagger first raids so they don't all hit at the same time
    const raidDelay = 60 + i * 80;
    _spawnKingdom(1, angle, raidDelay);
  }
}

// ═══════════════════════════════════════════════════
//  ENEMY VILLAGE GENERATION
// ═══════════════════════════════════════════════════
let _ekBldId = -100;  // negative IDs for enemy buildings
let _ekVilId = -200;  // negative IDs for enemy villagers

function generateEnemyVillage(ek) {
  if (!ek) return;
  ek.buildings = [];
  ek.villagers = [];

  const cx = ek.tx, cy = ek.ty;

  // Layout: [dx, dy, type]  type indices match STRUCT_NAME
  // House=0, Barracks=6, Forge=7, Wall=2, Mine=5
  const layout = [
    [-2,-2, 2], [ 0,-2, 2], [ 2,-2, 2],  // north walls
    [-2, 0, 2],              [ 2, 0, 2],  // east/west walls
    [-2, 2, 2], [ 0, 2, 2], [ 2, 2, 2],  // south walls
    [-1,-1, 0], [ 1,-1, 0],              // houses north
    [-1, 1, 0], [ 1, 1, 0],              // houses south
    [ 0,-3, 6],                           // barracks north
    [ 3, 1, 7],                           // forge east
    [-3, 1, 5],                           // mine west
  ];

  for (const [dx, dy, type] of layout) {
    const tx = cx + dx, ty = cy + dy;
    if (tx < 1 || tx >= MAP_W-1 || ty < 1 || ty >= MAP_H-1) continue;
    if (!WALKABLE_TILES.has(mapTiles[ty][tx])) continue;
    if (ek.buildings.some(b => b.tx===tx && b.ty===ty)) continue;
    const maxHp = BLDG_HP_MAX[type] || 50;
    ek.buildings.push({
      id: _ekBldId--, type, tx, ty, w:1, h:1,
      hp: maxHp, maxHp, complete: true,
    });
  }

  // Lazy villagers — wander visibly when player is nearby
  const vLayout = [[-3,-3,'Woodcutter'],[3,-3,'Farmer'],[-4,0,'Builder'],[4,0,'Basic'],[0,4,'Baker']];
  for (const [dx, dy, role] of vLayout) {
    const tx = cx+dx, ty = cy+dy;
    if (tx<1||tx>=MAP_W-1||ty<1||ty>=MAP_H-1) continue;
    if (!WALKABLE_TILES.has(mapTiles[ty][tx])) continue;
    ek.villagers.push({
      id: _ekVilId--, role,
      x: tx+0.5, y: ty+0.5, tx, ty,
      state: 'idle',
      idleTimer: Math.random()*3,
      targetX: tx+0.5, targetY: ty+0.5,
      path: [],
    });
  }
}

function _spawnAtKeep(ek, role) {
  if (!ek) return null;
  for (let a=0; a<25; a++) {
    const tx = ek.tx + Math.round(Math.random()*5-2.5);
    const ty = ek.ty + Math.round(Math.random()*5-2.5);
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
function _compassDir(fromTx, fromTy, toTx, toTy) {
  const dx = toTx - fromTx, dy = toTy - fromTy;
  const a = Math.atan2(dy, dx) * 180 / Math.PI;
  const dirs = ['East','Southeast','South','Southwest','West','Northwest','North','Northeast'];
  return dirs[Math.round((a + 360 + 22.5) / 45) % 8];
}

function launchRaid(ek) {
  if (!ek || !townCenter) return;
  const wi = Math.min(ek.difficulty-1, WAVE_RAID_MIN.length-1);
  const terr   = getTerritoryRadius();
  const excess = Math.max(0, terr - NPC_TERRITORY_REQ);
  const baseSize = WAVE_RAID_MIN[wi] + Math.floor(excess / 4);
  const size = Math.min(WAVE_RAID_MAX[wi], baseSize);

  const marchPath = findPath(ek.tx, ek.ty, townCenter.tx, townCenter.ty, navBlocked);
  if (!marchPath || marchPath.length < 2) return;

  let archers = 0;
  for (let i=0; i<size; i++) {
    const isArcher = size >= 5 && archers < Math.floor(size/3) && Math.random() < 0.35;
    const role = isArcher ? 'archer' : 'infantry';
    if (isArcher) archers++;

    let stx = ek.tx, sty = ek.ty;
    for (let a=0; a<15; a++) {
      const nx = ek.tx + Math.round(Math.random()*6-3);
      const ny = ek.ty + Math.round(Math.random()*6-3);
      if (nx<1||nx>=MAP_W-1||ny<1||ny>=MAP_H-1) continue;
      if (WALKABLE_TILES.has(mapTiles[ny][nx])) { stx=nx; sty=ny; break; }
    }

    const eu = mkEnemyUnit(role, stx, sty);
    eu.path = marchPath.slice(1).map(p=>({x:p.x, y:p.y}));
    enemyUnits.push(eu);
  }

  const dir = _compassDir(townCenter.tx, townCenter.ty, ek.tx, ek.ty);
  notify(`${ek.name} raids from the ${dir}! (${size} warriors)`, 'warn');
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

  // Separation: push apart enemy units sharing a tile
  for (let i=0; i<enemyUnits.length; i++) {
    for (let j=i+1; j<enemyUnits.length; j++) {
      const a=enemyUnits[i], b=enemyUnits[j];
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

    // Find nearest enemy unit in attack range
    let nearestEnemy = null, nearestDist = KNIGHT_ATK_RANGE;
    for (const eu of enemyUnits) {
      if (eu._despawn) continue;
      const d = Math.hypot(eu.x-v.x, eu.y-v.y);
      if (d < nearestDist) { nearestDist=d; nearestEnemy=eu; }
    }
    if (nearestEnemy) {
      v.attackTimer += dt;
      if (v.attackTimer >= KNIGHT_ATK_SPD) {
        v.attackTimer = 0;
        v.attackAnim = 1.0;
        _dmgEnemyUnit(nearestEnemy, KNIGHT_ATK_DMG);
      }
      v.state = 'fighting';
      if (v.selected) updateVillagerPanel();
      continue;
    }

    // Attack enemy buildings/TCs in range (check all kingdoms)
    if (!nearestEnemy) {
      let nearestEkBld = null, nearestEkBldOwner = null, nekDist = KNIGHT_ATK_RANGE;
      let nearestEkTC = null, nekTCDist = KNIGHT_ATK_RANGE;
      for (const ek of enemyKingdoms) {
        for (const b of ek.buildings) {
          const d = Math.hypot(b.tx+0.5-v.x, b.ty+0.5-v.y);
          if (d < nekDist) { nekDist=d; nearestEkBld=b; nearestEkBldOwner=ek; }
        }
        if (ek.hp > 0) {
          const dTC = Math.hypot(ek.tx+0.5-v.x, ek.ty+0.5-v.y);
          if (dTC < nekTCDist) { nekTCDist=dTC; nearestEkTC=ek; }
        }
      }
      if (nearestEkBld) {
        v.attackTimer += dt;
        if (v.attackTimer >= KNIGHT_ATK_SPD) {
          v.attackTimer = 0; v.attackAnim = 1.0;
          _dmgEnemyBuilding(nearestEkBldOwner, nearestEkBld, KNIGHT_ATK_DMG);
        }
        v.state='fighting'; if (v.selected) updateVillagerPanel(); continue;
      }
      if (nearestEkTC) {
        v.attackTimer += dt;
        if (v.attackTimer >= KNIGHT_ATK_SPD) {
          v.attackTimer = 0; v.attackAnim = 1.0;
          _dmgEnemyKingdom(nearestEkTC, KNIGHT_ATK_DMG);
        }
        v.state='fighting'; if (v.selected) updateVillagerPanel(); continue;
      }
    }

    v.attackTimer = 0;

    // Regen HP when not fighting (1 HP/sec, faster with barracks nearby)
    if (v.hp < v.maxHp) {
      const hasBarracks = buildings.some(b => b.type === 6 && b.complete);
      const regenRate = hasBarracks ? 2.5 : 1.0;
      v.hp = Math.min(v.maxHp, v.hp + regenRate * dt);
      if (v.selected) updateVillagerPanel();
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
    if (!targetRef) {
      for (const ek of enemyKingdoms) {
        if (ek.hp <= 0) continue;
        const d = Math.hypot(ek.tx+0.5-v.x, ek.ty+0.5-v.y);
        if (d < ARCHER_ATK_RANGE) {
          targetX=ek.tx+0.5; targetY=ek.ty+0.5;
          targetRef={eu:null, ek, isTC:true}; break;
        }
      }
    }

    if (targetRef) {
      v.attackTimer += dt;
      if (v.attackTimer >= ARCHER_ATK_SPD) {
        v.attackTimer = 0;
        const dmg = Math.round(ARCHER_ATK_DMG * (TIER_SPEED[v.tier-1]||1.0));
        spawnProjectile(v.x, v.y, targetX, targetY, 'arrow');
        if (targetRef.isTC) { _dmgEnemyKingdom(targetRef.ek, dmg); }
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
    const btx=b.tx, bty=b.ty;
    buildings = buildings.filter(x=>x.id!==b.id);
    // Cancel any villager seek-trips to this building
    for (const v of villagers) {
      if (v._seekBakery === b.id) v._seekBakery = null;
      if (v._seekForge?.id === b.id) { toolStock[v._seekForge.tier]++; v._seekForge = null; }
    }
    rebuildNavBlocked();
    buildMinimap();
    updateNeighborBonuses(btx, bty);
    notify(`${STRUCT_NAME[b.type]} destroyed!`, 'warn');
  }
}

function _dmgEnemyBuilding(ek, b, dmg) {
  b.hp = Math.max(0, b.hp - dmg);
  if (b.hp <= 0 && ek) {
    ek.buildings = ek.buildings.filter(x => x.id !== b.id);
    notify('Enemy building destroyed!', 'warn');
  }
}

// Lazy enemy villager wander — only ticks when player can see them
function updateEnemyVillagers(dt) {
  for (const ek of enemyKingdoms) {
    for (const ev of ek.villagers) {
      const fi = Math.floor(ev.y)*MAP_W + Math.floor(ev.x);
      if (!fogVisible[fi]) continue;
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
            if (!WALKABLE_TILES.has(mapTiles[tny]?.[tnx])) continue;
            ev.targetX=nx; ev.targetY=ny; ev.state='moving'; moved=true; break;
          }
          if (!moved) ev.idleTimer = 1+Math.random()*2;
        }
      }
    }
  }
}

function _dmgEnemyUnit(eu, dmg) {
  eu.hp = Math.max(0, eu.hp - dmg);
  if (eu.hp <= 0) eu._despawn = true;
}

function _dmgEnemyKingdom(ek, dmg) {
  if (!ek || ek.hp <= 0) return;
  ek.hp = Math.max(0, ek.hp - dmg);
  if (ek.hp <= 0 && gameState==='playing') {
    ek.buildings = []; ek.villagers = [];
    enemyKingdoms = enemyKingdoms.filter(k => k.id !== ek.id);
    const wi = Math.min(ek.difficulty-1, WAVE_TC_HP.length-1);
    const reward = { gold: 60 + wi*40 + Math.floor(Math.random()*40), wood: 20+wi*10, stone: 15+wi*8 };
    gold+=reward.gold; wood+=reward.wood; stone+=reward.stone;
    notify(`${ek.name} has fallen! +${reward.gold}⚜ +${reward.wood}🪵 +${reward.stone}🪨`, 'warn');
    // Schedule a replacement kingdom — harder than the one that fell
    _totalWaves++;
    _nextKingdomTimer = NEXT_WAVE_DELAY;
  }
}

// Keep old name as alias for archer combat (will be updated below)
function _dmgEnemyTC(ek, dmg) { _dmgEnemyKingdom(ek, dmg); }

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
  for (const ek of enemyKingdoms) {
    for (const b of ek.buildings) {
      if (Math.hypot(b.tx+0.5-wx, b.ty+0.5-wy) < 0.7) return {kind:'enemyBuilding', obj:b, ek};
    }
    if (ek.hp>0 && Math.hypot(ek.tx+0.5-wx, ek.ty+0.5-wy) < 1.1)
      return {kind:'keep', ek};
  }
  return null;
}

function directKnightAttack(v, target) {
  let destTx, destTy;
  if (target.kind==='unit') { destTx=Math.floor(target.obj.x); destTy=Math.floor(target.obj.y); }
  else if (target.kind==='keep') { destTx=target.ek.tx; destTy=target.ek.ty; }
  else if (target.kind==='enemyBuilding') { destTx=target.obj.tx; destTy=target.obj.ty; }
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

  const DEFEND_RADIUS = 8; // tiles from TC — knights hold this perimeter
  const tcX = tc.tx + 0.5, tcY = tc.ty + 0.5;

  for (const v of villagers) {
    if (v.role !== VROLE.KNIGHT) continue;
    if (v.state === 'fighting') continue;
    // Wake sleeping knights during a raid
    if (v.state === 'sleeping') {
      v.state = 'idle'; v.idleTimer = 0.1; v._goingSleep = false;
    }
    // Re-route if idle, patrolling, going to sleep, or path is short
    const shouldReroute = v.state === 'idle' || v.state === 'patrolling' ||
      v._goingSleep ||
      (v.state === 'moving' && v.path.length < 4);
    if (!shouldReroute) continue;

    // Find nearest enemy
    let nearest = null, nearDist = Infinity;
    for (const eu of enemyUnits) {
      const d = Math.hypot(eu.x - v.x, eu.y - v.y);
      if (d < nearDist) { nearDist = d; nearest = eu; }
    }
    if (!nearest) continue;

    // Intercept point: enemy position clamped to DEFEND_RADIUS from TC.
    // If the enemy is already inside the perimeter, chase them directly.
    const edx = nearest.x - tcX, edy = nearest.y - tcY;
    const eDist = Math.hypot(edx, edy);
    let tgtX, tgtY;
    if (eDist <= DEFEND_RADIUS) {
      tgtX = nearest.x; tgtY = nearest.y;
    } else {
      tgtX = tcX + (edx / eDist) * DEFEND_RADIUS;
      tgtY = tcY + (edy / eDist) * DEFEND_RADIUS;
    }

    const path = findPath(Math.floor(v.x), Math.floor(v.y), Math.floor(tgtX), Math.floor(tgtY), villagerBlocked);
    if (!path || path.length < 2) continue;
    v.path = path.slice(1);
    v.state = 'moving';
    v._goingSleep = false; v._sleepTarget = null;
    if (v.selected) updateVillagerPanel();
  }
}

// ═══════════════════════════════════════════════════
//  MAIN UPDATE
// ═══════════════════════════════════════════════════
function updateCombat(dt) {
  if (!settled || gameState !== 'playing') return;

  updateEnemyAI(dt);
  updateEnemyVillagers(dt);
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

  // Advance raid timers for each kingdom
  for (const ek of enemyKingdoms) {
    if (ek.hp <= 0) continue;
    ek.raidTimer += dt;
    if (ek.raidTimer >= ek.raidInterval) {
      ek.raidTimer = 0;
      launchRaid(ek);
    }
  }

  // Spawn replacement kingdom after delay
  if (_nextKingdomTimer > 0) {
    _nextKingdomTimer -= dt;
    if (_nextKingdomTimer <= 0) {
      _nextKingdomTimer = 0;
      _spawnKingdom(_totalWaves);
    }
  }
}
