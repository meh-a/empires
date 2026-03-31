// ── villager-targets.js ──

function withinTerritory(tx, ty) {
  if (!settled || !townCenter) return true;
  const dx = tx - townCenter.tx, dy = ty - townCenter.ty;
  return Math.sqrt(dx*dx + dy*dy) <= getTerritoryRadius();
}

function findMineTarget(miner) {
  const claimed = new Set(
    villagers.filter(v => v.mineTarget && v.id !== miner.id).map(v => v.mineTarget.id)
  );
  let best = null, bestDist = Infinity;
  for (const b of buildings) {
    if (b.type !== 5 || !b.complete) continue;
    if (claimed.has(b.id)) continue;
    const d = Math.abs(b.tx - miner.tx) + Math.abs(b.ty - miner.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

function findTowerTarget(archer) {
  const claimed = new Set(
    villagers.filter(v => v.towerTarget != null && v.id !== archer.id).map(v => v.towerTarget)
  );
  let best = null, bestDist = Infinity;
  for (const b of buildings) {
    if (b.type !== 3 || !b.complete) continue;
    if (claimed.has(b.id)) continue;
    const d = Math.abs(b.tx - archer.tx) + Math.abs(b.ty - archer.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

function findForgeTarget(smith) {
  const claimed = new Set(
    villagers.filter(v => v.forgeTarget && v.id !== smith.id).map(v => v.forgeTarget.id)
  );
  let best = null, bestDist = Infinity;
  for (const b of buildings) {
    if (b.type !== 7 || !b.complete) continue;
    if (claimed.has(b.id)) continue;
    const d = Math.abs(b.tx - smith.tx) + Math.abs(b.ty - smith.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

function doRoam(v) {
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
      const inTerritory = !settled || !townCenter || v.role === VROLE.WOODCUTTER || withinTerritory(bx, by);
      if (inTerritory) candidates.push(idx);
    }
    if (dist >= ROAM_RADIUS) continue;
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nx = bx + dx, ny = by + dy;
      if (nx < 0 || nx >= MAP_W || ny < 0 || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (bfsVis[ni] || !WALKABLE_TILES.has(mapTiles[ny][nx]) || villagerBlocked[ni]) continue;
      bfsVis[ni] = 1;
      bfsQ.push(ni);
    }
  }
  if (candidates.length > 0) {
    const destIdx = candidates[Math.floor(Math.random() * candidates.length)];
    const dx = destIdx % MAP_W, dy = (destIdx / MAP_W) | 0;
    const path = findPath(v.tx, v.ty, dx, dy, villagerBlocked);
    if (path && path.length > 1) {
      v.path = path.slice(1); v.state = 'roaming';
      if (v.selected) updateVillagerPanel();
      return;
    }
  }
  v.state = 'idle'; v.idleTimer = 1 + Math.random() * 2;
}

function startRoam(v) {
  // ── Hunger: seek nearest bakery ──────────────────────────────────
  if (v.hunger < 0.5 && v._seekBakery == null) {
    const bakery = buildings.find(b => b.type===1 && b.complete);
    if (bakery && food > 0) {
      v._seekBakery = bakery.id;
      if (v.tx===bakery.tx && v.ty===bakery.ty) {
        food = Math.max(0, food-1);
        v.hunger = Math.min(1, v.hunger + FEED_RESTORE);
        v._seekBakery = null;
        v.state='idle'; v.idleTimer=0.5+Math.random()*0.5;
        if (v.selected) updateVillagerPanel();
        return;
      }
      const path = findPath(v.tx, v.ty, bakery.tx, bakery.ty, villagerBlocked);
      if (path && path.length > 1) {
        v.path=path.slice(1); v.state='moving';
        if (v.selected) updateVillagerPanel();
        return;
      }
      v._seekBakery = null;
    }
  }

  // ── Tool upgrade: seek forge to collect better tools ─────────────
  if (TOOL_ROLES.has(v.role) && v._seekForge == null) {
    let wantTier = -1;
    for (let t=2; t>v.toolTier; t--) { if (toolStock[t]>0) { wantTier=t; break; } }
    if (wantTier > 0) {
      const forge = buildings.find(b => b.type===7 && b.complete);
      if (forge) {
        toolStock[wantTier]--; // reserve immediately so other villagers don't grab the same one
        v._seekForge = { id: forge.id, tier: wantTier };
        if (v.tx===forge.tx && v.ty===forge.ty) {
          v.toolTier = wantTier; v._seekForge = null;
          v.state='idle'; v.idleTimer=0.3;
          if (v.selected) updateVillagerPanel();
          return;
        }
        const path = findPath(v.tx, v.ty, forge.tx, forge.ty, villagerBlocked);
        if (path && path.length > 1) {
          v.path=path.slice(1); v.state='moving';
          if (v.selected) updateVillagerPanel();
          return;
        }
        toolStock[wantTier]++; // pathfinding failed — refund reservation
        v._seekForge = null;
      }
    }
  }

  // Builders prioritise construction sites
  if (v.role===VROLE.BUILDER) {
    const bld=findBuildTarget(v);
    if (bld) { assignBuilderTo(v,bld); return; }
    doRoam(v); return;
  }
  // Knights: intercept enemies near town center during a raid, otherwise patrol
  if (v.role===VROLE.KNIGHT && settled && townCenter) {
    if (alertMode && enemyUnits.length) {
      const DEFEND_RADIUS = 8;
      const tcX = townCenter.tx + 0.5, tcY = townCenter.ty + 0.5;
      let nearest = null, nearDist = Infinity;
      for (const eu of enemyUnits) {
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
        const path = findPath(v.tx, v.ty, Math.floor(tgtX), Math.floor(tgtY), villagerBlocked);
        if (path && path.length > 1) {
          v.path = path.slice(1); v.state = 'moving'; v._goingSleep = false;
          if (v.selected) updateVillagerPanel();
          return;
        }
      }
    }
    for (let tries=0; tries<8; tries++) {
      v.patrolAngle += (Math.PI/3) + Math.random()*(Math.PI/3);
      const r = PATROL_RADIUS + (Math.random()*4-2);
      const ptx = Math.round(townCenter.tx + Math.cos(v.patrolAngle)*r);
      const pty = Math.round(townCenter.ty + Math.sin(v.patrolAngle)*r);
      if (ptx<0||ptx>=MAP_W||pty<0||pty>=MAP_H) continue;
      if (!WALKABLE_TILES.has(mapTiles[pty][ptx])) continue;
      if (villagerBlocked[pty*MAP_W+ptx]) continue;
      const path=findPath(v.tx,v.ty,ptx,pty,villagerBlocked);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='patrolling';
        if (v.selected) updateVillagerPanel();
        return;
      }
    }
  }
  // Stone Miners seek nearest unclaimed complete Mine
  if (v.role===VROLE.STONE_MINER) {
    const mine=findMineTarget(v);
    if (mine) {
      v.mineTarget=mine;
      if (v.tx===mine.tx&&v.ty===mine.ty) { v.state='mining'; v.mineTimer=0; if (v.selected) updateVillagerPanel(); return; }
      const path=findPath(v.tx,v.ty,mine.tx,mine.ty,villagerBlocked);
      if (path&&path.length>1) { v.path=path.slice(1); v.state='moving'; if (v.selected) updateVillagerPanel(); return; }
      v.mineTarget=null;
    }
    doRoam(v); return;
  }
  // Archers seek nearest unclaimed complete Tower
  if (v.role === VROLE.ARCHER) {
    const tower = findTowerTarget(v);
    if (tower) {
      if (v.tx===tower.tx&&v.ty===tower.ty) {
        v.state='guarding'; v.towerTarget=tower.id;
        if (v.selected) updateVillagerPanel();
        return;
      }
      const path=findPath(v.tx,v.ty,tower.tx,tower.ty,villagerBlocked);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='moving'; v.towerTarget=tower.id;
        if (v.selected) updateVillagerPanel();
        return;
      }
    }
    doRoam(v); return;
  }

  // Toolsmiths seek nearest unclaimed complete Forge
  if (v.role===VROLE.TOOLSMITH) {
    const forge=findForgeTarget(v);
    if (forge) {
      v.forgeTarget=forge;
      if (v.tx===forge.tx&&v.ty===forge.ty) { v.state='forging'; v.forgeTimer=0; if (v.selected) updateVillagerPanel(); return; }
      const path=findPath(v.tx,v.ty,forge.tx,forge.ty,villagerBlocked);
      if (path&&path.length>1) { v.path=path.slice(1); v.state='moving'; if (v.selected) updateVillagerPanel(); return; }
      v.forgeTarget=null;
    }
    doRoam(v); return;
  }
  // Mechanics seek the most damaged building within territory
  if (v.role === VROLE.MECHANIC && settled) {
    const claimedRepair = new Set(
      villagers.filter(o => o.repairTarget != null && o.id !== v.id).map(o => o.repairTarget)
    );
    let worst = null, worstPct = 1.0;
    for (const b of buildings) {
      if (!b.complete || b.hp >= b.maxHp) continue;
      if (!withinTerritory(b.tx, b.ty)) continue;
      if (claimedRepair.has(b.id)) continue;
      const pct = b.hp / b.maxHp;
      if (pct < worstPct) { worstPct = pct; worst = b; }
    }
    if (worst) {
      v.repairTarget = worst.id;
      if (v.tx === worst.tx && v.ty === worst.ty) {
        v.state = 'repairing'; v.repairTimer = 0;
        if (v.selected) updateVillagerPanel();
        return;
      }
      const path = findPath(v.tx, v.ty, worst.tx, worst.ty, villagerBlocked);
      if (path && path.length > 1) {
        v.path = path.slice(1); v.state = 'moving';
        if (v.selected) updateVillagerPanel();
        return;
      }
      v.repairTarget = null;
    }
    doRoam(v); return;
  }
  // Bakers seek nearest complete bakery
  if (v.role===VROLE.BAKER) {
    const bakery=findBakeryTarget(v);
    if (bakery) {
      v.bakeryTarget=bakery;
      if (v.tx===bakery.tx&&v.ty===bakery.ty) {
        v.state='baking'; v.bakeTimer=0;
        if (v.selected) updateVillagerPanel();
        return;
      }
      const path=findPath(v.tx,v.ty,bakery.tx,bakery.ty,villagerBlocked);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='moving';
        if (v.selected) updateVillagerPanel();
        return;
      }
      v.bakeryTarget=null;
    }
    doRoam(v); return;
  }
  // Woodcutters seek nearest tree
  if (v.role===VROLE.WOODCUTTER) {
    const tgt=findChopTarget(v);
    if (tgt) {
      v.chopTarget=tgt;
      const path=findPath(v.tx,v.ty,tgt.tx,tgt.ty,villagerBlocked);
      if (path&&path.length>0) {
        if (path.length===1) { v.state='chopping'; v.chopTimer=0; }
        else { v.path=path.slice(1); v.state='moving'; }
        if (v.selected) updateVillagerPanel();
        return;
      }
      v.chopTarget=null;
    }
    doRoam(v); return;
  }
  // Farmers seek farmland
  if (v.role===VROLE.FARMER) {
    const farm=findFarmTarget(v);
    if (farm) {
      v.farmTarget=farm;
      if (v.tx===farm.tx&&v.ty===farm.ty) {
        v.state='farming'; v.farmTimer=0;
        if (v.selected) updateVillagerPanel();
        return;
      }
      const path=findPath(v.tx,v.ty,farm.tx,farm.ty,villagerBlocked);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='moving';
        if (v.selected) updateVillagerPanel();
        return;
      }
      v.farmTarget=null;
    }
    doRoam(v); return;
  }
  doRoam(v);
}

function findChopTarget(cutter) {
  const claimedIds = new Set(
    villagers.filter(v=>v.chopTarget&&v.id!==cutter.id).map(v=>v.chopTarget.id)
  );
  let best=null, bestDist=Infinity;
  for (const tree of trees) {
    if (claimedIds.has(tree.id)) continue;
    const d=Math.abs(tree.tx-cutter.tx)+Math.abs(tree.ty-cutter.ty);
    if (d>20) continue;
    if (d<bestDist) { bestDist=d; best=tree; }
  }
  return best;
}

function findFarmTarget(farmer) {
  const claimed = new Set(
    villagers.filter(v=>v.farmTarget&&v.id!==farmer.id).map(v=>v.farmTarget.id)
  );
  for (const b of buildings) {
    if (b.type!==4||!b.complete) continue; // type 4 = Farmland
    if (claimed.has(b.id)) continue;
    return b;
  }
  return null;
}

function findBakeryTarget(baker) {
  const claimed = new Set(
    villagers.filter(v=>v.bakeryTarget&&v.id!==baker.id).map(v=>v.bakeryTarget.id)
  );
  for (const b of buildings) {
    if (b.type!==1||!b.complete) continue; // type 1 = Bakery
    if (claimed.has(b.id)) continue;
    return b;
  }
  return null;
}
