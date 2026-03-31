// ── villager-ai.js ──

// ═══════════════════════════════════════════════════
//  VILLAGERS
// ═══════════════════════════════════════════════════


function mkVillager(role, tx, ty) {
  const maxHp = UNIT_HP_MAX[role] || 15;
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
  };
}

// Combined speed multiplier from villager tier + tool tier (tools only for applicable roles)
const TOOL_ROLES = new Set([VROLE.WOODCUTTER, VROLE.BUILDER, VROLE.STONE_MINER]);
function workSpeed(v) {
  const t = TIER_SPEED[v.tier - 1] || 1.0;
  const w = TOOL_ROLES.has(v.role) ? (TOOL_SPEED[v.toolTier] || 1.0) : 1.0;
  return t * w;
}

function getNodeBonus(tx, ty, nodeType) {
  for (const node of resourceNodes) {
    if (!node.active || node.type !== nodeType) continue;
    if (Math.hypot(node.tx - tx, node.ty - ty) <= node.radius) return node.bonus;
  }
  return 1.0;
}

function isNearIronVein(mineTx, mineTy) {
  for (const node of resourceNodes) {
    if (!node.active || node.type !== 'iron') continue;
    if (Math.hypot(node.tx - mineTx, node.ty - mineTy) <= 4) return true;
  }
  return false;
}

function updateRegrowth(dt) {
  for (const r of regrowthQueue) r.timer -= dt;
  const ready = regrowthQueue.filter(r => r.timer <= 0);
  regrowthQueue = regrowthQueue.filter(r => r.timer > 0);
  for (const r of ready) {
    // Only regrow if tile is still FOREST and no tree already there
    if (mapTiles[r.ty]?.[r.tx] === T.FOREST && !trees.some(t => t.tx === r.tx && t.ty === r.ty)) {
      trees.push({ id: _treeId++, tx: r.tx, ty: r.ty,
        ox: 0.04 + Math.random()*0.06, oy: 0.04 + Math.random()*0.06, scale: 0.88 });
      rebuildNavBlocked();
    }
  }
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
  _usedNames = new Set(); villagers = []; selectedVillager = null; possessedVillager = null;
  buildings = []; _bid = 0; buildCounts.fill(0);
  fogVisible.fill(0); fogExplored.fill(0);
  gold=100; wood=0; food=20; crops=0; stone=0; iron=0;
  toolStock=[999,0,0];
  dayTime=0.3; day=1;
  npcs=[]; _npcId=0; npcVisitTimer=0; npcModal=null;
  document.getElementById('npc-modal')?.classList.add('npc-hidden');
  enemyKingdoms=[]; enemyUnits=[]; projectiles=[]; gameState='playing'; alertMode=false; _defendRerouteTimer=0; _nextKingdomTimer=0; _totalWaves=0;
  document.getElementById('gameover')?.classList.add('go-hidden');
  settled=false; placingTownCenter=false; townCenter=null;

  // Generate trees and rebuild nav before BFS so spawn tiles avoid trees
  regrowthQueue = [];
  roadTiles = new Set();
  bandits = []; _banditId = 0; _banditSpawnTimer = 0;
  generateTrees();
  rebuildNavBlocked();

  const cx = MAP_W>>1, cy = MAP_H>>1;

  // BFS from centre — 8-directional traversal through all walkable tiles (including
  // forest tiles with trees), but only collect open (non-blocked) tiles as spawn spots.
  // Using 8-directional lets us navigate through dense forest to find clearings.
  const visited = new Uint8Array(MAP_W*MAP_H);
  const queue = [cy*MAP_W+cx];
  visited[queue[0]] = 1;
  const spots = [];

  while (queue.length && spots.length < 40) {
    const idx = queue.shift();
    const x=idx%MAP_W, y=(idx/MAP_W)|0;
    if (WALKABLE_TILES.has(mapTiles[y][x]) && !villagerBlocked[idx]) spots.push({x,y});
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
      if (!dx && !dy) continue;
      const nx=x+dx, ny=y+dy;
      if (nx<0||nx>=MAP_W||ny<0||ny>=MAP_H) continue;
      const ni=ny*MAP_W+nx;
      // Traverse all walkable tiles so dense forest doesn't cut off the BFS
      if (!visited[ni] && WALKABLE_TILES.has(mapTiles[ny][nx])) {
        visited[ni]=1; queue.push(ni);
      }
    }
  }

  // Pick spots with minimum 3-tile Manhattan gap so villagers spread out
  const chosen = [];
  for (const s of spots) {
    if (chosen.length >= 6) break;
    if (chosen.every(c => Math.abs(c.x-s.x)+Math.abs(c.y-s.y) >= 3)) chosen.push(s);
  }

  const roles = [VROLE.WOODCUTTER,VROLE.WOODCUTTER,VROLE.BUILDER,VROLE.KNIGHT,VROLE.FARMER,VROLE.BASIC];
  for (let i=0; i<roles.length&&i<chosen.length; i++)
    villagers.push(mkVillager(roles[i], chosen[i].x, chosen[i].y));
  spawnTimer = 0; goldTimer = 0; feedTimer = 0;
}

function _cameraFollowRoam(v) {
  const sz = TILE_SZ * zoom;
  const camTX = Math.floor((camX + canvas.width  * 0.5) / sz);
  const camTY = Math.floor((camY + canvas.height * 0.5) / sz);
  // Scatter so villagers don't converge on the exact same tile
  const scatter = 4;
  const tx = Math.max(0, Math.min(MAP_W-1, camTX + Math.round((Math.random()*2-1) * scatter)));
  const ty = Math.max(0, Math.min(MAP_H-1, camTY + Math.round((Math.random()*2-1) * scatter)));
  if (WALKABLE_TILES.has(mapTiles[ty]?.[tx]) && !villagerBlocked[ty*MAP_W+tx]) {
    const path = findPath(v.tx, v.ty, tx, ty, villagerBlocked);
    if (path && path.length > 1) {
      v.path = path.slice(1); v.state = 'roaming';
      if (v.selected) updateVillagerPanel();
      return;
    }
  }
  doRoam(v); // camera pointed at unwalkable terrain — fall back to normal roam
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

    // ── Explorer: user-controlled, skip all AI ──────
    if (v.role === VROLE.EXPLORER) {
      if (v.path.length === 0 && v.state !== 'idle') { v.state = 'idle'; v.idleTimer = 0.5; }
      // fall through to path-following below
    }
    // ── Possessed: skip all AI, only run path-following ──
    else if (v === possessedVillager) {
      if (v.state !== 'fighting' && v.path.length === 0) { v.state = 'idle'; v.idleTimer = 0.1; }
      // fall through to path-following below
    } else {

    // ── Chopping ────────────────────────────────────
    if (v.state==='chopping') {
      if (!v.chopTarget||!trees.some(t=>t.id===v.chopTarget.id)) {
        v.chopTarget=null; v.state='idle'; v.idleTimer=1; continue;
      }
      const forestBonus = getNodeBonus(v.chopTarget.tx, v.chopTarget.ty, 'forest');
      v.chopTimer+=dt * workSpeed(v) * forestBonus;
      if (v.chopTimer>=CHOP_TIME) {
        v.chopTimer=0; wood+=CHOP_YIELD; gainXP(v);
        const {id:tid,tx:ct,ty:cty}=v.chopTarget;
        trees=trees.filter(t=>t.id!==tid);
        rebuildNavBlocked();
        // Ancient forest: schedule regrowth instead of converting tile
        const inAncientForest = resourceNodes.some(n =>
          n.type==='forest' && n.active && Math.hypot(n.tx-ct, n.ty-cty) <= n.radius
        );
        if (inAncientForest) {
          regrowthQueue.push({ tx: ct, ty: cty, timer: 60 });
        } else if (!trees.some(t=>t.tx===ct&&t.ty===cty)&&mapTiles[cty]&&mapTiles[cty][ct]===T.FOREST) {
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
      v.farmTimer+=dt * workSpeed(v) * (v.farmTarget.adjacencyBonus || 1.0) * (v.farmTarget.fertility || 1);
      if (v.farmTimer>=FARM_TIME) {
        v.farmTimer=0;
        const farmBonus = getNodeBonus(v.farmTarget.tx, v.farmTarget.ty, 'farmland');
        const deltaBonus = getNodeBonus(v.farmTarget.tx, v.farmTarget.ty, 'delta');
        crops += Math.round(FARM_YIELD * Math.max(farmBonus, deltaBonus));
        gainXP(v);
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
      v.bakeTimer+=dt * workSpeed(v) * (v.bakeryTarget.adjacencyBonus || 1.0);
      if (v.bakeTimer>=BAKE_TIME) {
        v.bakeTimer=0; crops-=BAKE_COST;
        const bakeBonus = getNodeBonus(v.bakeryTarget.tx, v.bakeryTarget.ty, 'farmland');
        food += Math.round(BAKE_YIELD * (bakeBonus > 1.0 ? 1.3 : 1.0));
        gainXP(v);
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
      v.mineTimer+=dt * workSpeed(v) * (v.mineTarget.adjacencyBonus || 1.0) * (v.mineTarget.mountainBonus || 1.0);
      if (v.mineTimer>=MINE_TIME) {
        v.mineTimer=0;
        const quarryBonus = getNodeBonus(v.mineTarget.tx, v.mineTarget.ty, 'quarry');
        stone += Math.round(MINE_YIELD * quarryBonus);
        if (v.tier===3 && Math.random()<MINE_IRON_CHANCE) iron++;
        if (isNearIronVein(v.mineTarget.tx, v.mineTarget.ty)) iron++;
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
      const forgeAdj = buildings.find(b=>b.id===v.forgeTarget.id)?.adjacencyBonus || 1.0;
      v.forgeTimer+=dt * forgeAdj;
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

    // ── Repairing state (Mechanic at damaged building) ──
    if (v.state === 'repairing') {
      const rb = buildings.find(b => b.id === v.repairTarget);
      if (!rb || !rb.complete || rb.hp >= rb.maxHp) {
        v.repairTarget = null; v.state = 'idle'; v.idleTimer = 1 + Math.random()*2;
        if (v.selected) updateVillagerPanel();
        continue;
      }
      v.repairTimer += dt * workSpeed(v);
      if (v.repairTimer >= REPAIR_TIME) {
        v.repairTimer = 0;
        if (stone >= REPAIR_STONE) {
          stone -= REPAIR_STONE;
          rb.hp = Math.min(rb.maxHp, rb.hp + REPAIR_RATE);
          gainXP(v);
          if (v.selected) updateVillagerPanel();
        }
      }
      continue;
    }

    // ── Guarding state (Archer stationed at Tower) ──
    if (v.state === 'guarding') {
      // Return to idle if tower gone or night
      if (!buildings.some(b=>b.id===v.towerTarget&&b.complete&&b.type===3)) {
        v.state='idle'; v.idleTimer=1; v.towerTarget=null;
        if (v.selected) updateVillagerPanel();
      }
      if (isNight() && !v._goingSleep) {
        const house=findNearestHouse(v);
        if (house) {
          const path=findPath(v.tx,v.ty,house.tx,house.ty,villagerBlocked);
          if (path&&path.length>1) { v.path=path.slice(1); v.state='moving'; v._goingSleep=true; v._sleepTarget={tx:house.tx,ty:house.ty}; if (v.selected) updateVillagerPanel(); }
        }
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
          rebuildNavBlocked();
          calcAdjacencyBonus(bld);
          updateNeighborBonuses(bld.tx, bld.ty);
          if (bld.type === 9) activateOutpostNodes(bld);
          v.buildTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
          gainXP(v);
          if (v.selected) updateVillagerPanel();
        }
      }
      continue;
    }

    // ── Night: seek sleep ───────────────────────────
    if (isNight() && !v._goingSleep && (v.state==='idle'||v.state==='roaming')
        && !(v.role===VROLE.KNIGHT && alertMode)) {
      const house=findNearestHouse(v);
      if (house) {
        if (v.tx===house.tx&&v.ty===house.ty) {
          v.state='sleeping'; v._goingSleep=false;
          if (v.selected) updateVillagerPanel();
          continue;
        }
        const path=findPath(v.tx,v.ty,house.tx,house.ty,villagerBlocked);
        if (path&&path.length>1) {
          v.path=path.slice(1); v.state='moving'; v._goingSleep=true; v._sleepTarget={tx:house.tx,ty:house.ty};
          if (v.selected) updateVillagerPanel();
        }
      } else {
        // No house — villager grows exhausted and becomes an easy kidnap target
        v.tired=Math.min(1, v.tired+TIRED_RATE*dt);
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

    // ── Manual training countdown ───────────────────
    if (v.state==='training') {
      // Walk to training building first
      if (v._trainingBuilding != null) {
        const tb = buildings.find(b => b.id === v._trainingBuilding);
        if (!tb) { v._trainingBuilding = null; } // building gone, skip walk
        else {
          const dist = Math.abs(Math.floor(v.x) - tb.tx) + Math.abs(Math.floor(v.y) - tb.ty);
          if (dist > 1) {
            // Still walking — use existing path or request a new one
            if (!v.path || v.path.length === 0) {
              const p = findPath(Math.floor(v.x), Math.floor(v.y), tb.tx, tb.ty, villagerBlocked);
              if (p && p.length > 1) v.path = p.slice(1);
            }
            // Move along path (reuse normal movement below by NOT continuing here)
          } else {
            v._trainingBuilding = null; // arrived — start countdown
          }
          if (v._trainingBuilding != null) {
            // still walking: do normal movement this tick
            // fall through to movement code by NOT using continue
          } else {
            // just arrived
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
          notify(`${v.name} finished training as ${v.role}!`);
          if (v.selected) updateVillagerPanel();
        }
        continue; // stand still while counting down
      }
    }

    // ── Idle countdown ─────────────────────────────
    if (v.state==='idle') {
      v.idleTimer-=dt;
      if (v.idleTimer<=0) {
        if (!settled) _cameraFollowRoam(v);
        else startRoam(v);
      }
    }

    } // end else (non-possessed state machine)

    // ── Follow path ────────────────────────────────
    if (v.path.length>0) {
      const tgt=v.path[0];
      const wtx=tgt.x+0.5, wty=tgt.y+0.5;
      const dx=wtx-v.x, dy=wty-v.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const onRoad = roadTiles.has(tgt.y * MAP_W + tgt.x);
      const baseSpd = onRoad ? VILLAGER_SPEED * 1.6 : VILLAGER_SPEED;
      const spd = v===possessedVillager ? POSSESS_SPEED :
        (v.tired>0.5&&!v._goingSleep) ? baseSpd*0.5 : baseSpd;
      if (dist<=spd*dt+0.01) {
        v.x=wtx; v.y=wty; v.tx=tgt.x; v.ty=tgt.y;
        v._stuckTimer=0;
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
          } else if (v.repairTarget!==null) {
            const rb=buildings.find(b=>b.id===v.repairTarget);
            if (rb&&rb.complete&&v.tx===rb.tx&&v.ty===rb.ty&&rb.hp<rb.maxHp) {
              v.state='repairing'; v.repairTimer=0;
            } else {
              v.repairTarget=null; v.state='idle'; v.idleTimer=1+Math.random()*2;
            }
          } else if (v._seekBakery != null) {
            if (food > 0) { food=Math.max(0,food-1); v.hunger=Math.min(1,v.hunger+FEED_RESTORE); }
            v._seekBakery = null;
            v.state='idle'; v.idleTimer=0.5+Math.random()*0.5;
          } else if (v._seekForge != null) {
            v.toolTier = v._seekForge.tier;
            v._seekForge = null;
            v.state='idle'; v.idleTimer=0.3;
          } else if (v._goingSleep) {
            v._goingSleep=false; v._sleepTarget=null; v.state='sleeping';
          } else if (v.state==='training') {
            // arrived at training building — keep state, next tick handles it
          } else {
            v.state='idle'; v.idleTimer=1.5+Math.random()*4;
          }
          if (v.selected) updateVillagerPanel();
        }
      } else {
        v.x+=dx*spd*dt/dist; v.y+=dy*spd*dt/dist;
        if (v !== possessedVillager) {
          v._stuckTimer += dt;
          if (v._stuckTimer > 2.5) {
            v.path=[]; v.state='idle'; v.idleTimer=0.5+Math.random()*1.5;
            v._stuckTimer=0;
          }
        }
      }
    }
  }

  // ── Separation: push apart villagers sharing a tile ──
  for (let i=0; i<villagers.length; i++) {
    for (let j=i+1; j<villagers.length; j++) {
      const a=villagers[i], b=villagers[j];
      if (a._despawn||b._despawn) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if (dist<1.0&&dist>0.001) {
        const push=(1.0-dist)*0.4;
        const nx=dx/dist, ny=dy/dist;
        a.x-=nx*push; a.y-=ny*push;
        b.x+=nx*push; b.y+=ny*push;
        // Don't clobber tx/ty from the float nudge — that corrupts pathfinding.
        // tx/ty are only updated when a villager actually arrives at a tile step.
      }
    }
  }

  // ── Remove despawned villagers ──────────────────
  if (villagers.some(v=>v._despawn)) {
    if (selectedVillager&&selectedVillager._despawn) {
      selectedVillager=null; updateVillagerPanel();
    }
    if (possessedVillager&&possessedVillager._despawn) {
      possessedVillager=null; document.getElementById('possess-bar').classList.add('hidden');
    }
    villagers=villagers.filter(v=>!v._despawn);
  }
}

function moveVillagerTo(v, tx, ty) {
  if (tx<0||tx>=MAP_W||ty<0||ty>=MAP_H) return false;
  if (!WALKABLE_TILES.has(mapTiles[ty][tx])) return false;
  const stx=Math.floor(v.x), sty=Math.floor(v.y);
  // Explorers can traverse forests — use navBlocked (walls/buildings only, not trees)
  const blocked = v.role === VROLE.EXPLORER ? navBlocked : villagerBlocked;
  let path=findPath(stx,sty,tx,ty,blocked);
  // Fallback: if destination unreachable, BFS from villager to find the reachable
  // tile closest (by Euclidean distance) to the intended destination.
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
        if (bfsVis[ni] || !WALKABLE_TILES.has(mapTiles[ny][nx]) || (blocked && blocked[ni])) continue;
        bfsVis[ni] = 1; bfsQ.push(ni);
      }
    }
    if (bestIdx < 0 || bestIdx === si) return false;
    path = findPath(stx, sty, bestIdx % MAP_W, (bestIdx / MAP_W) | 0, blocked);
  }
  if (!path||path.length<2) return false;
  v.path=path.slice(1); v.state='moving';
  if (v.selected) updateVillagerPanel();
  return true;
}

const HOUSE_CAP = 4;

function findNearestHouse(v) {
  // Count how many villagers are already sleeping or heading to each house
  const occ = {};
  for (const ov of villagers) {
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
  for (const b of buildings) {
    if (b.type !== 0 || !b.complete) continue;
    if ((occ[`${b.tx},${b.ty}`] || 0) >= HOUSE_CAP) continue;
    const d = Math.abs(b.tx - v.tx) + Math.abs(b.ty - v.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

function upgradeBasicVillager(v) {
  const counts = {};
  for (const r of Object.values(VROLE)) counts[r]=0;
  for (const u of villagers) counts[u.role]=(counts[u.role]||0)+1;
  const hasFarmland = buildings.some(b=>b.type===4&&b.complete);
  const hasBakery   = buildings.some(b=>b.type===1&&b.complete);
  const hasMine     = buildings.some(b=>b.type===5&&b.complete);
  const hasForge    = buildings.some(b=>b.type===7&&b.complete);
  const hasTower    = buildings.some(b=>b.type===3&&b.complete);
  const hasDamaged  = buildings.some(b=>b.complete&&b.hp<b.maxHp);
  const candidates = [];
  if (hasFarmland   && (counts[VROLE.FARMER]||0)<3)       candidates.push(VROLE.FARMER);
  if (hasBakery     && (counts[VROLE.BAKER]||0)<2)        candidates.push(VROLE.BAKER);
  if (hasMine       && (counts[VROLE.STONE_MINER]||0)<3)  candidates.push(VROLE.STONE_MINER);
  if (hasForge      && (counts[VROLE.TOOLSMITH]||0)<1)    candidates.push(VROLE.TOOLSMITH);
  if (hasTower      && (counts[VROLE.ARCHER]||0)<2)       candidates.push(VROLE.ARCHER);
  if (hasDamaged    && (counts[VROLE.MECHANIC]||0)<1)     candidates.push(VROLE.MECHANIC);
  if ((counts[VROLE.WOODCUTTER]||0)<3) candidates.push(VROLE.WOODCUTTER);
  if ((counts[VROLE.BUILDER]||0)<2) candidates.push(VROLE.BUILDER);
  candidates.push(VROLE.WOODCUTTER); // fallback
  v.role = candidates[0];
  v.upgradeTimer = null;
}

// Building prerequisites for manual upgrade
const UPGRADE_PREREQ = {
  [VROLE.KNIGHT]:      6, // Barracks
  [VROLE.ARCHER]:      3, // Tower
  [VROLE.BAKER]:       1, // Bakery
  [VROLE.STONE_MINER]: 5, // Mine
  [VROLE.TOOLSMITH]:   7, // Forge
  [VROLE.FARMER]:      4, // Farmland
  // Woodcutter, Builder, Mechanic: no prereq
};

function hasPrereq(newRole) {
  const reqType = UPGRADE_PREREQ[newRole];
  if (reqType === undefined) return true; // Woodcutter/Builder need no building
  return buildings.some(b => b.type === reqType && b.complete);
}

const TRAIN_TIME = 25; // seconds

function upgradeBasicTo(v, newRole) {
  if (gold < 20) return;
  if (!hasPrereq(newRole)) return;
  gold -= 20;
  v.state = 'training';
  v._trainingRole = newRole;
  v._trainingTimer = TRAIN_TIME;
  v.upgradeTimer = null;
  // Find the prereq building to walk to
  const reqType = UPGRADE_PREREQ[newRole];
  const tb = (reqType !== undefined)
    ? buildings.find(b => b.type === reqType && b.complete)
    : null;
  v._trainingBuilding = tb ? tb.id : null;
  v.path = [];
  if (v.selected) updateVillagerPanel();
}

function getPopCap() {
  const houses = buildings.filter(b => b.type === 0 && b.complete).length;
  return houses * HOUSE_CAP; // 4 villagers per house
}

function updateSpawning(dt) {
  if (!settled) return;
  const cap = getPopCap();
  if (cap === 0 || villagers.length >= cap) return;
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
    if (villagerBlocked[ty*MAP_W+tx]) continue;
    if (villagers.some(u=>u.tx===tx&&u.ty===ty)) continue;
    const spawnRole = Math.random() < 0.1 ? VROLE.EXPLORER : VROLE.BASIC;
    const nv = mkVillager(spawnRole, tx, ty);
    nv.idleTimer = Math.random()*2;
    if (spawnRole === VROLE.EXPLORER) { nv.upgradeTimer = null; notify(`${nv.name} arrived as an Explorer!`); }
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
