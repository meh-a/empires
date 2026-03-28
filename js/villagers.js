// ── villagers.js ──

// ═══════════════════════════════════════════════════
//  VILLAGERS
// ═══════════════════════════════════════════════════
function mkVillager(role, tx, ty) {
  return {
    id: _vid++, role, name: pickName(),
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
    hunger: 1.0,
    tired: 0.0,
    _goingSleep: false,
    _despawn: false,
    upgradeTimer: (role === VROLE.BASIC) ? BASIC_UPGRADE_TIME : null,
    patrolAngle: Math.random() * Math.PI * 2,
    tier: 1,
    xp: 0,
    toolTier: 0,
  };
}

// Combined speed multiplier from villager tier + tool tier (tools only for applicable roles)
const TOOL_ROLES = new Set([VROLE.WOODCUTTER, VROLE.BUILDER, VROLE.STONE_MINER]);
function workSpeed(v) {
  const t = TIER_SPEED[v.tier - 1] || 1.0;
  const w = TOOL_ROLES.has(v.role) ? (TOOL_SPEED[v.toolTier] || 1.0) : 1.0;
  return t * w;
}

function gainXP(v) {
  v.xp++;
  if (v.tier === 1 && v.xp >= TIER_XP_REQ[0]) { v.tier = 2; if (v.selected) updateVillagerPanel(); }
  else if (v.tier === 2 && v.xp >= TIER_XP_REQ[1]) { v.tier = 3; if (v.selected) updateVillagerPanel(); }
  // Workers grab better tools from stock if available
  if (TOOL_ROLES.has(v.role)) {
    for (let t = 2; t > v.toolTier; t--) {
      if (toolStock[t] > 0) { toolStock[t]--; v.toolTier = t; break; }
    }
  }
}

function spawnVillagers() {
  _usedNames = new Set(); villagers = []; selectedVillager = null;
  buildings = []; _bid = 0;
  fogVisible.fill(0); fogExplored.fill(0);
  gold=100; wood=0; food=20; crops=0; stone=0; iron=0;
  toolStock=[999,0,0];
  dayTime=0.3; day=1;
  settled=false; placingTownCenter=false; townCenter=null;
  const cx = MAP_W>>1, cy = MAP_H>>1;

  // BFS from centre to collect nearby walkable tiles
  const visited = new Uint8Array(MAP_W*MAP_H);
  const queue = [cy*MAP_W+cx];
  visited[queue[0]] = 1;
  const spots = [];

  while (queue.length && spots.length < 20) {
    const idx = queue.shift();
    const x=idx%MAP_W, y=(idx/MAP_W)|0;
    if (WALKABLE_TILES.has(mapTiles[y][x])) spots.push({x,y});
    for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const nx=x+dx, ny=y+dy;
      if (nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
      const ni=ny*MAP_W+nx;
      if (!visited[ni]) { visited[ni]=1; queue.push(ni); }
    }
  }

  // Pick every-other spot so villagers aren't stacked
  const chosen = spots.filter((_,i)=>i%2===0).slice(0,6);
  const roles = [VROLE.WOODCUTTER,VROLE.WOODCUTTER,VROLE.BUILDER,VROLE.KNIGHT,VROLE.FARMER,VROLE.BASIC];
  for (let i=0; i<roles.length&&i<chosen.length; i++)
    villagers.push(mkVillager(roles[i], chosen[i].x, chosen[i].y));
  spawnTimer = 0; goldTimer = 0; feedTimer = 0;
  generateTrees();
}

function updateVillagers(dt) {
  for (const v of villagers) {
    // ── Hunger drain ────────────────────────────────
    v.hunger = Math.max(0, v.hunger - HUNGER_RATE * dt);
    if (v.hunger <= 0) v._despawn = true;

    // ── Sleeping ────────────────────────────────────
    if (v.state==='sleeping') {
      if (isDaylight()) {
        v.tired=0; v.state='idle'; v.idleTimer=1+Math.random()*2;
        if (v.selected) updateVillagerPanel();
      }
      continue;
    }

    // ── Chopping ────────────────────────────────────
    if (v.state==='chopping') {
      if (!v.chopTarget||!trees.some(t=>t.id===v.chopTarget.id)) {
        v.chopTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      v.chopTimer+=dt * workSpeed(v);
      if (v.chopTimer>=CHOP_TIME) {
        v.chopTimer=0; wood+=CHOP_YIELD; gainXP(v);
        const {id:tid,tx:ct,ty:cty}=v.chopTarget;
        trees=trees.filter(t=>t.id!==tid);
        // Change tile to grass if that tile now has no trees
        if (!trees.some(t=>t.tx===ct&&t.ty===cty)&&mapTiles[cty]&&mapTiles[cty][ct]===T.FOREST) {
          mapTiles[cty][ct]=T.GRASS;
          buildMinimap();
        }
        v.chopTarget=null; v.state='idle'; v.idleTimer=0.5+Math.random()*1.5;
        if (v.selected) updateVillagerPanel();
      }
      continue;
    }

    // ── Farming state ──────────────────────────────
    if (v.state==='farming') {
      if (!v.farmTarget||!buildings.some(b=>b.id===v.farmTarget.id&&b.complete)) {
        v.farmTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      v.farmTimer+=dt * workSpeed(v);
      if (v.farmTimer>=FARM_TIME) {
        v.farmTimer=0; crops+=FARM_YIELD; gainXP(v);
        v.state='idle'; v.idleTimer=1+Math.random()*2;
        if (v.selected) updateVillagerPanel();
      }
      continue;
    }

    // ── Baking state ────────────────────────────────
    if (v.state==='baking') {
      if (!v.bakeryTarget||!buildings.some(b=>b.id===v.bakeryTarget.id&&b.complete)) {
        v.bakeryTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      if (crops < BAKE_COST) {
        v.state='idle'; v.idleTimer=3+Math.random()*3; continue;
      }
      v.bakeTimer+=dt * workSpeed(v);
      if (v.bakeTimer>=BAKE_TIME) {
        v.bakeTimer=0; crops-=BAKE_COST; food+=BAKE_YIELD; gainXP(v);
        v.state='idle'; v.idleTimer=0.5+Math.random()*1.5;
        if (v.selected) updateVillagerPanel();
      }
      continue;
    }

    // ── Mining state ────────────────────────────────
    if (v.state==='mining') {
      if (!v.mineTarget||!buildings.some(b=>b.id===v.mineTarget.id&&b.complete)) {
        v.mineTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      v.mineTimer+=dt * workSpeed(v);
      if (v.mineTimer>=MINE_TIME) {
        v.mineTimer=0; stone+=MINE_YIELD;
        if (v.tier===3 && Math.random()<MINE_IRON_CHANCE) iron++;
        gainXP(v);
        v.state='idle'; v.idleTimer=0.5+Math.random()*1.5;
        if (v.selected) updateVillagerPanel();
      }
      continue;
    }

    // ── Forging state ───────────────────────────────
    if (v.state==='forging') {
      if (!v.forgeTarget||!buildings.some(b=>b.id===v.forgeTarget.id&&b.complete)) {
        v.forgeTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      // Determine best craftable tier (highest where cost is met)
      let tier=-1;
      for (let t=2;t>=1;t--) {
        const cost=CRAFT_COST[t];
        if (Object.entries(cost).every(([r,n])=>({wood,stone,iron,food,crops,gold})[r]>=n)) {
          tier=t; break;
        }
      }
      if (tier<0) { v.state='idle'; v.idleTimer=4+Math.random()*4; continue; }
      v.forgeTimer+=dt;
      if (v.forgeTimer>=CRAFT_TIME[tier]) {
        v.forgeTimer=0;
        const cost=CRAFT_COST[tier];
        if (cost.stone) stone-=cost.stone;
        if (cost.iron)  iron -=cost.iron;
        toolStock[tier]+=3; // craft 3 tools at once
        gainXP(v);
        v.state='idle'; v.idleTimer=1+Math.random()*2;
        if (v.selected) updateVillagerPanel();
      }
      continue;
    }

    // ── Building state ─────────────────────────────
    if (v.state==='building') {
      const bld=buildings.find(b=>b.id===v.buildTarget);
      if (!bld||bld.complete) {
        v.buildTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
        if (v.selected) updateVillagerPanel();
      } else {
        bld.progress=Math.min(1, bld.progress+(1/STRUCT_BUILD_TIME[bld.type])*dt*workSpeed(v));
        if (bld.progress>=1) {
          bld.complete=true; bld.assignedBuilders=[];
          v.buildTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
          gainXP(v);
          if (v.selected) updateVillagerPanel();
        }
      }
      continue;
    }

    // ── Night: seek sleep ───────────────────────────
    if (isNight() && !v._goingSleep && (v.state==='idle'||v.state==='roaming')) {
      const house=findNearestHouse(v);
      if (house) {
        if (v.tx===house.tx&&v.ty===house.ty) {
          v.state='sleeping'; v._goingSleep=false;
          if (v.selected) updateVillagerPanel();
          continue;
        }
        const path=findPath(v.tx,v.ty,house.tx,house.ty);
        if (path&&path.length>1) {
          v.path=path.slice(1); v.state='moving'; v._goingSleep=true;
          if (v.selected) updateVillagerPanel();
        }
      } else {
        v.tired=Math.min(1, v.tired+TIRED_RATE*dt);
        if (v.tired>=1.0) v._despawn=true;
      }
    }

    // ── Barracks training (knights idle near barracks gain XP) ──
    if (v.role===VROLE.KNIGHT && v.state==='sleeping') {
      const bar=buildings.find(b=>b.type===6&&b.complete);
      if (bar) {
        v._barracksTrain=(v._barracksTrain||0)+dt;
        if (v._barracksTrain>=30) { v._barracksTrain=0; gainXP(v); }
      }
    }

    // ── Basic auto-upgrade countdown ───────────────
    if (v.role===VROLE.BASIC&&v.upgradeTimer!==null&&settled) {
      v.upgradeTimer-=dt;
      if (v.upgradeTimer<=0) {
        upgradeBasicVillager(v);
        if (v.selected) updateVillagerPanel();
      }
    }

    // ── Idle countdown ─────────────────────────────
    if (v.state==='idle') {
      v.idleTimer-=dt;
      if (v.idleTimer<=0) startRoam(v);
    }

    // ── Follow path ────────────────────────────────
    if (v.path.length>0) {
      const tgt=v.path[0];
      const wtx=tgt.x+0.5, wty=tgt.y+0.5;
      const dx=wtx-v.x, dy=wty-v.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const spd=(v.tired>0.5&&!v._goingSleep)?VILLAGER_SPEED*0.5:VILLAGER_SPEED;
      if (dist<=spd*dt+0.01) {
        v.x=wtx; v.y=wty; v.tx=tgt.x; v.ty=tgt.y;
        v.path.shift();
        if (v.path.length===0) {
          if (v.buildTarget!==null) {
            const bld=buildings.find(b=>b.id===v.buildTarget);
            if (bld&&!bld.complete&&v.tx===bld.tx&&v.ty===bld.ty) {
              v.state='building';
              if (!bld.assignedBuilders.includes(v.id)) bld.assignedBuilders.push(v.id);
            } else {
              v.buildTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.chopTarget!==null) {
            const {id:tid,tx:ct,ty:cty}=v.chopTarget;
            if (v.tx===ct&&v.ty===cty&&trees.some(t=>t.id===tid)) {
              v.state='chopping'; v.chopTimer=0;
            } else {
              v.chopTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.farmTarget!==null) {
            const fb=buildings.find(b=>b.id===v.farmTarget.id);
            if (fb&&fb.complete&&v.tx===fb.tx&&v.ty===fb.ty) {
              v.state='farming'; v.farmTimer=0;
            } else {
              v.farmTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.bakeryTarget!==null) {
            const bb=buildings.find(b=>b.id===v.bakeryTarget.id);
            if (bb&&bb.complete&&v.tx===bb.tx&&v.ty===bb.ty) {
              v.state='baking'; v.bakeTimer=0;
            } else {
              v.bakeryTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.mineTarget!==null) {
            const mb=buildings.find(b=>b.id===v.mineTarget.id);
            if (mb&&mb.complete&&v.tx===mb.tx&&v.ty===mb.ty) {
              v.state='mining'; v.mineTimer=0;
            } else {
              v.mineTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v.forgeTarget!==null) {
            const fb2=buildings.find(b=>b.id===v.forgeTarget.id);
            if (fb2&&fb2.complete&&v.tx===fb2.tx&&v.ty===fb2.ty) {
              v.state='forging'; v.forgeTimer=0;
            } else {
              v.forgeTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v._goingSleep) {
            v._goingSleep=false; v.state='sleeping';
          } else {
            v.state='idle'; v.idleTimer=1.5+Math.random()*4;
          }
          if (v.selected) updateVillagerPanel();
        }
      } else {
        v.x+=dx*spd*dt/dist; v.y+=dy*spd*dt/dist;
      }
    }
  }

  // ── Remove despawned villagers ──────────────────
  if (villagers.some(v=>v._despawn)) {
    if (selectedVillager&&selectedVillager._despawn) {
      selectedVillager=null; updateVillagerPanel();
    }
    villagers=villagers.filter(v=>!v._despawn);
  }
}

function startRoam(v) {
  // Builders prioritise construction sites
  if (v.role===VROLE.BUILDER) {
    const bld=findBuildTarget(v);
    if (bld) { assignBuilderTo(v,bld); return; }
  }
  // Knights patrol around the town center
  if (v.role===VROLE.KNIGHT && settled && townCenter) {
    for (let tries=0; tries<8; tries++) {
      v.patrolAngle += (Math.PI/3) + Math.random()*(Math.PI/3);
      const r = PATROL_RADIUS + (Math.random()*4-2);
      const ptx = Math.round(townCenter.tx + Math.cos(v.patrolAngle)*r);
      const pty = Math.round(townCenter.ty + Math.sin(v.patrolAngle)*r);
      if (ptx<0||ptx>=MAP_W||pty<0||pty>=MAP_H) continue;
      if (!WALKABLE_TILES.has(mapTiles[pty][ptx])) continue;
      const path=findPath(v.tx,v.ty,ptx,pty);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='patrolling';
        if (v.selected) updateVillagerPanel();
        return;
      }
    }
  }
  // Stone Miners seek nearest complete Mine
  if (v.role===VROLE.STONE_MINER) {
    const mine=buildings.find(b=>b.type===5&&b.complete);
    if (mine) {
      v.mineTarget=mine;
      if (v.tx===mine.tx&&v.ty===mine.ty) { v.state='mining'; v.mineTimer=0; if (v.selected) updateVillagerPanel(); return; }
      const path=findPath(v.tx,v.ty,mine.tx,mine.ty);
      if (path&&path.length>1) { v.path=path.slice(1); v.state='moving'; if (v.selected) updateVillagerPanel(); return; }
      v.mineTarget=null;
    }
  }
  // Toolsmiths seek nearest complete Forge
  if (v.role===VROLE.TOOLSMITH) {
    const forge=buildings.find(b=>b.type===7&&b.complete);
    if (forge) {
      v.forgeTarget=forge;
      if (v.tx===forge.tx&&v.ty===forge.ty) { v.state='forging'; v.forgeTimer=0; if (v.selected) updateVillagerPanel(); return; }
      const path=findPath(v.tx,v.ty,forge.tx,forge.ty);
      if (path&&path.length>1) { v.path=path.slice(1); v.state='moving'; if (v.selected) updateVillagerPanel(); return; }
      v.forgeTarget=null;
    }
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
      const path=findPath(v.tx,v.ty,bakery.tx,bakery.ty);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='moving';
        if (v.selected) updateVillagerPanel();
        return;
      }
      v.bakeryTarget=null;
    }
  }
  // Woodcutters seek nearest tree
  if (v.role===VROLE.WOODCUTTER) {
    const tgt=findChopTarget(v);
    if (tgt) {
      v.chopTarget=tgt;
      const path=findPath(v.tx,v.ty,tgt.tx,tgt.ty);
      if (path&&path.length>0) {
        if (path.length===1) { v.state='chopping'; v.chopTimer=0; }
        else { v.path=path.slice(1); v.state='moving'; }
        if (v.selected) updateVillagerPanel();
        return;
      }
      v.chopTarget=null;
    }
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
      const path=findPath(v.tx,v.ty,farm.tx,farm.ty);
      if (path&&path.length>1) {
        v.path=path.slice(1); v.state='moving';
        if (v.selected) updateVillagerPanel();
        return;
      }
      v.farmTarget=null;
    }
  }
  const leash = getTerritoryRadius();
  for (let a=0; a<15; a++) {
    let tx=v.tx+Math.round((Math.random()*2-1)*ROAM_RADIUS);
    let ty=v.ty+Math.round((Math.random()*2-1)*ROAM_RADIUS);
    // Leash to town center when settled
    if (settled&&townCenter) {
      tx=Math.max(townCenter.tx-leash,Math.min(townCenter.tx+leash,tx));
      ty=Math.max(townCenter.ty-leash,Math.min(townCenter.ty+leash,ty));
    }
    if (tx<0||tx>=MAP_W||ty<0||ty>=MAP_H) continue;
    if (!WALKABLE_TILES.has(mapTiles[ty][tx])) continue;
    if (tx===v.tx&&ty===v.ty) continue;
    const path=findPath(v.tx,v.ty,tx,ty);
    if (path&&path.length>1) {
      v.path=path.slice(1); v.state='roaming';
      if (v.selected) updateVillagerPanel();
      return;
    }
  }
  v.state='idle'; v.idleTimer=1+Math.random()*2;
}

function moveVillagerTo(v, tx, ty) {
  if (tx<0||tx>=MAP_W||ty<0||ty>=MAP_H) return false;
  if (!WALKABLE_TILES.has(mapTiles[ty][tx])) return false;
  const stx=Math.floor(v.x), sty=Math.floor(v.y);
  const path=findPath(stx,sty,tx,ty);
  if (!path||path.length<2) return false;
  v.path=path.slice(1); v.state='moving';
  if (v.selected) updateVillagerPanel();
  return true;
}

function findNearestHouse(v) {
  let best=null, bestDist=Infinity;
  for (const b of buildings) {
    if (b.type!==0||!b.complete) continue;
    const d=Math.abs(b.tx-v.tx)+Math.abs(b.ty-v.ty);
    if (d<bestDist) { bestDist=d; best=b; }
  }
  return best;
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

function upgradeBasicVillager(v) {
  const counts = {};
  for (const r of Object.values(VROLE)) counts[r]=0;
  for (const u of villagers) counts[u.role]=(counts[u.role]||0)+1;
  const hasFarmland = buildings.some(b=>b.type===4&&b.complete);
  const hasBakery   = buildings.some(b=>b.type===1&&b.complete);
  const hasMine     = buildings.some(b=>b.type===5&&b.complete);
  const hasForge    = buildings.some(b=>b.type===7&&b.complete);
  const candidates = [];
  if (hasFarmland   && (counts[VROLE.FARMER]||0)<3)       candidates.push(VROLE.FARMER);
  if (hasBakery     && (counts[VROLE.BAKER]||0)<2)        candidates.push(VROLE.BAKER);
  if (hasMine       && (counts[VROLE.STONE_MINER]||0)<3)  candidates.push(VROLE.STONE_MINER);
  if (hasForge      && (counts[VROLE.TOOLSMITH]||0)<1)    candidates.push(VROLE.TOOLSMITH);
  if ((counts[VROLE.WOODCUTTER]||0)<3) candidates.push(VROLE.WOODCUTTER);
  if ((counts[VROLE.BUILDER]||0)<2) candidates.push(VROLE.BUILDER);
  candidates.push(VROLE.WOODCUTTER); // fallback
  v.role = candidates[0];
  v.upgradeTimer = null;
}

function upgradeBasicTo(v, newRole) {
  if (gold < 20) return;
  gold -= 20;
  v.role = newRole;
  v.upgradeTimer = null;
  if (v.selected) updateVillagerPanel();
}

function updateSpawning(dt) {
  if (!settled || villagers.length >= MAX_VILLAGERS) return;
  spawnTimer += dt;
  if (spawnTimer < SPAWN_INTERVAL) return;
  spawnTimer = 0;
  // Find walkable spot near town center
  const cx=townCenter.tx, cy=townCenter.ty;
  for (let a=0; a<30; a++) {
    const tx=cx+Math.round((Math.random()*2-1)*8);
    const ty=cy+Math.round((Math.random()*2-1)*8);
    if (tx<0||tx>=MAP_W||ty<0||ty>=MAP_H) continue;
    if (!WALKABLE_TILES.has(mapTiles[ty][tx])) continue;
    if (villagers.some(u=>u.tx===tx&&u.ty===ty)) continue;
    const nv = mkVillager(VROLE.BASIC, tx, ty);
    nv.idleTimer = Math.random()*2;
    villagers.push(nv);
    return;
  }
}

function updateGold(dt) {
  if (!settled) return;
  goldTimer += dt;
  if (goldTimer < GOLD_TICK) return;
  goldTimer = 0;
  gold += villagers.length;
}

function updateFeeding(dt) {
  if (!settled) return;
  feedTimer += dt;
  if (feedTimer < FEED_TICK) return;
  feedTimer = 0;
  // Each villager tries to eat — costs 1 food, restores FEED_RESTORE hunger
  for (const v of villagers) {
    if (food <= 0) break;
    food--;
    v.hunger = Math.min(1.0, v.hunger + FEED_RESTORE);
  }
}
