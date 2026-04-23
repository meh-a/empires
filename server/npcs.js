// ── server/game/npcs.js ──
import {
  MAP_W, MAP_H, VROLE,
  NPC_VISIT_INTERVAL, NPC_TERRITORY_REQ, NPC_VISIT_CHANCE,
  NPC_APPROACH_DIST, NPC_WAIT_TIME, NPC_SPEED,
} from './constants.js';
import { WALKABLE_TILES, findPath } from './world.js';
import { getTerritoryRadius } from './buildings.js';
import { mkVillager, getPopCap, isNight } from './villager-ai.js';

const NPC_NAMES_TRADER = ['Oswald','Serra','Tomas','Finn','Devin','Rowan','Elspeth','Garold'];
const NPC_NAMES_KNIGHT = ['Sir Gareth','Lord Vance','The Iron Rider','Sir Brom','Captain Holt','Sir Edric'];

const TRADE_POOL = [
  { give:{wood: 8},  want:{gold:  5}, label:'8🪵 → 5⚜'   },
  { give:{stone:5},  want:{gold:  8}, label:'5🪨 → 8⚜'   },
  { give:{crops:10}, want:{gold:  4}, label:'10🌾 → 4⚜'  },
  { give:{gold:15},  want:{wood:  6}, label:'15⚜ → 6🪵'  },
  { give:{gold:20},  want:{stone: 4}, label:'20⚜ → 4🪨'  },
  { give:{food: 5},  want:{stone: 3}, label:'5🍞 → 3🪨'   },
  { give:{wood:12},  want:{stone: 5}, label:'12🪵 → 5🪨'  },
  { give:{iron: 2},  want:{gold: 15}, label:'2⚙ → 15⚜'   },
  { give:{gold:10},  want:{crops: 8}, label:'10⚜ → 8🌾'  },
  { give:{stone:8},  want:{wood: 12}, label:'8🪨 → 12🪵'  },
];

const CARAVAN_TRADE_POOL = [
  { give:{wood:28},  want:{gold: 18}, label:'28🪵 → 18⚜'  },
  { give:{stone:16}, want:{gold: 24}, label:'16🪨 → 24⚜'  },
  { give:{crops:30}, want:{gold: 14}, label:'30🌾 → 14⚜'  },
  { give:{gold:45},  want:{wood: 22}, label:'45⚜ → 22🪵'  },
  { give:{gold:55},  want:{stone:14}, label:'55⚜ → 14🪨'  },
  { give:{food:14},  want:{stone: 9}, label:'14🍞 → 9🪨'   },
  { give:{wood:32},  want:{stone:16}, label:'32🪵 → 16🪨'  },
  { give:{iron: 5},  want:{gold: 38}, label:'5⚙ → 38⚜'    },
  { give:{gold:28},  want:{crops:26}, label:'28⚜ → 26🌾'  },
  { give:{stone:22}, want:{wood: 32}, label:'22🪨 → 32🪵'  },
  { give:{gold:32},  want:{food: 14}, label:'32⚜ → 14🍞'  },
  { give:{iron: 3},  want:{wood: 28}, label:'3⚙ → 28🪵'   },
];

// Bandit constants
const BANDIT_SPEED        = 2.2;
const BANDIT_KIDNAP_RANGE = 0.8;
const BANDIT_FLEE_KNIGHT  = 5;

// ─── Helpers ──────────────────────────────────────────────────────
function _pickFromArr(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

function _shuffle(arr) {
  for (let i = arr.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

function generateTradeOffers()  { return _shuffle(TRADE_POOL.slice()).slice(0, 3); }
function generateCaravanOffers() { return _shuffle(CARAVAN_TRADE_POOL.slice()).slice(0, 5); }

// ═══════════════════════════════════════════════════
//  NPC FACTORY
// ═══════════════════════════════════════════════════
export function mkNPC(room, type) {
  if (!room.townCenter) return null;
  const angle = Math.random()*Math.PI*2;
  let sx = Math.round(room.townCenter.tx + Math.cos(angle)*NPC_APPROACH_DIST);
  let sy = Math.round(room.townCenter.ty + Math.sin(angle)*NPC_APPROACH_DIST);
  sx = Math.max(2, Math.min(MAP_W-3, sx));
  sy = Math.max(2, Math.min(MAP_H-3, sy));

  let btx=-1, bty=-1;
  outer: for (let r=0; r<=6; r++) {
    for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++) {
      if (Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
      const nx=sx+dx, ny=sy+dy;
      if (nx<1||nx>=MAP_W-1||ny<1||ny>=MAP_H-1) continue;
      if (WALKABLE_TILES.has(room.mapTiles[ny][nx])) { btx=nx; bty=ny; break outer; }
    }
  }
  if (btx<0) return null;

  // Prefer a path that respects walls (routing through gates); fall back to ignoring walls
  let path = findPath(btx, bty, room.townCenter.tx, room.townCenter.ty, room.navBlocked, room);
  if (!path || path.length < 2) path = findPath(btx, bty, room.townCenter.tx, room.townCenter.ty, null, room);
  if (!path || path.length < 2) return null;

  const isCaravan = type === 'trader' && Math.random() < 0.30;
  const npc = {
    id: room._npcId++, type,
    x: btx+0.5, y: bty+0.5,
    tx: btx, ty: bty,
    path: path.slice(1),
    state: 'approaching',
    waitTimer: NPC_WAIT_TIME,
    _despawn: false,
    name: type==='trader' ? _pickFromArr(NPC_NAMES_TRADER) : _pickFromArr(NPC_NAMES_KNIGHT),
    caravan: isCaravan,
  };
  if (type==='trader') {
    npc.offers = isCaravan ? generateCaravanOffers() : generateTradeOffers();
  } else {
    npc.strength  = 1 + Math.floor(Math.random()*3);
    npc.raidTimer = 0;
  }
  return npc;
}

function npcLeave(room, npc) {
  const angle = Math.random()*Math.PI*2;
  let ex = Math.round(npc.tx + Math.cos(angle)*NPC_APPROACH_DIST*1.3);
  let ey = Math.round(npc.ty + Math.sin(angle)*NPC_APPROACH_DIST*1.3);
  ex = Math.max(2, Math.min(MAP_W-3, ex));
  ey = Math.max(2, Math.min(MAP_H-3, ey));

  let ftx=ex, fty=ey;
  outer2: for (let r=0; r<=5; r++) {
    for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++) {
      if (Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
      const nx=ex+dx, ny=ey+dy;
      if (nx<1||nx>=MAP_W-1||ny<1||ny>=MAP_H-1) continue;
      if (WALKABLE_TILES.has(room.mapTiles[ny][nx])) { ftx=nx; fty=ny; break outer2; }
    }
  }

  let path = findPath(npc.tx, npc.ty, ftx, fty, room.navBlocked, room);
  if (!path || path.length < 2) path = findPath(npc.tx, npc.ty, ftx, fty, null, room);
  if (!path || path.length < 2) { npc.state='gone'; npc._despawn=true; return; }
  npc.path  = path.slice(1);
  npc.state = 'leaving';
}

// Server-side: when NPC arrives, push an event for the client to show modal
function npcArrived(room, npc) {
  npc.state = 'arrived';
  room.pendingEvents.push({ type: 'npc_arrived', npc: serializeNPC(npc) });
}

function serializeNPC(npc) {
  return {
    id: npc.id, type: npc.type, name: npc.name,
    x: npc.x, y: npc.y, state: npc.state,
    waitTimer: npc.waitTimer,
    offers: npc.offers,
    strength: npc.strength,
    caravan: npc.caravan || false,
  };
}

// ── Execute actions (called when client sends npc_action message) ──
export function handleNPCAction(room, npcId, action, offerIndex) {
  const npc = room.npcs.find(n => n.id === npcId);
  if (!npc || npc.state !== 'arrived') return;

  if (action === 'dismiss') {
    room.notify(`${npc.name} leaves without a deal.`);
    npcLeave(room, npc);
    room.npcModal = null;
    return;
  }

  if (npc.type === 'trader' && action === 'trade' && offerIndex != null) {
    const offer = npc.offers?.[offerIndex];
    if (!offer) return;
    const [gRes, gAmt] = Object.entries(offer.give)[0];
    const [wRes, wAmt] = Object.entries(offer.want)[0];
    const resNow = {wood:room.wood,stone:room.stone,iron:room.iron,food:room.food,crops:room.crops,gold:room.gold};
    if (resNow[gRes] < gAmt) { room.notify('Not enough resources!', 'warn'); return; }
    if (gRes==='wood')  room.wood  -= gAmt; else if (gRes==='stone') room.stone -= gAmt;
    else if (gRes==='iron') room.iron  -= gAmt; else if (gRes==='food')  room.food  -= gAmt;
    else if (gRes==='crops') room.crops -= gAmt; else if (gRes==='gold')  room.gold  -= gAmt;
    if (wRes==='wood')  room.wood  += wAmt; else if (wRes==='stone') room.stone += wAmt;
    else if (wRes==='iron') room.iron  += wAmt; else if (wRes==='food')  room.food  += wAmt;
    else if (wRes==='crops') room.crops += wAmt; else if (wRes==='gold')  room.gold  += wAmt;
    room.notify(`Trade complete: ${offer.label}`);
    room.pendingEvents.push({ type: 'npc_dismiss' });
    npcLeave(room, npc);
    room.npcModal = null;
    return;
  }

  if (npc.type === 'wanderingKnight') {
    if (action === 'hire') {
      if (room.gold < 30) return;
      room.gold -= 30;
      if (room.townCenter && room.villagers.length < getPopCap(room)) {
        const kv = mkVillager(room, VROLE.KNIGHT, room.townCenter.tx, room.townCenter.ty);
        kv.tier = Math.min(3, npc.strength);
        kv.xp   = npc.strength > 1 ? [10,30][npc.strength-2] : 0;
        room.villagers.push(kv);
        room.notify(`${npc.name} joins your kingdom as a Knight!`);
      } else {
        room.notify(`${npc.name} accepted your gold and guards the perimeter.`);
      }
      npcLeave(room, npc);
      room.npcModal = null;
      return;
    }
    if (action === 'raid') {
      if (room.gold < 20) return;
      room.gold -= 20;
      npc.raidTimer = 45 + Math.floor(Math.random()*20) + npc.strength*5;
      npc.state = 'raiding';
      room.npcModal = null;
      const shortName = npc.name.split(' ').pop();
      room.notify(`${shortName} rides out to plunder…`);
      return;
    }
  }
}

// ═══════════════════════════════════════════════════
//  MAIN UPDATE
// ═══════════════════════════════════════════════════
export function updateNPCs(room, dt) {
  if (!room.settled) return;

  if (getTerritoryRadius(room) >= NPC_TERRITORY_REQ && room.npcs.length === 0 && !room.npcModal) {
    room.npcVisitTimer += dt;
    if (room.npcVisitTimer >= NPC_VISIT_INTERVAL) {
      room.npcVisitTimer = 0;
      if (Math.random() < NPC_VISIT_CHANCE) {
        const type = Math.random() < 0.80 ? 'trader' : 'wanderingKnight';
        const npc  = mkNPC(room, type);
        if (npc) {
          room.npcs.push(npc);
          let msg;
          if (type === 'trader')         msg = npc.caravan ? '⚜ A merchant caravan arrives at your gates!' : '⚜ A merchant approaches your realm…';
          else                           msg = '⚔ A wandering knight approaches your gates…';
          room.notify(msg);
        }
      }
    }
  }

  for (const npc of room.npcs) {
    if (npc._despawn) continue;

    if (npc.state === 'raiding') {
      npc.raidTimer -= dt;
      if (npc.raidTimer <= 0) {
        const base   = 15 + Math.floor(Math.random()*20);
        const reward = base * npc.strength;
        room.gold += reward;
        const shortName = npc.name.split(' ').pop();
        room.notify(`${shortName} returns — ${reward} ⚜ plundered!`);
        npc._despawn = true;
      }
      continue;
    }

    if (npc.state === 'gone') { npc._despawn=true; continue; }

    if (npc.path.length > 0) {
      const tgt=npc.path[0];
      const wx=tgt.x+0.5, wy=tgt.y+0.5;
      const dx=wx-npc.x, dy=wy-npc.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if (dist <= NPC_SPEED*dt+0.01) {
        npc.x=wx; npc.y=wy; npc.tx=tgt.x; npc.ty=tgt.y;
        npc.path.shift();
        if (npc.path.length===0) {
          if (npc.state==='approaching') {
            npcArrived(room, npc);
            room.npcModal = npc.id;
          } else if (npc.state==='leaving') {
            npc.state='gone';
          }
        }
      } else {
        npc.x += dx*NPC_SPEED*dt/dist;
        npc.y += dy*NPC_SPEED*dt/dist;
      }
      continue;
    }

    if (npc.state==='arrived') {
      npc.waitTimer -= dt;
      if (npc.waitTimer <= 0) {
        room.notify(`${npc.name} leaves without a deal.`);
        npcLeave(room, npc);
        room.npcModal = null;
      }
    }
  }

  // Separation
  for (let i=0; i<room.npcs.length; i++) {
    for (let j=i+1; j<room.npcs.length; j++) {
      const a=room.npcs[i], b=room.npcs[j];
      if (a._despawn || b._despawn) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if (dist < 1.0 && dist > 0.001) {
        const push=(1.0-dist)*0.5;
        const nx=dx/dist, ny=dy/dist;
        a.x -= nx*push; a.y -= ny*push;
        b.x += nx*push; b.y += ny*push;
      }
    }
  }

  room.npcs = room.npcs.filter(n=>!n._despawn);
}

// ═══════════════════════════════════════════════════
//  BANDITS
// ═══════════════════════════════════════════════════
function _banditSpawnTile(room) {
  const EDGE = 18;
  const candidates = [];
  for (let tries = 0; tries < 120; tries++) {
    const tx = Math.floor(Math.random() * MAP_W);
    const ty = Math.floor(Math.random() * MAP_H);
    if (room.mapTiles[ty]?.[tx] !== 4 /* T.FOREST */) continue;
    const nearEdge = tx < EDGE || tx >= MAP_W - EDGE || ty < EDGE || ty >= MAP_H - EDGE;
    if (nearEdge) { candidates.push({tx, ty}); if (candidates.length >= 4) break; }
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function _banditPickTarget(room, b) {
  let best = null, bestScore = -Infinity;
  for (const v of room.villagers) {
    if (v._despawn || v.state === 'sleeping') continue;
    if (v.role === VROLE.KNIGHT || v.role === VROLE.ARCHER) continue;
    const knightNear = room.villagers.some(k =>
      (k.role === VROLE.KNIGHT || k.role === VROLE.ARCHER) &&
      !k._despawn && Math.hypot(k.x - v.x, k.y - v.y) < BANDIT_FLEE_KNIGHT
    );
    if (knightNear) continue;
    const dist = Math.hypot(v.x - b.x, v.y - b.y);
    const score = -dist + (v.tired || 0) * 8 + (1 - (v.hunger || 1)) * 4;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best;
}

function _banditFlee(room, b) {
  const EDGE = 16;
  let ftx = -1, fty = -1;
  for (let tries = 0; tries < 80; tries++) {
    const tx = Math.floor(Math.random() * MAP_W);
    const ty = Math.floor(Math.random() * MAP_H);
    if (room.mapTiles[ty]?.[tx] !== 4 /* T.FOREST */) continue;
    const nearEdge = tx < EDGE || tx >= MAP_W - EDGE || ty < EDGE || ty >= MAP_H - EDGE;
    if (nearEdge) { ftx = tx; fty = ty; break; }
  }
  if (ftx < 0) { b._despawn = true; return; }
  const path = findPath(Math.floor(b.x), Math.floor(b.y), ftx, fty, room.navBlocked, room);
  if (!path || path.length < 2) { b._despawn = true; return; }
  b.path = path.slice(1);
  b.state = 'fleeing';
}

export function updateBandits(room, dt) {
  if (!room.settled || !room.mapTiles.length) return;

  if (isNight(room) && room.villagers.some(v => !v._despawn && v.state !== 'sleeping')) {
    room._banditSpawnTimer -= dt;
    if (room._banditSpawnTimer <= 0) {
      room._banditSpawnTimer = 40 + Math.random() * 50;
      const count = 1 + (Math.random() < 0.3 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const tile = _banditSpawnTile(room);
        if (!tile) continue;
        room.bandits.push({
          id: room._banditId++,
          x: tile.tx + 0.5, y: tile.ty + 0.5,
          tx: tile.tx, ty: tile.ty,
          path: [],
          state: 'stalking',
          targetId: null,
          _repath: 0,
          _despawn: false,
        });
      }
      if (room.bandits.some(b => !b._despawn))
        room.notify('🌑 Rogues emerge from the forest…', 'warn');
    }
  } else if (!isNight(room)) {
    room._banditSpawnTimer = 0;
  }

  for (const b of room.bandits) {
    if (b._despawn) continue;
    if (!isNight(room) && b.state === 'stalking') {
      _banditFlee(room, b);
      continue;
    }
    if (b.state === 'fleeing') {
      if (b.path.length === 0) { b._despawn = true; continue; }
    }
    if (b.state === 'stalking') {
      b._repath -= dt;
      let target = b.targetId != null
        ? room.villagers.find(v => v.id === b.targetId && !v._despawn && v.state !== 'sleeping')
        : null;
      if (target) {
        const scared = room.villagers.some(k =>
          (k.role === VROLE.KNIGHT || k.role === VROLE.ARCHER) &&
          !k._despawn && Math.hypot(k.x - b.x, k.y - b.y) < BANDIT_FLEE_KNIGHT
        );
        if (scared) { _banditFlee(room, b); continue; }
      }
      if (!target || b._repath <= 0) {
        target = _banditPickTarget(room, b);
        b.targetId = target ? target.id : null;
        b._repath = 3 + Math.random() * 2;
        if (target) {
          const path = findPath(Math.floor(b.x), Math.floor(b.y), target.tx, target.ty, room.navBlocked, room);
          b.path = (path && path.length > 1) ? path.slice(1) : [];
        }
      }
      if (target) {
        const dist = Math.hypot(target.x - b.x, target.y - b.y);
        if (dist < BANDIT_KIDNAP_RANGE) {
          room.notify(`😱 ${target.name} was kidnapped by a rogue!`, 'warn');
          target._despawn = true;
          b._despawn = true;
          continue;
        }
      } else if (b.path.length === 0) {
        b._repath = 5;
      }
    }

    if (b.path.length > 0) {
      const tgt = b.path[0];
      const wx = tgt.x + 0.5, wy = tgt.y + 0.5;
      const dx = wx - b.x, dy = wy - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= BANDIT_SPEED * dt + 0.01) {
        b.x = wx; b.y = wy; b.tx = tgt.x; b.ty = tgt.y;
        b.path.shift();
      } else {
        b.x += dx * BANDIT_SPEED * dt / dist;
        b.y += dy * BANDIT_SPEED * dt / dist;
      }
    }
  }

  room.bandits = room.bandits.filter(b => !b._despawn);
}
