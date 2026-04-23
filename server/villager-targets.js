// ── server/game/villager-targets.js ──
import { MAP_W, MAP_H, ROAM_RADIUS, VROLE } from './constants.js';
import { WALKABLE_TILES, findPath } from './world.js';
import { withinTerritory, findBuildTarget, assignBuilderTo, getTerritoryRadius } from './buildings.js';

// Cached path lookup: reuses last computed path when src+dest+navVersion all match.
export function findPathCached(room, v, tx, ty, blocked, maxExpand = 300) {
  const c = v._pathCache;
  if (c && c.destTx === tx && c.destTy === ty &&
      c.srcTx === v.tx && c.srcTy === v.ty &&
      c.navVer === room.navBlockedVersion) {
    return c.path && c.path.length > 1 ? c.path.slice() : null;
  }
  const path = findPath(v.tx, v.ty, tx, ty, blocked, room, maxExpand);
  v._pathCache = path
    ? { destTx: tx, destTy: ty, srcTx: v.tx, srcTy: v.ty, navVer: room.navBlockedVersion, path }
    : null;
  return path;
}

export function findMineTarget(room, miner) {
  const claimed = new Set(
    room.villagers.filter(v => v.mineTarget && v.id !== miner.id).map(v => v.mineTarget.id)
  );
  let best = null, bestDist = Infinity;
  for (const b of room.buildings) {
    if (b.type !== 5 || !b.complete) continue;
    if (claimed.has(b.id)) continue;
    const d = Math.abs(b.tx - miner.tx) + Math.abs(b.ty - miner.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

export function findTowerTarget(room, archer) {
  const claimed = new Set(
    room.villagers.filter(v => v.towerTarget != null && v.id !== archer.id).map(v => v.towerTarget)
  );
  let best = null, bestDist = Infinity;
  for (const b of room.buildings) {
    if (b.type !== 3 || !b.complete) continue;
    if (claimed.has(b.id)) continue;
    const d = Math.abs(b.tx - archer.tx) + Math.abs(b.ty - archer.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

export function findForgeTarget(room, smith) {
  const claimed = new Set(
    room.villagers.filter(v => v.forgeTarget && v.id !== smith.id).map(v => v.forgeTarget.id)
  );
  let best = null, bestDist = Infinity;
  for (const b of room.buildings) {
    if (b.type !== 7 || !b.complete) continue;
    if (claimed.has(b.id)) continue;
    const d = Math.abs(b.tx - smith.tx) + Math.abs(b.ty - smith.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

export function doRoam(room, v) {
  const bfsVis = new Uint8Array(MAP_W * MAP_H);
  const bfsQ = [];
  const si = v.ty * MAP_W + v.tx;
  bfsVis[si] = 1;
  bfsQ.push(si);
  const candidates = [];
  for (let qi = 0; qi < bfsQ.length; qi++) {
    const idx = bfsQ[qi];
    const bx = idx % MAP_W, by = (idx / MAP_W) | 0;
    const dist = Math.abs(bx - v.tx) + Math.abs(by - v.ty);
    if (dist >= 1) {
      const inTerritory = !room.settled || !room.townCenter || v.role === VROLE.WOODCUTTER || withinTerritory(room, bx, by);
      if (inTerritory) candidates.push(idx);
    }
    if (dist >= ROAM_RADIUS) continue;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = bx + dx, ny = by + dy;
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (bfsVis[ni] || !WALKABLE_TILES.has(room.mapTiles[ny][nx]) || room.villagerBlocked[ni]) continue;
      bfsVis[ni] = 1;
      bfsQ.push(ni);
    }
  }
  if (candidates.length > 0) {
    const destIdx = candidates[Math.floor(Math.random() * candidates.length)];
    const dx = destIdx % MAP_W, dy = (destIdx / MAP_W) | 0;
    const path = findPath(v.tx, v.ty, dx, dy, room.villagerBlocked, room, 200);
    if (path && path.length > 1) {
      v.path = path.slice(1); v.state = 'roaming';
      return;
    }
  }
  v.state = 'idle'; v.idleTimer = 1 + Math.random() * 2;
}

export function findChopTarget(room, cutter) {
  const claimedIds = new Set(
    room.villagers.filter(v=>v.chopTarget&&v.id!==cutter.id).map(v=>v.chopTarget.id)
  );
  let best=null, bestDist=Infinity;
  for (const tree of room.trees) {
    if (claimedIds.has(tree.id)) continue;
    const d=Math.abs(tree.tx-cutter.tx)+Math.abs(tree.ty-cutter.ty);
    if (d>20) continue;
    if (d<bestDist) { bestDist=d; best=tree; }
  }
  return best;
}

export function findFarmTarget(room, farmer) {
  const claimed = new Set(
    room.villagers.filter(v=>v.farmTarget&&v.id!==farmer.id).map(v=>v.farmTarget.id)
  );
  for (const b of room.buildings) {
    if (b.type!==4||!b.complete) continue;
    if (claimed.has(b.id)) continue;
    return b;
  }
  return null;
}

export function findBakeryTarget(room, baker) {
  const claimed = new Set(
    room.villagers.filter(v=>v.bakeryTarget&&v.id!==baker.id).map(v=>v.bakeryTarget.id)
  );
  for (const b of room.buildings) {
    if (b.type!==1||!b.complete) continue;
    if (claimed.has(b.id)) continue;
    return b;
  }
  return null;
}

export function startRoam(room, v) {
  // Hunger: seek nearest bakery
  if (v.hunger < 0.5 && v._seekBakery == null) {
    const bakery = room.buildings.find(b => b.type===1 && b.complete);
    if (bakery && room.food > 0) {
      v._seekBakery = bakery.id;
      if (v.tx===bakery.tx && v.ty===bakery.ty) {
        room.food = Math.max(0, room.food-1);
        v.hunger = Math.min(1, v.hunger + 0.35); // FEED_RESTORE
        v._seekBakery = null;
        v.state='idle'; v.idleTimer=0.5+Math.random()*0.5;
        return;
      }
      const path = findPathCached(room, v, bakery.tx, bakery.ty, room.villagerBlocked);
      if (path && path.length > 1) {
        v.path=path.slice(1); v.state='moving';
        return;
      }
      v._seekBakery = null;
    }
  }

  // Tool upgrade: seek forge
  if (room._TOOL_ROLES.has(v.role) && v._seekForge == null) {
    let wantTier = -1;
    for (let t=2; t>v.toolTier; t--) { if (room.toolStock[t]>0) { wantTier=t; break; } }
    if (wantTier > 0) {
      const forge = room.buildings.find(b => b.type===7 && b.complete);
      if (forge) {
        room.toolStock[wantTier]--;
        v._seekForge = { id: forge.id, tier: wantTier };
        if (v.tx===forge.tx && v.ty===forge.ty) {
          v.toolTier = wantTier; v._seekForge = null;
          v.state='idle'; v.idleTimer=0.3;
          return;
        }
        const path = findPathCached(room, v, forge.tx, forge.ty, room.villagerBlocked);
        if (path && path.length > 1) {
          v.path=path.slice(1); v.state='moving';
          return;
        }
        room.toolStock[wantTier]++;
        v._seekForge = null;
      }
    }
  }

  if (v.role===VROLE.BUILDER) {
    const bld=findBuildTarget(room, v);
    if (bld) { assignBuilderTo(room, v, bld); return; }
    doRoam(room, v); return;
  }
  if (v.role===VROLE.KNIGHT && room.settled && room.townCenter) {
    if (room.alertMode && room.enemyUnits.length) {
      const DEFEND_RADIUS = 8;
      const tcX = room.townCenter.tx + 0.5, tcY = room.townCenter.ty + 0.5;
      let nearest = null, nearDist = Infinity;
      for (const eu of room.enemyUnits) {
        if (eu._despawn) continue;
        const d = Math.hypot(eu.x - v.x, eu.y - v.y);
        if (d < nearDist) { nearDist = d; nearest = eu; }
      }
      if (nearest) {
        const edx = nearest.x - tcX, edy = nearest.y - tcY;
        const eDist = Math.hypot(edx, edy);
        let tgtX, tgtY;
        if (eDist <= DEFEND_RADIUS) {
          tgtX = nearest.x; tgtY = nearest.y;
        } else {
          tgtX = tcX + (edx / eDist) * DEFEND_RADIUS;
          tgtY = tcY + (edy / eDist) * DEFEND_RADIUS;
        }
        const path = findPath(v.tx, v.ty, Math.floor(tgtX), Math.floor(tgtY), room.villagerBlocked, room, 200);
        if (path && path.length > 1) {
          v.path = path.slice(1); v.state = 'moving'; v._goingSleep = false;
          return;
        }
      }
    }
    const PATROL_RADIUS = 12;
    for (let tries=0; tries<8; tries++) {
      v.patrolAngle += (Math.PI/3) + Math.random()*(Math.PI/3);
      const r = PATROL_RADIUS + (Math.random()*4-2);
      const ptx = Math.round(room.townCenter.tx + Math.cos(v.patrolAngle)*r);
      const pty = Math.round(room.townCenter.ty + Math.sin(v.patrolAngle)*r);
      if (ptx<0||ptx>=MAP_W||pty<0||pty>=MAP_H) continue;
      if (!WALKABLE_TILES.has(room.mapTiles[pty][ptx])) continue;
      if (room.villagerBlocked[pty*MAP_W+ptx]) continue;
      const path=findPath(v.tx,v.ty,ptx,pty,room.villagerBlocked,room, 200);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='patrolling';
        return;
      }
    }
  }
  if (v.role===VROLE.STONE_MINER) {
    const mine=findMineTarget(room, v);
    if (mine) {
      v.mineTarget=mine;
      if (v.tx===mine.tx&&v.ty===mine.ty) { v.state='mining'; v.mineTimer=0; return; }
      const path=findPathCached(room, v, mine.tx, mine.ty, room.villagerBlocked);
      if (path&&path.length>1) { v.path=path.slice(1); v.state='moving'; return; }
      v.mineTarget=null;
    }
    doRoam(room, v); return;
  }
  if (v.role === VROLE.ARCHER) {
    const tower = findTowerTarget(room, v);
    if (tower) {
      if (v.tx===tower.tx&&v.ty===tower.ty) {
        v.state='guarding'; v.towerTarget=tower.id;
        return;
      }
      const path=findPathCached(room, v, tower.tx, tower.ty, room.villagerBlocked);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='moving'; v.towerTarget=tower.id;
        return;
      }
    }
    doRoam(room, v); return;
  }
  if (v.role===VROLE.TOOLSMITH) {
    const forge=findForgeTarget(room, v);
    if (forge) {
      v.forgeTarget=forge;
      if (v.tx===forge.tx&&v.ty===forge.ty) { v.state='forging'; v.forgeTimer=0; return; }
      const path=findPathCached(room, v, forge.tx, forge.ty, room.villagerBlocked);
      if (path&&path.length>1) { v.path=path.slice(1); v.state='moving'; return; }
      v.forgeTarget=null;
    }
    doRoam(room, v); return;
  }
  if (v.role === VROLE.MECHANIC && room.settled) {
    const claimedRepair = new Set(
      room.villagers.filter(o => o.repairTarget != null && o.id !== v.id).map(o => o.repairTarget)
    );
    let worst = null, worstPct = 1.0;
    for (const b of room.buildings) {
      if (!b.complete || b.hp >= b.maxHp) continue;
      if (!withinTerritory(room, b.tx, b.ty)) continue;
      if (claimedRepair.has(b.id)) continue;
      const pct = b.hp / b.maxHp;
      if (pct < worstPct) { worstPct = pct; worst = b; }
    }
    if (worst) {
      v.repairTarget = worst.id;
      if (v.tx === worst.tx && v.ty === worst.ty) {
        v.state = 'repairing'; v.repairTimer = 0;
        return;
      }
      const path = findPathCached(room, v, worst.tx, worst.ty, room.villagerBlocked);
      if (path && path.length > 1) {
        v.path = path.slice(1); v.state = 'moving';
        return;
      }
      v.repairTarget = null;
    }
    doRoam(room, v); return;
  }
  if (v.role===VROLE.BAKER) {
    const bakery=findBakeryTarget(room, v);
    if (bakery) {
      v.bakeryTarget=bakery;
      if (v.tx===bakery.tx&&v.ty===bakery.ty) {
        v.state='baking'; v.bakeTimer=0;
        return;
      }
      const path=findPathCached(room, v, bakery.tx, bakery.ty, room.villagerBlocked);
      if(path&&path.length>1) {
        v.path=path.slice(1); v.state='moving';
        return;
      }
      v.bakeryTarget=null;
    }
    doRoam(room, v); return;
  }
  if (v.role===VROLE.WOODCUTTER) {
    const tgt=findChopTarget(room, v);
    if (tgt) {
      v.chopTarget=tgt;
      const path=findPathCached(room, v, tgt.tx, tgt.ty, room.villagerBlocked);
      if (path&&path.length>0) {
        if (path.length===1) { v.state='chopping'; v.chopTimer=0; }
        else { v.path=path.slice(1); v.state='moving'; }
        return;
      }
      v.chopTarget=null;
    }
    doRoam(room, v); return;
  }
  if (v.role===VROLE.FARMER) {
    const farm=findFarmTarget(room, v);
    if (farm) {
      v.farmTarget=farm;
      if (v.tx===farm.tx&&v.ty===farm.ty) {
        v.state='farming'; v.farmTimer=0;
        return;
      }
      const path=findPathCached(room, v, farm.tx, farm.ty, room.villagerBlocked);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='moving';
        return;
      }
      v.farmTarget=null;
    }
    doRoam(room, v); return;
  }
  doRoam(room, v);
}
