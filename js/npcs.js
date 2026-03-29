// ── npcs.js ──

// ═══════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════
const NPC_VISIT_INTERVAL = 90;   // seconds between visit checks when eligible
const NPC_TERRITORY_REQ  = 28;   // minimum territory radius before visitors appear
const NPC_VISIT_CHANCE   = 0.72; // probability of spawning when the timer fires
const NPC_APPROACH_DIST  = 28;   // tiles from TC where visitors spawn
const NPC_WAIT_TIME      = 40;   // seconds an unresponded NPC waits before leaving
const NPC_SPEED          = 2.4;  // tiles/sec

// ── Palette overrides for NPC sprites ───────────────
// Trader: warm saffron-and-brown merchant (uses Basic villager sprite rows)
const NPC_TRADER_PAL = {
  '.':null,
  'H':'#8b5e1a', 'h':'#5a3c08',   // hat brim — deep amber
  's':'#d4a060', 'e':'#180800',   // skin, eyes
  't':'#c07820', 'T':'#804a08',   // tunic — saffron gold
  'b':'#5a3010',                  // boots
};
// Wandering Knight: crimson plate armour (uses Knight villager sprite rows)
const NPC_WKNIGHT_PAL = {
  '.':null,
  'K':'#c84040', 'k':'#601818',   // armour plate — crimson
  'V':'#0a0608',                  // visor darkness
  'A':'#a03030',                  // body plate
  'L':'#e05858',                  // highlight catch
};

const NPC_NAMES_TRADER = [
  'Oswald','Serra','Tomas','Finn','Devin','Rowan','Elspeth','Garold',
];
const NPC_NAMES_KNIGHT = [
  'Sir Gareth','Lord Vance','The Iron Rider','Sir Brom','Captain Holt','Sir Edric',
];

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

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let npcs          = [];
let _npcId        = 0;
let npcVisitTimer = 0;
let npcModal      = null; // NPC whose modal is currently open

// ═══════════════════════════════════════════════════
//  FACTORY
// ═══════════════════════════════════════════════════
function _pickFromArr(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

function generateTradeOffers() {
  const pool = TRADE_POOL.slice();
  for (let i=pool.length-1; i>0; i--) {
    const j=Math.floor(Math.random()*(i+1));
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  return pool.slice(0,3);
}

function mkNPC(type) {
  if (!townCenter) return null;
  // Spawn NPC_APPROACH_DIST tiles from TC in a random direction
  const angle = Math.random()*Math.PI*2;
  let sx = Math.round(townCenter.tx + Math.cos(angle)*NPC_APPROACH_DIST);
  let sy = Math.round(townCenter.ty + Math.sin(angle)*NPC_APPROACH_DIST);
  sx = Math.max(2, Math.min(MAP_W-3, sx));
  sy = Math.max(2, Math.min(MAP_H-3, sy));

  // Find nearest walkable tile to that point
  let btx=-1, bty=-1;
  outer: for (let r=0; r<=6; r++) {
    for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++) {
      if (Math.abs(dx)!==r && Math.abs(dy)!==r) continue; // perimeter only
      const nx=sx+dx, ny=sy+dy;
      if (nx<1||nx>=MAP_W-1||ny<1||ny>=MAP_H-1) continue;
      if (WALKABLE_TILES.has(mapTiles[ny][nx])) { btx=nx; bty=ny; break outer; }
    }
  }
  if (btx<0) return null;

  const path = findPath(btx, bty, townCenter.tx, townCenter.ty);
  if (!path || path.length < 2) return null;

  const npc = {
    id: _npcId++, type,
    x: btx+0.5, y: bty+0.5,
    tx: btx, ty: bty,
    path: path.slice(1),
    state: 'approaching',   // approaching | arrived | leaving | raiding | gone
    waitTimer: NPC_WAIT_TIME,
    _despawn: false,
    name: type==='trader' ? _pickFromArr(NPC_NAMES_TRADER) : _pickFromArr(NPC_NAMES_KNIGHT),
  };
  if (type==='trader') {
    npc.offers = generateTradeOffers();
  } else {
    npc.strength  = 1 + Math.floor(Math.random()*3);
    npc.raidTimer = 0;
  }
  return npc;
}

// ═══════════════════════════════════════════════════
//  UPDATE
// ═══════════════════════════════════════════════════
function updateNPCs(dt) {
  if (!settled) return;

  // ── Spawn a visitor ──
  if (getTerritoryRadius() >= NPC_TERRITORY_REQ && npcs.length === 0 && !npcModal) {
    npcVisitTimer += dt;
    if (npcVisitTimer >= NPC_VISIT_INTERVAL) {
      npcVisitTimer = 0;
      if (Math.random() < NPC_VISIT_CHANCE) {
        const type = Math.random() < 0.6 ? 'trader' : 'wanderingKnight';
        const npc  = mkNPC(type);
        if (npc) {
          npcs.push(npc);
          const msg = type==='trader' ? '⚜ A merchant approaches your realm…' : '⚔ A knight approaches your gates…';
          notify(msg);
        }
      }
    }
  }

  // ── Update each NPC ──
  for (const npc of npcs) {
    if (npc._despawn) continue;

    // Raiding countdown (knight off-screen earning plunder)
    if (npc.state === 'raiding') {
      npc.raidTimer -= dt;
      if (npc.raidTimer <= 0) {
        const base   = 15 + Math.floor(Math.random()*20);
        const reward = base * npc.strength;
        gold += reward;
        const shortName = npc.name.split(' ').pop();
        notify(`${shortName} returns — ${reward} ⚜ plundered!`);
        npc._despawn = true;
      }
      continue;
    }

    if (npc.state === 'gone') { npc._despawn=true; continue; }

    // Move along path
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
            npc.state='arrived';
            showNPCModal(npc);
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

    // Arrived and waiting for response
    if (npc.state==='arrived') {
      npc.waitTimer -= dt;
      if (npc.waitTimer <= 0) {
        // Timed out — dismiss and leave
        closeNPCModal(true);
      }
    }
  }

  // Clean up despawned
  npcs = npcs.filter(n=>!n._despawn);
}

// ── Build a leave path from current position to a random walkable edge point ──
function npcLeave(npc) {
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
      if (WALKABLE_TILES.has(mapTiles[ny][nx])) { ftx=nx; fty=ny; break outer2; }
    }
  }

  const path = findPath(npc.tx, npc.ty, ftx, fty);
  if (!path || path.length < 2) { npc.state='gone'; npc._despawn=true; return; }
  npc.path  = path.slice(1);
  npc.state = 'leaving';
}

// ═══════════════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════════════
function _resIcon(res) {
  return {gold:'⚜',wood:'🪵',stone:'🪨',iron:'⚙',food:'🍞',crops:'🌾'}[res] || res;
}

function showNPCModal(npc) {
  npcModal = npc;
  const modal  = document.getElementById('npc-modal');
  const nameEl = document.getElementById('npc-modal-name');
  const subEl  = document.getElementById('npc-modal-sub');
  const bodyEl = document.getElementById('npc-modal-body');
  const actEl  = document.getElementById('npc-modal-actions');

  nameEl.textContent = npc.name;
  bodyEl.innerHTML   = '';
  actEl.innerHTML    = '';

  if (npc.type === 'trader') {
    subEl.textContent = 'Travelling Merchant';
    bodyEl.innerHTML  = '<p>I carry goods from distant lands. Shall we do business?</p>';

    for (const offer of npc.offers) {
      const [gRes, gAmt] = Object.entries(offer.give)[0];
      const [wRes, wAmt] = Object.entries(offer.want)[0];
      const resNow = {wood,stone,iron,food,crops,gold};
      const canDo  = resNow[gRes] >= gAmt;
      const btn    = document.createElement('button');
      btn.className = 'npc-trade-btn' + (canDo ? '' : ' npc-btn-dim');
      btn.innerHTML =
        `<span class="npc-t-give">${gAmt}${_resIcon(gRes)}</span>` +
        `<span class="npc-t-arrow">→</span>` +
        `<span class="npc-t-want">${wAmt}${_resIcon(wRes)}</span>`;
      if (canDo) btn.addEventListener('click', ()=>_executeTrade(npc, offer));
      actEl.appendChild(btn);
    }

  } else {
    subEl.textContent = `Wandering Knight  ·  Strength ${npc.strength}`;
    bodyEl.innerHTML  = '<p>My sword is for hire. I can defend your walls, or ride out and bring back plunder.</p>';

    const hireBtn = document.createElement('button');
    hireBtn.className = 'npc-action-btn' + (gold>=30 ? '' : ' npc-btn-dim');
    hireBtn.innerHTML = `<span>Hire as Knight</span><span class="npc-cost">30⚜</span>`;
    if (gold >= 30) hireBtn.addEventListener('click', ()=>_hireKnight(npc));
    actEl.appendChild(hireBtn);

    const raidBtn = document.createElement('button');
    raidBtn.className = 'npc-action-btn' + (gold>=20 ? '' : ' npc-btn-dim');
    raidBtn.innerHTML = `<span>Send on Raid</span><span class="npc-cost">20⚜</span>`;
    if (gold >= 20) raidBtn.addEventListener('click', ()=>_sendRaid(npc));
    actEl.appendChild(raidBtn);
  }

  // Decline / close button
  const decBtn = document.createElement('button');
  decBtn.className = 'npc-decline-btn';
  decBtn.textContent = 'Send Away';
  decBtn.addEventListener('click', ()=>closeNPCModal(false));
  actEl.appendChild(decBtn);

  modal.classList.remove('npc-hidden');
}

function closeNPCModal(timedOut) {
  document.getElementById('npc-modal').classList.add('npc-hidden');
  if (npcModal) {
    if (timedOut) notify(`${npcModal.name} leaves without a deal.`);
    npcLeave(npcModal);
    npcModal = null;
  }
}

function _executeTrade(npc, offer) {
  const [gRes, gAmt] = Object.entries(offer.give)[0];
  const [wRes, wAmt] = Object.entries(offer.want)[0];
  const resNow = {wood,stone,iron,food,crops,gold};
  if (resNow[gRes] < gAmt) { notify('Not enough resources!', 'warn'); return; }

  if (gRes==='wood')  wood  -= gAmt; else if (gRes==='stone') stone -= gAmt;
  else if (gRes==='iron')  iron  -= gAmt; else if (gRes==='food')  food  -= gAmt;
  else if (gRes==='crops') crops -= gAmt; else if (gRes==='gold')  gold  -= gAmt;

  if (wRes==='wood')  wood  += wAmt; else if (wRes==='stone') stone += wAmt;
  else if (wRes==='iron')  iron  += wAmt; else if (wRes==='food')  food  += wAmt;
  else if (wRes==='crops') crops += wAmt; else if (wRes==='gold')  gold  += wAmt;

  notify(`Trade complete: ${offer.label}`);
  showNPCModal(npc); // refresh to update affordability
}

function _hireKnight(npc) {
  if (gold < 30) return;
  gold -= 30;
  if (townCenter && villagers.length < MAX_VILLAGERS) {
    const kv = mkVillager(VROLE.KNIGHT, townCenter.tx, townCenter.ty);
    kv.tier = Math.min(3, npc.strength);
    kv.xp   = npc.strength > 1 ? TIER_XP_REQ[npc.strength-2] : 0;
    villagers.push(kv);
    notify(`${npc.name} joins your kingdom as a Knight!`);
  } else {
    notify(`${npc.name} accepted your gold and guards the perimeter.`);
  }
  closeNPCModal(false);
}

function _sendRaid(npc) {
  if (gold < 20) return;
  gold -= 20;
  npc.raidTimer = 45 + Math.floor(Math.random()*20) + npc.strength*5;
  npc.state     = 'raiding';
  document.getElementById('npc-modal').classList.add('npc-hidden');
  npcModal = null;
  const shortName = npc.name.split(' ').pop();
  notify(`${shortName} rides out to plunder…`);
}
