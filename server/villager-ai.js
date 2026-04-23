// ── server/game/villager-ai.js ──
import {
  MAP_W, MAP_H, VROLE, V_NAMES, TOOL_ROLES, HOUSE_CAP, TRAIN_TIME,
  HUNGER_RATE, TIRED_RATE, FEED_TICK, FEED_RESTORE, CHOP_TIME, CHOP_YIELD,
  FARM_TIME, FARM_YIELD, BAKE_TIME, BAKE_COST, BAKE_YIELD, MINE_TIME,
  MINE_YIELD, MINE_IRON_CHANCE, REPAIR_TIME, REPAIR_RATE, REPAIR_STONE,
  CRAFT_TIME, CRAFT_COST, TOOL_SPEED, TIER_SPEED, TIER_XP_REQ,
  VILLAGER_SPEED, UNIT_HP_MAX, BASIC_UPGRADE_TIME, GOLD_TICK,
  SPAWN_INTERVAL, UPGRADE_PREREQ,
  SEASON_LENGTH, FARM_SPEED, REGROWTH_BASE, REGROWTH_MULT,
} from './constants.js';

function getSeason(room) { return Math.floor((room.day - 1) / SEASON_LENGTH) % 4; }
import { STRUCT_BUILD_TIME } from './sprites.js';
import { WALKABLE_TILES, findPath, generateTrees } from './world.js';
import {
  rebuildNavBlocked, calcAdjacencyBonus, updateNeighborBonuses, activateOutpostNodes,
} from './buildings.js';
import { startRoam, doRoam, findPathCached } from './villager-targets.js';

// ── Day/Night helpers (moved from renderer-world.js) ──────────────
export function getNightAlpha(room) {
  const dist = Math.abs(room.dayTime - 0.5);
  return Math.pow(Math.max(0, (dist - 0.25) / 0.25), 2);
}
export function isNight(room)    { return getNightAlpha(room) > 0.5; }
export function isDaylight(room) { return getNightAlpha(room) < 0.05; }

function pickName(room) {
  const pool = V_NAMES.filter(n => !room._usedNames.has(n));
  const name = pool.length ? pool[Math.floor(Math.random()*pool.length)] : 'Villager';
  room._usedNames.add(name);
  return name;
}

export function mkVillager(room, role, tx, ty) {
  const maxHp = UNIT_HP_MAX[role] || 15;
  return {
    id: room._vid++, role, name: pickName(room),
    x: tx+0.5, y: ty+0.5,
    tx, ty,
    path: [],
    state: 'idle',
    idleTimer: Math.random()*3,
    selected: false,
    buildTarget: null,
    chopTarget: null, chopTimer: 0,
    farmTarget: null, farmTimer: 0,
    bakeryTarget: null, bakeTimer: 0,
    mineTarget: null, mineTimer: 0,
    forgeTarget: null, forgeTimer: 0,
    repairTarget: null, repairTimer: 0,
    hunger: 1.0,
    tired: 0.0,
    _goingSleep: false, _sleepTarget: null,
    _despawn: false,
    upgradeTimer: (role === VROLE.BASIC) ? BASIC_UPGRADE_TIME : null,
    patrolAngle: Math.random() * Math.PI * 2,
    tier: 1,
    xp: 0,
    toolTier: 0,
    hp: maxHp, maxHp,
    attackTimer: 0,
    attackAnim: 0,
    _hitFlash: 0,
    towerTarget: null,
    _stuckTimer: 0,
    _pfSlot: room._pfCounter++,
    _pathCache: null,
  };
}

function workSpeed(v) {
  const t = TIER_SPEED[v.tier - 1] || 1.0;
  const w = TOOL_ROLES.has(v.role) ? (TOOL_SPEED[v.toolTier] || 1.0) : 1.0;
  return t * w;
}

function getOutpostBonus(room, tx, ty) {
  for (const b of room.buildings) {
    if (b.type !== 9 || !b.complete) continue;
    if (Math.abs(b.tx - tx) <= 6 && Math.abs(b.ty - ty) <= 6) return 1.25;
  }
  return 1.0;
}

function getNodeBonus(room, tx, ty, nodeType) {
  for (const node of room.resourceNodes) {
    if (!node.active || node.type !== nodeType) continue;
    if (Math.hypot(node.tx - tx, node.ty - ty) <= node.radius) return node.bonus;
  }
  return 1.0;
}

function isNearIronVein(room, mineTx, mineTy) {
  for (const node of room.resourceNodes) {
    if (!node.active || node.type !== 'iron') continue;
    if (Math.hypot(node.tx - mineTx, node.ty - mineTy) <= 4) return true;
  }
  return false;
}

export function updateRegrowth(room, dt) {
  for (const r of room.regrowthQueue) r.timer -= dt;
  const ready = room.regrowthQueue.filter(r => r.timer <= 0);
  room.regrowthQueue = room.regrowthQueue.filter(r => r.timer > 0);
  for (const r of ready) {
    if (room.mapTiles[r.ty]?.[r.tx] === 4 /* T.FOREST */ && !room.trees.some(t => t.tx === r.tx && t.ty === r.ty)) {
      room.trees.push({ id: room._treeId++, tx: r.tx, ty: r.ty,
        ox: 0.04 + Math.random()*0.06, oy: 0.04 + Math.random()*0.06, scale: 0.88 });
      // navBlocked is rebuilt for all kingdoms in GameRoom._tick(); no call needed here
    }
  }
}

function gainXP(room, v) {
  v.xp++;
  if (v.tier === 1 && v.xp >= TIER_XP_REQ[0]) { v.tier = 2; }
  else if (v.tier === 2 && v.xp >= TIER_XP_REQ[1]) { v.tier = 3; }
  else if (v.tier === 3 && v.xp >= TIER_XP_REQ[2]) {
    const t4Used = room.villagers.filter(u => u.tier >= 4).length;
    if (t4Used < (room.tier4Slots || 0)) v.tier = 4;
  }
  else if (v.tier === 4 && v.xp >= TIER_XP_REQ[3]) {
    const t5Used = room.villagers.filter(u => u.tier >= 5).length;
    if (t5Used < (room.tier5Slots || 0)) v.tier = 5;
  }
  if (TOOL_ROLES.has(v.role)) {
    for (let t = 2; t > v.toolTier; t--) {
      if (room.toolStock[t] > 0) { room.toolStock[t]--; v.toolTier = t; break; }
    }
  }
}

function findNearestHouse(room, v) {
  const occ = {};
  for (const ov of room.villagers) {
    if (ov.id === v.id) continue;
    if (ov.state === 'sleeping') {
      const key = `${ov.tx},${ov.ty}`;
      occ[key] = (occ[key] || 0) + 1;
    } else if (ov._goingSleep && ov._sleepTarget) {
      const key = `${ov._sleepTarget.tx},${ov._sleepTarget.ty}`;
      occ[key] = (occ[key] || 0) + 1;
    }
  }
  let best = null, bestDist = Infinity;
  for (const b of room.buildings) {
    if (b.type !== 0 || !b.complete) continue;
    if ((occ[`${b.tx},${b.ty}`] || 0) >= HOUSE_CAP) continue;
    const d = Math.abs(b.tx - v.tx) + Math.abs(b.ty - v.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

function upgradeBasicVillager(room, v) {
  const counts = {};
  for (const r of Object.values(VROLE)) counts[r]=0;
  for (const u of room.villagers) counts[u.role]=(counts[u.role]||0)+1;
  const hasFarmland = room.buildings.some(b=>b.type===4&&b.complete);
  const hasBakery   = room.buildings.some(b=>b.type===1&&b.complete);
  const hasMine     = room.buildings.some(b=>b.type===5&&b.complete);
  const hasForge    = room.buildings.some(b=>b.type===7&&b.complete);
  const hasTower    = room.buildings.some(b=>b.type===3&&b.complete);
  const hasDamaged  = room.buildings.some(b=>b.complete&&b.hp<b.maxHp);
  const candidates = [];
  if (hasFarmland   && (counts[VROLE.FARMER]||0)<3)       candidates.push(VROLE.FARMER);
  if (hasBakery     && (counts[VROLE.BAKER]||0)<2)        candidates.push(VROLE.BAKER);
  if (hasMine       && (counts[VROLE.STONE_MINER]||0)<3)  candidates.push(VROLE.STONE_MINER);
  if (hasForge      && (counts[VROLE.TOOLSMITH]||0)<1)    candidates.push(VROLE.TOOLSMITH);
  if (hasTower      && (counts[VROLE.ARCHER]||0)<2)       candidates.push(VROLE.ARCHER);
  if (hasDamaged    && (counts[VROLE.MECHANIC]||0)<1)     candidates.push(VROLE.MECHANIC);
  if ((counts[VROLE.WOODCUTTER]||0)<3) candidates.push(VROLE.WOODCUTTER);
  if ((counts[VROLE.BUILDER]||0)<2)    candidates.push(VROLE.BUILDER);
  candidates.push(VROLE.WOODCUTTER);
  v.role = candidates[0];
  v.upgradeTimer = null;
}

export function getPopCap(room) {
  let cap = 0;
  for (const b of room.buildings) {
    if (b.type !== 0 || !b.complete) continue;
    const t = b.tier || 1;
    cap += t === 3 ? 9 : t === 2 ? 6 : HOUSE_CAP;
  }
  return cap;
}

export function updateVillagers(room, dt) {
  room._pfRound = (room._pfRound || 0) + 1;
  for (const v of room.villagers) {
    v.hunger = Math.max(0, v.hunger - HUNGER_RATE * dt);
    if (v.hunger <= 0) v._despawn = true;

    if (v.state==='sleeping') {
      if (isDaylight(room)) {
        v.tired=0; v.state='idle'; v.idleTimer=1+Math.random()*2;
      }
      continue;
    }

    if (v.role === VROLE.EXPLORER) {
      if (v.path.length === 0 && v.state !== 'idle') { v.state = 'idle'; v.idleTimer = 0.5; }
    } else {

    if (v.state==='chopping') {
      if (!v.chopTarget||!room.trees.some(t=>t.id===v.chopTarget.id)) {
        v.chopTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      const forestBonus = getNodeBonus(room, v.chopTarget.tx, v.chopTarget.ty, 'forest');
      const chopOutpost = getOutpostBonus(room, v.chopTarget.tx, v.chopTarget.ty);
      v.chopTimer+=dt * workSpeed(v) * forestBonus * chopOutpost;
      if (v.chopTimer>=CHOP_TIME) {
        v.chopTimer=0;
        room.wood += CHOP_YIELD;
        if (v.tier === 5 && Math.random() < 0.5) room.wood += CHOP_YIELD; // Ancient Forester: 50% double log
        gainXP(room, v);
        const {id:tid,tx:ct,ty:cty}=v.chopTarget;
        room.trees=room.trees.filter(t=>t.id!==tid);
        rebuildNavBlocked(room);
        const inAncientForest = room.resourceNodes.some(n =>
          n.type==='forest' && n.active && Math.hypot(n.tx-ct, n.ty-cty) <= n.radius
        );
        if (inAncientForest || v.tier === 5) { // Ancient Forester: always replant sapling
          const regrowMult = v.tier === 5 ? 0.5 : 1;
          room.regrowthQueue.push({ tx: ct, ty: cty, timer: REGROWTH_BASE * regrowMult * REGROWTH_MULT[getSeason(room)] });
        } else if (!room.trees.some(t=>t.tx===ct&&t.ty===cty)&&room.mapTiles[cty]&&room.mapTiles[cty][ct]===4) {
          room.mapTiles[cty][ct]=3; // GRASS
          if (room._tileChanges) room._tileChanges.push({ ty: cty, tx: ct, tile: 3 });
        }
        v.chopTarget=null; v.state='idle'; v.idleTimer=0.5+Math.random()*1.5;
      }
      continue;
    }

    if (v.state==='farming') {
      if (!v.farmTarget||!room.buildings.some(b=>b.id===v.farmTarget.id&&b.complete)) {
        v.farmTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      const _season = getSeason(room);
      const farmOutpost = getOutpostBonus(room, v.farmTarget.tx, v.farmTarget.ty);
      v.farmTimer+=dt * workSpeed(v) * FARM_SPEED[_season] * (v.farmTarget.adjacencyBonus || 1.0) * (v.farmTarget.fertility || 1) * farmOutpost;
      if (v.farmTimer>=FARM_TIME) {
        v.farmTimer=0;
        if (_season !== 3) { // winter produces no crops
          const farmBonus = getNodeBonus(room, v.farmTarget.tx, v.farmTarget.ty, 'farmland');
          const deltaBonus = getNodeBonus(room, v.farmTarget.tx, v.farmTarget.ty, 'delta');
          const soilFertility = v.farmTarget.fertility || 1.0;
          room.crops += Math.round(FARM_YIELD * Math.max(farmBonus, deltaBonus) * soilFertility);
          gainXP(room, v);
          if (v.tier === 5) { // Soil Whisperer: grow fertility and spread to adjacent farmland
            v.farmTarget.fertility = Math.min(2.0, soilFertility + 0.05);
            for (const b of room.buildings) {
              if (b.type !== 4 || !b.complete || b.id === v.farmTarget.id) continue;
              if (Math.abs(b.tx - v.farmTarget.tx) + Math.abs(b.ty - v.farmTarget.ty) <= 3)
                b.fertility = Math.min(1.5, (b.fertility || 1) + 0.02);
            }
          }
        }
        v.state='idle'; v.idleTimer=1+Math.random()*2;
      }
      continue;
    }

    if (v.state==='baking') {
      if (!v.bakeryTarget||!room.buildings.some(b=>b.id===v.bakeryTarget.id&&b.complete)) {
        v.bakeryTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      if (room.crops < BAKE_COST) {
        v.state='idle'; v.idleTimer=3+Math.random()*3; continue;
      }
      v.bakeTimer+=dt * workSpeed(v) * (v.bakeryTarget.adjacencyBonus || 1.0);
      if (v.bakeTimer>=BAKE_TIME) {
        v.bakeTimer=0; room.crops-=BAKE_COST;
        const bakeBonus = getNodeBonus(room, v.bakeryTarget.tx, v.bakeryTarget.ty, 'farmland');
        const bakeTier = v.bakeryTarget.tier || 1;
        const bakeTierMult = bakeTier === 3 ? 2.5 : bakeTier === 2 ? 1.8 : 1.0;
        const feastMult = v.tier === 5 ? 1.5 : 1.0; // Feast Keeper: 50% bonus food
        room.food += Math.round(BAKE_YIELD * bakeTierMult * (bakeBonus > 1.0 ? 1.3 : 1.0) * feastMult);
        gainXP(room, v);
        v.state='idle'; v.idleTimer=0.5+Math.random()*1.5;
      }
      continue;
    }

    if (v.state==='mining') {
      if (!v.mineTarget||!room.buildings.some(b=>b.id===v.mineTarget.id&&b.complete)) {
        v.mineTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      const mineOutpost = getOutpostBonus(room, v.mineTarget.tx, v.mineTarget.ty);
      v.mineTimer+=dt * workSpeed(v) * (v.mineTarget.adjacencyBonus || 1.0) * (v.mineTarget.mountainBonus || 1.0) * mineOutpost;
      if (v.mineTimer>=MINE_TIME) {
        v.mineTimer=0;
        const quarryBonus = getNodeBonus(room, v.mineTarget.tx, v.mineTarget.ty, 'quarry');
        const mineTier = v.mineTarget.tier || 1;
        const stoneMult = mineTier === 3 ? 2.0 : mineTier === 2 ? 1.5 : 1.0;
        if (v.tier >= 5) {
          // Ironminer: T5 stoneminers switch entirely to iron production
          room.iron += 2 + (mineTier >= 2 ? 1 : 0) + (mineTier >= 3 ? 1 : 0);
        } else {
          room.stone += Math.round(MINE_YIELD * quarryBonus * stoneMult);
          if (v.tier===3 && Math.random()<MINE_IRON_CHANCE) room.iron++;
          if (isNearIronVein(room, v.mineTarget.tx, v.mineTarget.ty)) room.iron++;
          if (mineTier === 2) room.iron++;
          if (mineTier === 3) room.iron += 3;
        }
        gainXP(room, v);
        // Vein Sense: T5 StoneMiner reveals nearby inactive resource nodes
        if (v.tier === 5) {
          for (const n of room.resourceNodes) {
            if (!n.active && Math.hypot(n.tx - v.mineTarget.tx, n.ty - v.mineTarget.ty) <= 18) {
              n.active = true;
              room.notify(`${v.name} senses a ${n.type} deposit nearby!`, 'info');
            }
          }
        }
        v.state='idle'; v.idleTimer=0.5+Math.random()*1.5;
      }
      continue;
    }

    if (v.state==='forging') {
      if (!v.forgeTarget||!room.buildings.some(b=>b.id===v.forgeTarget.id&&b.complete)) {
        v.forgeTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      let tier=-1;
      for (let t=2;t>=1;t--) {
        const cost=CRAFT_COST[t];
        if (Object.entries(cost).every(([r,n])=>({wood:room.wood,stone:room.stone,iron:room.iron,food:room.food,crops:room.crops,gold:room.gold})[r]>=n)) {
          tier=t; break;
        }
      }
      if (tier<0) { v.state='idle'; v.idleTimer=4+Math.random()*4; continue; }
      const forgeAdj = room.buildings.find(b=>b.id===v.forgeTarget.id)?.adjacencyBonus || 1.0;
      const forgeOutpost = getOutpostBonus(room, v.forgeTarget.tx, v.forgeTarget.ty);
      v.forgeTimer+=dt * forgeAdj * forgeOutpost;
      if (v.forgeTimer>=CRAFT_TIME[tier]) {
        v.forgeTimer=0;
        const cost=CRAFT_COST[tier];
        if (cost.stone) room.stone-=cost.stone;
        if (cost.iron)  room.iron -=cost.iron;
        room.toolStock[tier] += 3;
        if (v.tier === 5) room.toolStock[tier] += 3; // Runesmith: double tool output
        gainXP(room, v);
        // Runesmith: buff nearest knight with runic weapons
        if (v.tier === 5) {
          let nearest = null, bestDist = 25;
          for (const u of room.villagers) {
            if (u.role !== VROLE.KNIGHT) continue;
            const d = Math.hypot(u.x - v.x, u.y - v.y);
            if (d < bestDist) { bestDist = d; nearest = u; }
          }
          if (nearest) { nearest._runicBuff = 60; room.notify(`${v.name} runes ${nearest.name}'s weapon!`); }
        }
        v.state='idle'; v.idleTimer=1+Math.random()*2;
      }
      continue;
    }

    if (v.state === 'repairing') {
      const rb = room.buildings.find(b => b.id === v.repairTarget);
      if (!rb || !rb.complete || rb.hp >= rb.maxHp) {
        v.repairTarget = null; v.state = 'idle'; v.idleTimer = 1 + Math.random()*2;
        continue;
      }
      v.repairTimer += dt * workSpeed(v);
      if (v.repairTimer >= REPAIR_TIME) {
        v.repairTimer = 0;
        if (room.stone >= REPAIR_STONE) {
          room.stone -= REPAIR_STONE;
          rb.hp = Math.min(rb.maxHp, rb.hp + REPAIR_RATE);
          gainXP(room, v);
        }
      }
      continue;
    }

    if (v.state === 'guarding') {
      if (!room.buildings.some(b=>b.id===v.towerTarget&&b.complete&&b.type===3)) {
        v.state='idle'; v.idleTimer=1; v.towerTarget=null;
      }
      if (isNight(room) && !v._goingSleep) {
        const house=findNearestHouse(room, v);
        if (house) {
          const path=findPathCached(room,v,house.tx,house.ty,room.villagerBlocked);
          if (path&&path.length>1) { v.path=path.slice(1); v.state='moving'; v._goingSleep=true; v._sleepTarget={tx:house.tx,ty:house.ty}; }
        }
      }
      continue;
    }

    if (v.state==='building') {
      const bld=room.buildings.find(b=>b.id===v.buildTarget);
      if (!bld||bld.complete) {
        v.buildTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
      } else {
        bld.progress=Math.min(1, bld.progress+(1/STRUCT_BUILD_TIME[bld.type])*dt*workSpeed(v));
        if (bld.progress>=1) {
          bld.complete=true; bld.assignedBuilders=[];
          rebuildNavBlocked(room);
          calcAdjacencyBonus(room, bld);
          updateNeighborBonuses(room, bld.tx, bld.ty);
          if (bld.type === 9) {
            activateOutpostNodes(room, bld);
            updateNeighborBonuses(room, bld.tx, bld.ty, 6); // supply lines reach 6 tiles
          }
          if (v.tier === 5) { bld.maxHp = Math.round(bld.maxHp * 1.2); bld.hp = bld.maxHp; } // Master Mason
          v.buildTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
          gainXP(room, v);
        }
      }
      continue;
    }

    if (isNight(room) && !v._goingSleep && (v.state==='idle'||v.state==='roaming')
        && !(v.role===VROLE.KNIGHT && room.alertMode)) {
      const house=findNearestHouse(room, v);
      if (house) {
        if (v.tx===house.tx&&v.ty===house.ty) {
          v.state='sleeping'; v._goingSleep=false;
          continue;
        }
        const path=findPathCached(room,v,house.tx,house.ty,room.villagerBlocked);
        if (path&&path.length>1) {
          v.path=path.slice(1); v.state='moving'; v._goingSleep=true; v._sleepTarget={tx:house.tx,ty:house.ty};
        }
      } else {
        v.tired=Math.min(1, v.tired+TIRED_RATE*dt);
      }
    }

    if (v.role===VROLE.KNIGHT && v.state==='sleeping') {
      const bar=room.buildings.find(b=>b.type===6&&b.complete);
      if (bar) {
        v._barracksTrain=(v._barracksTrain||0)+dt;
        if (v._barracksTrain>=30) { v._barracksTrain=0; gainXP(room, v); }
      }
    }

    if (v.role===VROLE.BASIC&&v.upgradeTimer!==null&&room.settled) {
      v.upgradeTimer-=dt;
      if (v.upgradeTimer<=0) upgradeBasicVillager(room, v);
    }

    if (v.state==='training') {
      if (v._trainingBuilding != null) {
        const tb = room.buildings.find(b => b.id === v._trainingBuilding);
        if (!tb) { v._trainingBuilding = null; }
        else {
          const dist = Math.abs(Math.floor(v.x) - tb.tx) + Math.abs(Math.floor(v.y) - tb.ty);
          if (dist > 1) {
            if (!v.path || v.path.length === 0) {
              const p = findPath(Math.floor(v.x), Math.floor(v.y), tb.tx, tb.ty, room.villagerBlocked, room, 300);
              if (p && p.length > 1) v.path = p.slice(1);
            }
          } else {
            v._trainingBuilding = null;
          }
          if (v._trainingBuilding != null) {
            // still walking — fall through to movement
          } else {
            continue;
          }
        }
      }
      if (v._trainingBuilding == null && v._trainingTimer != null) {
        v._trainingTimer -= dt;
        if (v._trainingTimer <= 0) {
          v.role = v._trainingRole;
          v._trainingRole = null;
          v._trainingTimer = null;
          v.state = 'idle';
          v.idleTimer = 1;
          v.upgradeTimer = null;
          room.notify(`${v.name} finished training as ${v.role}!`);
        }
        continue;
      }
    }

    if (v.state==='idle') {
      v.idleTimer-=dt;
      if (v.idleTimer<=0) {
        if (v._pfSlot % 3 !== room._pfRound % 3) {
          v.idleTimer = 0.05; // stagger: defer to next designated tick (~100-200ms)
        } else {
          startRoam(room, v);
        }
      }
    }

    } // end else (non-possessed state machine)

    // Follow path
    if (v.path.length>0) {
      const tgt=v.path[0];
      const wtx=tgt.x+0.5, wty=tgt.y+0.5;
      const dx=wtx-v.x, dy=wty-v.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const onRoad = room.roadTiles.has(tgt.y * MAP_W + tgt.x);
      const baseSpd = onRoad ? VILLAGER_SPEED * 1.6 : VILLAGER_SPEED;
      const spd = (v.tired>0.5&&!v._goingSleep) ? baseSpd*0.5 : baseSpd;
      if (dist<=spd*dt+0.01) {
        const _remainDt = dist < 0.001 ? dt : dt - dist / spd;
        v.x=wtx; v.y=wty; v.tx=tgt.x; v.ty=tgt.y;
        v._stuckTimer=0;
        v.path.shift();
        if (v.path.length===0) {
          if (v.buildTarget!==null) {
            const bld=room.buildings.find(b=>b.id===v.buildTarget);
            if (bld&&!bld.complete&&v.tx===bld.tx&&v.ty===bld.ty) {
              v.state='building';
              if (!bld.assignedBuilders.includes(v.id)) bld.assignedBuilders.push(v.id);
            } else {
              v.buildTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.chopTarget!==null) {
            const {id:tid,tx:ct,ty:cty}=v.chopTarget;
            if (v.tx===ct&&v.ty===cty&&room.trees.some(t=>t.id===tid)) {
              v.state='chopping'; v.chopTimer=0;
            } else {
              v.chopTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.farmTarget!==null) {
            const fb=room.buildings.find(b=>b.id===v.farmTarget.id);
            if (fb&&fb.complete&&v.tx===fb.tx&&v.ty===fb.ty) {
              v.state='farming'; v.farmTimer=0;
            } else {
              v.farmTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.bakeryTarget!==null) {
            const bb=room.buildings.find(b=>b.id===v.bakeryTarget.id);
            if (bb&&bb.complete&&v.tx===bb.tx&&v.ty===bb.ty) {
              v.state='baking'; v.bakeTimer=0;
            } else {
              v.bakeryTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.mineTarget!==null) {
            const mb=room.buildings.find(b=>b.id===v.mineTarget.id);
            if (mb&&mb.complete&&v.tx===mb.tx&&v.ty===mb.ty) {
              v.state='mining'; v.mineTimer=0;
            } else {
              v.mineTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.forgeTarget!==null) {
            const fb2=room.buildings.find(b=>b.id===v.forgeTarget.id);
            if (fb2&&fb2.complete&&v.tx===fb2.tx&&v.ty===fb2.ty) {
              v.state='forging'; v.forgeTimer=0;
            } else {
              v.forgeTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.repairTarget!==null) {
            const rb=room.buildings.find(b=>b.id===v.repairTarget);
            if (rb&&rb.complete&&v.tx===rb.tx&&v.ty===rb.ty&&rb.hp<rb.maxHp) {
              v.state='repairing'; v.repairTimer=0;
            } else {
              v.repairTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v._seekBakery != null) {
            if (room.food > 0) { room.food=Math.max(0,room.food-1); v.hunger=Math.min(1,v.hunger+FEED_RESTORE); }
            v._seekBakery = null;
            v.state='idle'; v.idleTimer=0.5+Math.random()*0.5;
          } else if (v._seekForge != null) {
            v.toolTier = v._seekForge.tier;
            v._seekForge = null;
            v.state='idle'; v.idleTimer=0.3;
          } else if (v._goingSleep) {
            v._goingSleep=false; v._sleepTarget=null; v.state='sleeping';
          } else {
            v.state='idle'; v.idleTimer=1.5+Math.random()*4;
          }
        }
        // Use remaining dt to continue toward next waypoint — eliminates per-tile stutter
        if (v.path.length > 0 && _remainDt > 0.001) {
          const nxt = v.path[0];
          const ndx = nxt.x+0.5 - v.x, ndy = nxt.y+0.5 - v.y;
          const nd = Math.sqrt(ndx*ndx + ndy*ndy);
          if (nd > 0) { const mv = Math.min(nd, spd * _remainDt); v.x += ndx/nd * mv; v.y += ndy/nd * mv; }
        }
      } else {
        v.x+=dx*spd*dt/dist; v.y+=dy*spd*dt/dist;
        v._stuckTimer += dt;
        if (v._stuckTimer > 2.5) {
          v.path=[]; v.state='idle'; v.idleTimer=0.5+Math.random()*1.5;
          v._stuckTimer=0;
        }
      }
    }
  }

  // Separation
  for (let i=0; i<room.villagers.length; i++) {
    for (let j=i+1; j<room.villagers.length; j++) {
      const a=room.villagers[i], b=room.villagers[j];
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

  if (room.villagers.some(v=>v._despawn)) {
    room.villagers=room.villagers.filter(v=>!v._despawn);
  }
}

// Initialise a Kingdom's per-player state and spawn starting villagers near (cx, cy).
// Trees and world data are already on the GameRoom — don't regenerate them here.
export function initKingdom(kingdom, cx, cy) {
  kingdom._usedNames  = new Set();
  kingdom.villagers   = [];
  kingdom.buildings   = [];
  kingdom._bid        = 0;
  kingdom.buildCounts.fill(0);
  kingdom.fogVisible.fill(0);
  kingdom.fogExplored.fill(0);
  kingdom.gold=100; kingdom.wood=0; kingdom.food=20;
  kingdom.crops=0;  kingdom.stone=0; kingdom.iron=0;
  kingdom.toolStock=[999,0,0];
  kingdom.npcs=[]; kingdom._npcId=0; kingdom.npcVisitTimer=0; kingdom.npcModal=null;
  kingdom.enemyUnits=[]; kingdom.projectiles=[];
  kingdom.gameState='playing'; kingdom.alertMode=false;
  kingdom._defendRerouteTimer=0;
  kingdom.settled=false; kingdom.townCenter=null;
  kingdom.roadTiles=new Set();
  kingdom.bandits=[]; kingdom._banditId=0; kingdom._banditSpawnTimer=0;
  rebuildNavBlocked(kingdom);

  // BFS from (cx, cy) to find nearby walkable spots
  const visited = new Uint8Array(MAP_W * MAP_H);
  const queue   = [(cy | 0) * MAP_W + (cx | 0)];
  visited[queue[0]] = 1;
  const spots = [];
  while (queue.length && spots.length < 40) {
    const idx = queue.shift();
    const x = idx % MAP_W, y = (idx / MAP_W) | 0;
    if (WALKABLE_TILES.has(kingdom.mapTiles[y][x]) && !kingdom.villagerBlocked[idx]) spots.push({ x, y });
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x+dx, ny = y+dy;
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (!visited[ni] && WALKABLE_TILES.has(kingdom.mapTiles[ny][nx])) { visited[ni]=1; queue.push(ni); }
    }
  }
  const chosen = [];
  for (const s of spots) {
    if (chosen.length >= 6) break;
    if (chosen.every(c => Math.abs(c.x - s.x) + Math.abs(c.y - s.y) >= 3)) chosen.push(s);
  }
  const roles = [VROLE.WOODCUTTER, VROLE.WOODCUTTER, VROLE.BUILDER, VROLE.KNIGHT, VROLE.FARMER, VROLE.BASIC];
  for (let i = 0; i < roles.length && i < chosen.length; i++)
    kingdom.villagers.push(mkVillager(kingdom, roles[i], chosen[i].x, chosen[i].y));
  kingdom.spawnTimer = 0; kingdom.goldTimer = 0; kingdom.feedTimer = 0;
  kingdom.navBlockedVersion = 0; kingdom._pfRound = 0; kingdom._pfCounter = 0;
}

// Legacy single-player entry point (generates trees + inits one kingdom at map centre)
export function spawnVillagers(room) {
  room.regrowthQueue = [];
  generateTrees(room);
  initKingdom(room, MAP_W >> 1, MAP_H >> 1);
  room.dayTime = 0.3; room.day = 1;
  room.enemyKingdoms = []; room._nextKingdomTimer = 0; room._totalWaves = 0;
}

export function updateSpawning(room, dt) {
  if (!room.settled) return;
  if (!room.ws) return; // no new villagers while player is offline
  const cap = getPopCap(room);
  if (cap === 0 || room.villagers.length >= cap) return;
  room.spawnTimer += dt;
  if (room.spawnTimer < SPAWN_INTERVAL) return;
  room.spawnTimer = 0;
  const cx=room.townCenter.tx, cy=room.townCenter.ty;
  for (let a=0; a<30; a++) {
    const tx=cx+Math.round((Math.random()*2-1)*8);
    const ty=cy+Math.round((Math.random()*2-1)*8);
    if (tx<0||tx>=MAP_W||ty<0||ty>=MAP_H) continue;
    if (!WALKABLE_TILES.has(room.mapTiles[ty][tx])) continue;
    if (room.villagerBlocked[ty*MAP_W+tx]) continue;
    if (room.villagers.some(u=>u.tx===tx&&u.ty===ty)) continue;
    const spawnRole = Math.random() < 0.02 ? VROLE.EXPLORER : VROLE.BASIC;
    const nv = mkVillager(room, spawnRole, tx, ty);
    nv.idleTimer = Math.random()*2;
    if (spawnRole === VROLE.EXPLORER) { nv.upgradeTimer = null; room.notify(`${nv.name} arrived as an Explorer!`); }
    room.villagers.push(nv);
    return;
  }
}

export function updateGold(room, dt) {
  if (!room.settled) return;
  room.goldTimer += dt;
  if (room.goldTimer < GOLD_TICK) return;
  room.goldTimer = 0;
  room.gold += room.villagers.length;
}

export function updateFeeding(room, dt) {
  if (!room.settled) return;
  room.feedTimer += dt;
  if (room.feedTimer < FEED_TICK) return;
  room.feedTimer = 0;
  const hasFeastKeeper = room.villagers.some(v => v.role === VROLE.BAKER && v.tier === 5);
  for (const v of room.villagers) {
    if (room.food <= 0) break;
    room.food--;
    v.hunger = Math.min(1.0, v.hunger + FEED_RESTORE * (hasFeastKeeper ? 1.5 : 1.0));
  }
}

export function moveVillagerTo(room, v, tx, ty) {
  if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return false;
  if (!WALKABLE_TILES.has(room.mapTiles[ty][tx])) return false;
  const stx = Math.floor(v.x), sty = Math.floor(v.y);
  const blocked = v.role === VROLE.EXPLORER ? room.navBlocked : room.villagerBlocked;
  let path = findPath(stx, sty, tx, ty, blocked, room);
  if (!path || path.length < 2) {
    const bfsVis = new Uint8Array(MAP_W * MAP_H);
    const bfsQ = [];
    const si = sty * MAP_W + stx;
    bfsVis[si] = 1; bfsQ.push(si);
    let bestIdx = -1, bestDist = Infinity;
    for (let qi = 0; qi < bfsQ.length; qi++) {
      const idx = bfsQ[qi];
      const bx = idx % MAP_W, by = (idx / MAP_W) | 0;
      const d = Math.hypot(bx - tx, by - ty);
      if (d < bestDist) { bestDist = d; bestIdx = idx; }
      for (const [dx2, dy2] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = bx + dx2, ny = by + dy2;
        if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        if (bfsVis[ni] || !WALKABLE_TILES.has(room.mapTiles[ny][nx]) || blocked[ni]) continue;
        bfsVis[ni] = 1; bfsQ.push(ni);
      }
    }
    if (bestIdx < 0 || bestIdx === si) return false;
    path = findPath(stx, sty, bestIdx % MAP_W, (bestIdx / MAP_W) | 0, blocked, room);
  }
  if (!path || path.length < 2) return false;
  v.path = path.slice(1);
  v.state = 'moving';
  return true;
}

function _hasPrereq(room, newRole) {
  const reqType = UPGRADE_PREREQ[newRole];
  if (reqType === undefined) return true;
  return room.buildings.some(b => b.type === reqType && b.complete);
}

export function upgradeBasicTo(room, v, newRole) {
  if (room.gold < 20) return false;
  if (!_hasPrereq(room, newRole)) return false;
  room.gold -= 20;
  v.state = 'training';
  v._trainingRole = newRole;
  v._trainingTimer = TRAIN_TIME;
  v.upgradeTimer = null;
  const reqType = UPGRADE_PREREQ[newRole];
  const tb = (reqType !== undefined) ? room.buildings.find(b => b.type === reqType && b.complete) : null;
  v._trainingBuilding = tb ? tb.id : null;
  v.path = [];
  return true;
}
