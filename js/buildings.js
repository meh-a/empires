// ── buildings.js ──

// ═══════════════════════════════════════════════════
//  BUILDINGS
// ═══════════════════════════════════════════════════
function mkBuilding(type, tx, ty) {
  const [w, h] = STRUCT_SIZE[type] || [1, 1];
  const maxHp  = BLDG_HP_MAX[type] || 50;
  const b = { id:_bid++, type, tx, ty, w, h, progress:0, complete:false, assignedBuilders:[], hp:maxHp, maxHp };
  if (type === 4) b.fertility     = mapFertility[ty]?.[tx] ?? 1;
  if (type === 5) b.mountainBonus = (() => {
    const elev = mapHeight[ty]?.[tx] ?? 0;
    return elev > 0.66 ? 2.0 : elev > 0.63 ? 1.5 : 1.0;
  })();
  return b;
}

function canBuildAt(tx, ty, type) {
  const [w, h] = STRUCT_SIZE[type] || [1, 1];
  if (tx<0||tx+w>MAP_W||ty<0||ty+h>MAP_H) return false;
  // Road: check tile validity and not already a road
  if (type === 8) {
    if (!STRUCT_VALID[8].has(mapTiles[ty][tx])) return false;
    if (roadTiles.has(ty*MAP_W+tx)) return false;
    return true;
  }
  // Outpost: explored tile, distance restrictions
  if (type === 9) {
    if (!fogExplored[ty*MAP_W+tx]) return false;
    if (townCenter && Math.hypot(townCenter.tx-tx, townCenter.ty-ty) < 20) return false;
    if (buildings.some(b=>b.type===9 && Math.hypot(b.tx-tx, b.ty-ty)<15)) return false;
  }
  for (let dy=0; dy<h; dy++) for (let dx=0; dx<w; dx++) {
    if (!STRUCT_VALID[type].has(mapTiles[ty+dy][tx+dx])) return false;
    if (buildings.some(b=>tx+dx>=b.tx&&tx+dx<b.tx+b.w&&ty+dy>=b.ty&&ty+dy<b.ty+b.h)) return false;
  }
  return true;
}

function scaledCost(type) {
  const base = STRUCT_COST[type];
  if (!base) return {};
  const n = buildCounts[type] || 0;
  const add = Math.floor(n / 3); // +1 per resource per 3 buildings of this type
  const result = {};
  for (const [r, v] of Object.entries(base)) result[r] = v + add;
  return result;
}

function canAffordBuilding(type) {
  const cost = scaledCost(type);
  const res = {wood, stone, iron, food, crops, gold};
  return Object.entries(cost).every(([r,n]) => (res[r]||0) >= n);
}

// Solid building types block both villagers and enemies; Walls block enemies only
const SOLID_TYPES = new Set([0,1,3,6,7,9]); // House, Bakery, Tower, Barracks, Forge, Outpost

function rebuildNavBlocked() {
  navBlocked.fill(0);
  villagerBlocked.fill(0);
  for (const b of buildings) {
    if (!b.complete) continue;
    if (b.type === 2) {  // Wall: blocks enemies and villagers/NPCs
      for (let dy=0; dy<b.h; dy++) for (let dx=0; dx<b.w; dx++) {
        const i = (b.ty+dy)*MAP_W+(b.tx+dx);
        navBlocked[i] = 1;
        villagerBlocked[i] = 1;
      }
    }
    if (SOLID_TYPES.has(b.type)) {  // Solid: blocks both
      for (let dy=0; dy<b.h; dy++) for (let dx=0; dx<b.w; dx++) {
        const i = (b.ty+dy)*MAP_W+(b.tx+dx);
        navBlocked[i] = 1;
        villagerBlocked[i] = 1;
      }
    }
  }
  // Trees block villager pathfinding
  for (const t of trees) {
    villagerBlocked[t.ty * MAP_W + t.tx] = 1;
  }
}

function placeBuilding(tx, ty, type) {
  if (!canBuildAt(tx,ty,type)) return false;
  if (!canAffordBuilding(type)) { notify('Not enough resources!'); return false; }
  const cost = scaledCost(type);
  if (cost.wood)  wood  -= cost.wood;
  if (cost.stone) stone -= cost.stone;
  if (cost.iron)  iron  -= cost.iron;
  if (cost.gold)  gold  -= cost.gold;
  buildCounts[type] = (buildCounts[type] || 0) + 1;
  // Road is instant — no building object, just mark the tile
  if (type === 8) {
    roadTiles.add(ty*MAP_W+tx);
    return true;
  }
  buildings.push(mkBuilding(type,tx,ty));
  rebuildNavBlocked();
  return true;
}

function findBuildTarget(builder) {
  const occupiedTiles = new Set(
    villagers.filter(o => o.id !== builder.id && (o.state === 'building' || o.buildTarget != null))
             .map(o => {
               const bld = buildings.find(b => b.id === o.buildTarget);
               return bld ? `${bld.tx},${bld.ty}` : null;
             })
             .filter(k => k != null)
  );
  let best=null, bestDist=Infinity;
  for (const b of buildings) {
    if (b.complete) continue;
    if (b.assignedBuilders.length>=STRUCT_MAX_BUILDERS) continue;
    if (b.assignedBuilders.includes(builder.id)) continue;
    if (occupiedTiles.has(`${b.tx},${b.ty}`)) continue;
    const d=Math.abs(b.tx-builder.tx)+Math.abs(b.ty-builder.ty);
    if (d<bestDist) { bestDist=d; best=b; }
  }
  return best;
}

function assignBuilderTo(builder, bld) {
  const path=findPath(Math.floor(builder.x),Math.floor(builder.y),bld.tx,bld.ty,villagerBlocked);
  if (!path||path.length<1) {
    builder.state='idle'; builder.idleTimer=2+Math.random()*3; return;
  }
  builder.buildTarget=bld.id;
  bld.assignedBuilders.push(builder.id);
  if (path.length===1) {
    builder.state='building';
  } else {
    builder.path=path.slice(1); builder.state='moving';
  }
  if (builder.selected) updateVillagerPanel();
}

function refreshBuildCosts() {
  const RES_ICON = {wood:'🪵', stone:'🪨', iron:'⚙', gold:'⚜', food:'🍞', crops:'🌾'};
  STRUCT_COST.forEach((_, i) => {
    const btn = document.getElementById(`bbtn-${i}`);
    if (!btn) return;
    const cost = scaledCost(i);
    const costStr = Object.entries(cost).map(([r,n])=>`${n}${RES_ICON[r]||r[0].toUpperCase()}`).join(' ');
    const span = btn.querySelector('.build-btn-cost');
    if (span) span.textContent = costStr;
  });
}

function toggleBuildPanel() {
  if (!settled) return;
  buildMode=!buildMode;
  if (!buildMode) { placingType=null; }
  document.getElementById('build-panel').classList.toggle('visible',buildMode);
  document.querySelectorAll('.build-btn').forEach(b=>b.classList.remove('active'));
  if (buildMode) refreshBuildCosts();
}

function selectBuildType(type) {
  placingType=(placingType===type)?null:type;
  document.querySelectorAll('.build-btn').forEach((b,i)=>b.classList.toggle('active',i===placingType));
}

// ── Adjacency Bonuses ─────────────────────────────────────────────
function calcAdjacencyBonus(b) {
  if (!b.complete) { b.adjacencyBonus = 1.0; return; }
  const table = ADJACENCY_TABLE[b.type];
  let bonus = 1.0;
  if (table) {
    for (const other of buildings) {
      if (!other.complete || other.id === b.id) continue;
      if (Math.abs(other.tx - b.tx) <= 1 && Math.abs(other.ty - b.ty) <= 1) {
        bonus += table[other.type] ?? 0;
      }
    }
  }
  b.adjacencyBonus = Math.min(Math.max(0.5, bonus), 2.0);
}

function updateNeighborBonuses(tx, ty) {
  for (const b of buildings) {
    if (!b.complete) continue;
    if (Math.abs(b.tx - tx) <= 1 && Math.abs(b.ty - ty) <= 1) {
      calcAdjacencyBonus(b);
    }
  }
}


// ── Outpost ────────────────────────────────────────────────────────
function activateOutpostNodes(outpost) {
  const radius = 14;
  for (const node of resourceNodes) {
    if (!node.active && Math.hypot(node.tx-outpost.tx, node.ty-outpost.ty) <= radius) {
      node.active = true;
      if (node.discovered) notify(`${NODE_NAMES[node.type]} activated by Outpost!`);
    }
  }
}
