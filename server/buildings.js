// ── server/game/buildings.js ──
import { MAP_W, MAP_H, BLDG_HP_MAX, STRUCT_COST, ADJACENCY_TABLE, NODE_NAMES, BLDG_TIER_COSTS } from './constants.js';
import { STRUCT_SIZE, STRUCT_VALID, STRUCT_MAX_BUILDERS, STRUCT_BUILD_TIME } from './sprites.js';
import { WALKABLE_TILES, findPath } from './world.js';

// ── Territory radius ──────────────────────────────────────────────
export function getTerritoryRadius(room) {
  if (!room.settled) return 35; // LEASH_RADIUS
  const built = room.buildings.filter(b => b.complete).length;
  const goldBonus = Math.floor(room.gold / 100);
  return Math.min(60, 20 + built * 3 + goldBonus);
}

export function withinTerritory(room, tx, ty) {
  if (!room.settled || !room.townCenter) return true;
  const dx = tx - room.townCenter.tx, dy = ty - room.townCenter.ty;
  return Math.sqrt(dx*dx + dy*dy) <= getTerritoryRadius(room);
}

// ── Building factory ──────────────────────────────────────────────
export function mkBuilding(room, type, tx, ty) {
  const [w, h] = STRUCT_SIZE[type] || [1, 1];
  const maxHp  = BLDG_HP_MAX[type] || 50;
  const b = { id: room._bid++, type, tx, ty, w, h, progress:0, complete:false, assignedBuilders:[], hp:maxHp, maxHp };
  if (type === 4) b.fertility     = room.mapFertility[ty]?.[tx] ?? 1;
  if (type === 5) b.mountainBonus = (() => {
    const elev = room.mapHeight[ty]?.[tx] ?? 0;
    return elev > 0.66 ? 2.0 : elev > 0.63 ? 1.5 : 1.0;
  })();
  return b;
}

export function canBuildAt(room, tx, ty, type) {
  const [w, h] = STRUCT_SIZE[type] || [1, 1];
  if (tx<0||tx+w>MAP_W||ty<0||ty+h>MAP_H) return false;
  if (type === 8) {
    if (!STRUCT_VALID[8].has(room.mapTiles[ty][tx])) return false;
    if (room.roadTiles.has(ty*MAP_W+tx)) return false;
    return true;
  }
  if (type === 9) {
    if (!room.fogExplored[ty*MAP_W+tx]) return false;
    if (room.townCenter && Math.hypot(room.townCenter.tx-tx, room.townCenter.ty-ty) < 20) return false;
    if (room.buildings.some(b=>b.type===9 && Math.hypot(b.tx-tx, b.ty-ty)<15)) return false;
  }
  if (type === 10) { // Gate must be adjacent to at least one completed wall
    const hasWall = room.buildings.some(b =>
      b.type === 2 && b.complete && Math.abs(b.tx - tx) + Math.abs(b.ty - ty) === 1
    );
    if (!hasWall) return false;
  }
  for (let dy=0; dy<h; dy++) for (let dx=0; dx<w; dx++) {
    if (!STRUCT_VALID[type].has(room.mapTiles[ty+dy][tx+dx])) return false;
    if (room.buildings.some(b=>tx+dx>=b.tx&&tx+dx<b.tx+b.w&&ty+dy>=b.ty&&ty+dy<b.ty+b.h)) return false;
  }
  return true;
}

export function scaledCost(room, type) {
  const base = STRUCT_COST[type];
  if (!base) return {};
  const n = room.buildCounts[type] || 0;
  const add = Math.floor(n / 3);
  const result = {};
  for (const [r, v] of Object.entries(base)) result[r] = v + add;
  return result;
}

export function canAffordBuilding(room, type) {
  const cost = scaledCost(room, type);
  const res = {wood: room.wood, stone: room.stone, iron: room.iron, food: room.food, crops: room.crops, gold: room.gold};
  return Object.entries(cost).every(([r,n]) => (res[r]||0) >= n);
}

const SOLID_TYPES = new Set([0,1,3,6,7,9]);

export function rebuildNavBlocked(room) {
  if (typeof room.navBlockedVersion === 'number') room.navBlockedVersion++;
  room.navBlocked.fill(0);
  room.villagerBlocked.fill(0);
  for (const b of room.buildings) {
    if (!b.complete) continue;
    if (b.type === 2) {
      for (let dy=0; dy<b.h; dy++) for (let dx=0; dx<b.w; dx++) {
        const i = (b.ty+dy)*MAP_W+(b.tx+dx);
        room.navBlocked[i] = 1;
        room.villagerBlocked[i] = 1;
      }
    }
    if (SOLID_TYPES.has(b.type)) {
      for (let dy=0; dy<b.h; dy++) for (let dx=0; dx<b.w; dx++) {
        const i = (b.ty+dy)*MAP_W+(b.tx+dx);
        room.navBlocked[i] = 1;
        room.villagerBlocked[i] = 1;
      }
    }
  }
  for (const t of room.trees) {
    room.villagerBlocked[t.ty * MAP_W + t.tx] = 1;
  }
}

export function placeBuilding(room, tx, ty, type) {
  if (!canBuildAt(room, tx, ty, type)) return false;
  if (!canAffordBuilding(room, type)) { room.notify('Not enough resources!'); return false; }
  const cost = scaledCost(room, type);
  if (cost.wood)  room.wood  -= cost.wood;
  if (cost.stone) room.stone -= cost.stone;
  if (cost.iron)  room.iron  -= cost.iron;
  if (cost.gold)  room.gold  -= cost.gold;
  room.buildCounts[type] = (room.buildCounts[type] || 0) + 1;
  if (type === 8) {
    room.roadTiles.add(ty*MAP_W+tx);
    return true;
  }
  room.buildings.push(mkBuilding(room, type, tx, ty));
  rebuildNavBlocked(room);
  return true;
}

export function upgradeBuilding(kingdom, buildingId) {
  const b = kingdom.buildings.find(b => b.id === buildingId && b.complete);
  if (!b) return false;
  const costs = BLDG_TIER_COSTS[b.type];
  if (!costs) return false;
  const tier = b.tier || 1;
  if (tier >= 3) return false;
  const cost = costs[tier - 1];
  if (!cost) return false;

  // Non-Forge buildings require the appropriate Forge tier
  if (b.type !== 7) {
    const bestForgeTier = kingdom.buildings
      .filter(fb => fb.type === 7 && fb.complete)
      .reduce((best, fb) => Math.max(best, fb.tier || 1), 0);
    if (bestForgeTier < tier + 1) return false;
  }

  // Check resources
  const res = { wood: kingdom.wood, stone: kingdom.stone, iron: kingdom.iron, gold: kingdom.gold };
  for (const [r, v] of Object.entries(cost)) { if ((res[r] || 0) < v) return false; }

  // Deduct resources
  for (const [r, v] of Object.entries(cost)) kingdom[r] -= v;

  b.tier = tier + 1;
  b.maxHp = Math.round(b.maxHp * 1.3);  // each tier adds 30% more HP
  b.hp = Math.min(b.hp + Math.round(b.maxHp * 0.3), b.maxHp);
  return true;
}

export function findBuildTarget(room, builder) {
  let best = null, bestDist = Infinity;
  for (const b of room.buildings) {
    if (b.complete) continue;
    const activeCount = room.villagers.filter(o =>
      o.id !== builder.id && o.buildTarget === b.id &&
      (o.state === 'building' || o.state === 'moving')
    ).length;
    if (activeCount >= STRUCT_MAX_BUILDERS) continue;
    const d = Math.abs(b.tx - builder.tx) + Math.abs(b.ty - builder.ty);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

export function assignBuilderTo(room, builder, bld) {
  const path = findPath(Math.floor(builder.x), Math.floor(builder.y), bld.tx, bld.ty, room.villagerBlocked, room);
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
}

const OUTPOST_RADIUS = 6; // supply line reach in tiles

export function calcAdjacencyBonus(room, b) {
  if (!b.complete) { b.adjacencyBonus = 1.0; return; }
  const table = ADJACENCY_TABLE[b.type];
  let bonus = 1.0;
  if (table) {
    for (const other of room.buildings) {
      if (!other.complete || other.id === b.id) continue;
      const radius = other.type === 9 ? OUTPOST_RADIUS : 1;
      if (Math.abs(other.tx - b.tx) <= radius && Math.abs(other.ty - b.ty) <= radius) {
        bonus += table[other.type] ?? 0;
      }
    }
  }
  b.adjacencyBonus = Math.min(Math.max(0.5, bonus), 2.0);
}

export function updateNeighborBonuses(room, tx, ty, radius = 1) {
  for (const b of room.buildings) {
    if (!b.complete) continue;
    if (Math.abs(b.tx - tx) <= radius && Math.abs(b.ty - ty) <= radius) {
      calcAdjacencyBonus(room, b);
    }
  }
}

export function activateOutpostNodes(room, outpost) {
  const radius = 14;
  for (const node of room.resourceNodes) {
    if (!node.active && Math.hypot(node.tx-outpost.tx, node.ty-outpost.ty) <= radius) {
      node.active = true;
      if (node.discovered) room.notify(`${NODE_NAMES[node.type]} activated by Outpost!`);
    }
  }
}
