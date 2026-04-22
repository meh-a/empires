// ── sp-net.js — singleplayer net layer (Worker instead of WebSocket) ──

let _worker        = null;
let _seedResolve   = null;
let myKingdomId    = 0;
let _netPlayerName = 'Wanderer';
let _pendingSettle = false;
let _accountTier4Slots = 0;
let _accountTier5Slots = 0;
let _lastStateTime = 0;

// ── Connect: spawn the worker and start the game ─────────────────
function netConnect(playerName) {
  _netPlayerName = (playerName || 'Wanderer').trim().slice(0, 18) || 'Wanderer';
  return new Promise(resolve => {
    _seedResolve = resolve;
    _worker = new Worker('/singleplayer/sp-worker.js', { type: 'module' });
    _worker.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      _handleServerMessage(msg);
    };
    _worker.postMessage({ _init: true, playerName: _netPlayerName });
  });
}

function netDisconnect() {
  if (_worker) { _worker.terminate(); _worker = null; }
}

function netSend(data) {
  if (_worker) _worker.postMessage(data);
}

// ── Receive messages from worker ─────────────────────────────────
function _handleServerMessage(msg) {
  switch (msg.type) {
    case 'loading': {
      const bar = document.getElementById('loading-bar-fill');
      if (bar) bar.style.width = Math.max(10, msg.pct).toFixed(0) + '%';
      break;
    }
    case 'ready':
    case 'init':
      myKingdomId = msg.myKingdomId ?? 0;
      if (msg.trees) trees = msg.trees;
      if (_seedResolve) {
        _seedResolve(msg.seed);
        _seedResolve = null;
        // Push tier slots to worker so upgrades work correctly
        if (_accountTier4Slots > 0 || _accountTier5Slots > 0) {
          netSend({ type: 'account_login', username: _accountUsername || '', password: '', tier4Slots: _accountTier4Slots, tier5Slots: _accountTier5Slots });
        }
      }
      break;
    case 'state':
      _applyState(msg);
      break;
  }
}

// ── Interpolation ─────────────────────────────────────────────────
function _attachInterp(arr, snap) {
  for (const e of arr) {
    const prev = snap.get(e.id);
    if (prev && Math.hypot(e.x - prev.x, e.y - prev.y) < 6) {
      e._p0x = prev.toX; e._p0y = prev.toY;
      e._fromX = prev.x; e._fromY = prev.y;
    } else {
      e._p0x = e.x; e._p0y = e.y;
      e._fromX = e.x; e._fromY = e.y;
    }
    e._toX = e.x; e._toY = e.y;
    e.x = e._fromX; e.y = e._fromY;
  }
}

function advanceInterp() {
  const t = Math.min(1, (performance.now() - _lastStateTime) / 100);
  for (const e of villagers)  _lerpEntity(e, t);
  for (const e of enemyUnits) _lerpEntity(e, t);
  for (const e of npcs)       _lerpEntity(e, t);
  for (const e of bandits)    _lerpEntity(e, t);
  const sz = TILE_SZ * zoom;
  const wx0 = camX / sz - 1, wx1 = (camX + canvas.width)  / sz + 1;
  const wy0 = camY / sz - 1, wy1 = (camY + canvas.height) / sz + 1;
  for (const ek of enemyKingdoms)
    for (const ev of ek.villagers)
      if (ev.x >= wx0 && ev.x <= wx1 && ev.y >= wy0 && ev.y <= wy1)
        _lerpEntity(ev, t);
}

function _lerpEntity(e, t) {
  if (e._fromX === undefined) return;
  const p0x = e._p0x ?? e._fromX, p0y = e._p0y ?? e._fromY;
  const p3x = e._toX + (e._toX - e._fromX);
  const p3y = e._toY + (e._toY - e._fromY);
  const t2 = t * t, t3 = t2 * t;
  e.x = 0.5 * ((2*e._fromX) + (-p0x + e._toX)*t + (2*p0x - 5*e._fromX + 4*e._toX - p3x)*t2 + (-p0x + 3*e._fromX - 3*e._toX + p3x)*t3);
  e.y = 0.5 * ((2*e._fromY) + (-p0y + e._toY)*t + (2*p0y - 5*e._fromY + 4*e._toY - p3y)*t2 + (-p0y + 3*e._fromY - 3*e._toY + p3y)*t3);
}

// ── Apply server state snapshot ───────────────────────────────────
function _applyState(s) {
  gold  = s.gold;  wood  = s.wood;  food  = s.food;
  crops = s.crops; stone = s.stone; iron  = s.iron;
  if (s.toolStock) toolStock = s.toolStock;

  dayTime   = s.dayTime;
  day       = s.day;
  season    = s.season ?? Math.floor((s.day - 1) / SEASON_LENGTH) % 4;
  gameState = s.gameState;
  alertMode = s.alertMode;
  if (s.tier4Slots !== undefined) _accountTier4Slots = s.tier4Slots;
  if (s.tier5Slots !== undefined) _accountTier5Slots = s.tier5Slots;

  if (_pendingSettle) {
    if (s.settled) { _pendingSettle = false; settled = true; townCenter = s.townCenter; }
  } else {
    settled    = s.settled;
    townCenter = s.townCenter;
  }

  const _snap = e => ({ x: e.x, y: e.y, toX: e._toX ?? e.x, toY: e._toY ?? e.y });
  const _vSnap   = new Map(villagers .map(e => [e.id, _snap(e)]));
  const _euSnap  = new Map(enemyUnits.map(e => [e.id, _snap(e)]));
  const _nSnap   = new Map(npcs      .map(e => [e.id, _snap(e)]));
  const _bSnap   = new Map(bandits   .map(e => [e.id, _snap(e)]));
  const _ekVSnap = new Map();
  for (const ek of enemyKingdoms)
    for (const ev of ek.villagers) _ekVSnap.set(ev.id, _snap(ev));

  villagers     = s.villagers     || [];
  buildings     = s.buildings     || [];
  rebuildNavBlocked();
  if (s.removedTreeIds?.length) {
    const removed = new Set(s.removedTreeIds);
    trees = trees.filter(t => !removed.has(t.id));
  }
  enemyKingdoms = s.enemyKingdoms || [];
  enemyUnits    = s.enemyUnits    || [];
  projectiles   = s.projectiles   || [];
  npcs          = s.npcs          || [];
  bandits       = s.bandits       || [];

  if (s.tileChanges && mapTiles.length) {
    for (const { ty, tx, tile } of s.tileChanges) {
      if (mapTiles[ty]) mapTiles[ty][tx] = tile;
    }
  }

  if (s.roadTiles) roadTiles = new Set(s.roadTiles);

  if (typeof updateFog === 'function') updateFog();

  _lastStateTime = performance.now();
  _attachInterp(villagers,  _vSnap);
  _attachInterp(enemyUnits, _euSnap);
  _attachInterp(npcs,       _nSnap);
  _attachInterp(bandits,    _bSnap);
  for (const ek of enemyKingdoms) _attachInterp(ek.villagers, _ekVSnap);

  _choppingIds = new Set(
    villagers.filter(v => v.state === 'chopping' && v.chopTarget)
             .map(v => v.chopTarget.id)
  );

  if (selectedVillager) {
    const fresh = villagers.find(v => v.id === selectedVillager.id);
    selectedVillager = fresh || null;
    if (!fresh) vpanel?.classList.remove('visible');
  }

  if (possessedVillager) {
    const fresh = villagers.find(v => v.id === possessedVillager.id);
    if (!fresh) {
      possessedVillager = null;
      document.getElementById('possess-bar')?.classList.add('hidden');
      document.getElementById('dpad')?.classList.add('hidden');
    } else {
      possessedVillager = fresh;
    }
  }

  if (s.events) {
    for (const ev of s.events) {
      if (ev.type === 'chat') _chatReceive(ev.name, ev.text);
    }
  }

  if (s.claimedQuests && typeof syncClaimedQuests === 'function') {
    syncClaimedQuests(s.claimedQuests);
  }

  if (s.events) {
    for (const ev of s.events) {
      if (ev.type === 'notify')      notify(ev.msg, ev.notifyType);
      if (ev.type === 'npc_arrived') _openNpcModal(ev.npc);
      if (ev.type === 'npc_dismiss') { document.getElementById('npc-modal')?.classList.add('npc-hidden'); npcModal = null; }
      if (ev.type === 'defeat')      _showDefeat();
      if (ev.type === 'victory')     _showVictory();
      if (ev.type === 'hit')         dmgNumbers.push({ wx: ev.wx, wy: ev.wy, dmg: String(ev.dmg), color: ev.color, life: 1.0 });
      if (ev.type === 'unit_killed') spawnDeathParticles(ev.wx, ev.wy, ev.color);
      if (ev.type === 'loot_drop') {
        const sz = TILE_SZ * zoom;
        lootDrops.push({ sx: ev.wx * sz - camX, sy: ev.wy * sz - camY, amount: ev.amount, t: 0 });
      }
    }
  }

  if (s.gameState === 'defeat') {
    const el = document.getElementById('gameover');
    if (el && el.classList.contains('go-hidden')) _showDefeat();
  }

  if (!buildMode && settled) _refreshFabIcon();
  refreshBuildingPanelIfOpen();
  if (typeof updateVillagerPanel === 'function') updateVillagerPanel();
}

function _refreshFabIcon() {
  const fab = document.getElementById('build-fab');
  if (!fab) return;
  const anyAffordable = STRUCT_COST.some((_, i) => canAffordBuilding(i));
  fab.innerHTML = anyAffordable ? iconHTML('hammer', 22) : '×';
  fab.title = anyAffordable ? '' : 'Nothing to build';
}

function _rleDecode(rle, arr) {
  let idx = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    arr.fill(rle[i], idx, idx + rle[i + 1]);
    idx += rle[i + 1];
  }
}

// ── NPC modal ─────────────────────────────────────────────────────
function _openNpcModal(npc) {
  npcModal = npc;
  const modal  = document.getElementById('npc-modal');
  const nameEl = document.getElementById('npc-modal-name');
  const subEl  = document.getElementById('npc-modal-sub');
  const bodyEl = document.getElementById('npc-modal-body');
  const actEl  = document.getElementById('npc-modal-actions');
  nameEl.textContent = npc.name;
  bodyEl.innerHTML   = '';
  actEl.innerHTML    = '';
  const _icon = r => iconHTML(r, 12) || r[0].toUpperCase();
  if (npc.type === 'trader') {
    subEl.textContent = npc.caravan ? 'Merchant Caravan' : 'Travelling Merchant';
    bodyEl.innerHTML  = npc.caravan
      ? '<p>We\'ve hauled these goods across three kingdoms. Choose one deal — we move on at dawn.</p>'
      : '<p>I carry goods from distant lands. Choose one deal — then I must be on my way.</p>';
    for (let i = 0; i < (npc.offers || []).length; i++) {
      const offer = npc.offers[i];
      const [gRes, gAmt] = Object.entries(offer.give)[0];
      const [wRes, wAmt] = Object.entries(offer.want)[0];
      const canDo = ({wood,stone,iron,food,crops,gold})[gRes] >= gAmt;
      const btn = document.createElement('button');
      btn.className = 'npc-trade-btn' + (canDo ? '' : ' npc-btn-dim');
      btn.innerHTML = `<span class="npc-t-give">${gAmt}${_icon(gRes)}</span><span class="npc-t-arrow">→</span><span class="npc-t-want">${wAmt}${_icon(wRes)}</span>`;
      if (canDo) btn.addEventListener('click', () => {
        netSend({ type: 'npc_action', npcId: npc.id, action: 'trade', offerIndex: i });
      });
      actEl.appendChild(btn);
    }
  } else {
    subEl.textContent = `Wandering Knight  ·  Strength ${npc.strength}`;
    bodyEl.innerHTML  = '<p>My sword is for hire. I can defend your walls, or ride out and bring back plunder.</p>';
    const hireBtn = document.createElement('button');
    hireBtn.className = 'npc-action-btn' + (gold >= 30 ? '' : ' npc-btn-dim');
    hireBtn.innerHTML = `<span>Hire as Knight</span><span class="npc-cost">30${iconHTML('gold',12)}</span>`;
    if (gold >= 30) hireBtn.addEventListener('click', () => {
      netSend({ type: 'npc_action', npcId: npc.id, action: 'hire' });
      modal.classList.add('npc-hidden');
      npcModal = null;
    });
    actEl.appendChild(hireBtn);
    const raidBtn = document.createElement('button');
    raidBtn.className = 'npc-action-btn' + (gold >= 20 ? '' : ' npc-btn-dim');
    raidBtn.innerHTML = `<span>Send on Raid</span><span class="npc-cost">20${iconHTML('gold',12)}</span>`;
    if (gold >= 20) raidBtn.addEventListener('click', () => {
      netSend({ type: 'npc_action', npcId: npc.id, action: 'raid' });
      modal.classList.add('npc-hidden');
      npcModal = null;
    });
    actEl.appendChild(raidBtn);
  }
  const decBtn = document.createElement('button');
  decBtn.className = 'npc-decline-btn';
  decBtn.textContent = 'Send Away';
  decBtn.addEventListener('click', () => {
    netSend({ type: 'npc_action', npcId: npc.id, action: 'dismiss' });
    modal.classList.add('npc-hidden');
    npcModal = null;
  });
  actEl.appendChild(decBtn);
  modal.classList.remove('npc-hidden');
}

// ── Game over ─────────────────────────────────────────────────────
function _applyGameOverTheme(isVictory) {
  const accent   = isVictory ? '200,146,42'  : '180,50,30';
  const orb      = isVictory ? 'rgba(180,110,10,0.18)'  : 'rgba(160,30,10,0.20)';
  const titleCol = isVictory ? '#d4a040'     : '#c04030';
  const titleGlow= isVictory ? `0 0 60px rgba(200,146,42,0.6)` : `0 0 60px rgba(180,50,30,0.7)`;
  const border   = isVictory ? 'rgba(200,146,42,0.35)' : 'rgba(180,50,30,0.35)';
  const shadow   = isVictory
    ? '0 0 0 1px rgba(200,146,42,0.08), 0 0 80px rgba(200,146,42,0.08), 0 32px 80px rgba(0,0,0,0.9)'
    : '0 0 0 1px rgba(180,50,30,0.08), 0 0 80px rgba(180,50,30,0.10), 0 32px 80px rgba(0,0,0,0.9)';
  const divider  = isVictory ? 'rgba(200,146,42,0.22)' : 'rgba(180,50,30,0.22)';
  const statCol  = isVictory ? '#c8922a' : '#c04030';
  const btnBg    = isVictory ? 'rgba(200,146,42,0.13)' : 'rgba(180,50,30,0.13)';
  const btnBdr   = isVictory ? 'rgba(200,146,42,0.45)' : 'rgba(180,50,30,0.45)';
  const btnCol   = isVictory ? '#d4a040' : '#d04030';
  document.getElementById('go-orb').style.background   = orb;
  const card = document.getElementById('go-card');
  card.style.borderColor = border;
  card.style.boxShadow   = shadow;
  document.getElementById('go-title').style.color      = titleCol;
  document.getElementById('go-title').style.textShadow = titleGlow;
  document.getElementById('go-divider').style.background = divider;
  document.querySelectorAll('.go-stat-val').forEach(el => el.style.color = statCol);
  const btn = document.getElementById('go-btn');
  btn.style.background   = btnBg;
  btn.style.borderColor  = btnBdr;
  btn.style.color        = btnCol;
}

function _populateStats() {
  const daysEl = document.getElementById('go-stat-days');
  const popEl  = document.getElementById('go-stat-pop');
  const bldgEl = document.getElementById('go-stat-bldg');
  if (daysEl) _countUp(daysEl, day);
  if (popEl)  _countUp(popEl,  villagers ? villagers.length : 0);
  if (bldgEl) _countUp(bldgEl, buildings ? buildings.filter(b => b.complete).length : 0);
}

function _countUp(el, target) {
  const dur = 900, steps = 24;
  let i = 0;
  const iv = setInterval(() => {
    i++;
    el.textContent = Math.round(target * Math.min(1, i / steps));
    if (i >= steps) clearInterval(iv);
  }, dur / steps);
}

function _showGameOver(isVictory) {
  const el = document.getElementById('gameover');
  if (!el || !el.classList.contains('go-hidden')) return;
  setIconEl(document.getElementById('go-icon'), isVictory ? 'gold' : 'skull', 52);
  document.getElementById('go-title').textContent = isVictory ? 'Victory' : 'Kingdom Fallen';
  document.getElementById('go-sub').textContent   = isVictory ? 'Your kingdom stands supreme' : 'Your town center was destroyed';
  _applyGameOverTheme(isVictory);
  _populateStats();
  const rew = document.getElementById('go-reward');
  if (rew) {
    if (_accountUsername && gold > 0) {
      _saveLocalGold(gold);
      rew.innerHTML = `${gold} ${iconHTML('gold', 12)} saved to account`;
    } else if (!_accountUsername) {
      rew.innerHTML = `${gold} ${iconHTML('gold', 12)} earned — log in to save`;
    } else {
      rew.textContent = '';
    }
  }
  el.classList.remove('go-hidden');
}

function _showDefeat()  { _showGameOver(false); }
function _showVictory() { _showGameOver(true);  }

// ── Local accounts (localStorage) ────────────────────────────────
const _LS_KEY = 'empires_sp_accounts';
let _accountUsername   = null;
let _accountBalance    = 0;

function _lsLoad() {
  try { return JSON.parse(localStorage.getItem(_LS_KEY) || '{}'); } catch { return {}; }
}
function _lsSave(accounts) {
  localStorage.setItem(_LS_KEY, JSON.stringify(accounts));
}

function openAccountModal() {
  _refreshAccountUI();
  const m = document.getElementById('account-modal');
  if (m) m.classList.remove('hidden');
}
function closeAccountModal() {
  const m = document.getElementById('account-modal');
  if (m) m.classList.add('hidden');
}

function accountLogin() {
  const u = document.getElementById('acc-user')?.value.trim();
  const p = document.getElementById('acc-pass')?.value;
  if (!u || !p) return;
  const accounts = _lsLoad();
  const acc = accounts[u];
  if (!acc || acc.password !== p) { _setAccountStatus('Invalid username or password', true); return; }
  _accountUsername = u;
  _accountBalance  = acc.balance || 0;
  _accountTier4Slots = acc.tier4Slots || 0;
  _accountTier5Slots = acc.tier5Slots || 0;
  _refreshAccountUI();
  _setAccountStatus('');
}

function accountRegister() {
  const u = document.getElementById('acc-user')?.value.trim();
  const p = document.getElementById('acc-pass')?.value;
  if (!u || u.length < 2 || u.length > 24) { _setAccountStatus('Username must be 2–24 chars', true); return; }
  if (!p || p.length < 4) { _setAccountStatus('Password must be 4+ chars', true); return; }
  const accounts = _lsLoad();
  if (accounts[u]) { _setAccountStatus('Username already taken', true); return; }
  accounts[u] = { password: p, balance: 0, tier4Slots: 0, tier5Slots: 0 };
  _lsSave(accounts);
  _accountUsername = u;
  _accountBalance  = 0;
  _accountTier4Slots = 0;
  _accountTier5Slots = 0;
  _refreshAccountUI();
  _setAccountStatus('');
}

function accountLogout() {
  _accountUsername = null;
  _accountBalance  = 0;
  _accountTier4Slots = 0;
  _accountTier5Slots = 0;
  _refreshAccountUI();
}

function accountPurchaseSlot(tier) {
  if (!_accountUsername) return;
  const accounts = _lsLoad();
  const acc = accounts[_accountUsername];
  if (!acc) return;
  const current = tier === 4 ? (acc.tier4Slots || 0) : (acc.tier5Slots || 0);
  const cost = (tier === 4 ? 1000 : 1500) + current * 500;
  if (acc.balance < cost) { _setAccountStatus(`Need ${cost} gold (you have ${acc.balance})`, true); return; }
  acc.balance -= cost;
  if (tier === 4) acc.tier4Slots = (acc.tier4Slots || 0) + 1;
  else            acc.tier5Slots = (acc.tier5Slots || 0) + 1;
  _lsSave(accounts);
  _accountBalance    = acc.balance;
  _accountTier4Slots = acc.tier4Slots;
  _accountTier5Slots = acc.tier5Slots;
  _refreshAccountUI();
}

function _saveLocalGold(amount) {
  if (!_accountUsername || amount <= 0) return;
  const accounts = _lsLoad();
  if (!accounts[_accountUsername]) return;
  accounts[_accountUsername].balance = (accounts[_accountUsername].balance || 0) + Math.floor(amount);
  _accountBalance = accounts[_accountUsername].balance;
  _lsSave(accounts);
}

function _refreshAccountUI() {
  const loggedIn = !!_accountUsername;
  const panel    = document.getElementById('account-panel');
  const topbarBtn = document.getElementById('topbar-account-btn');
  if (topbarBtn) topbarBtn.textContent = loggedIn ? _accountUsername : 'Account';
  if (!panel) return;
  if (loggedIn) {
    const t4Cost = 1000 + _accountTier4Slots * 500;
    const t5Cost = 1500 + _accountTier5Slots * 500;
    panel.innerHTML = `
      <div class="acc-label">Account</div>
      <div class="acc-row">
        <span class="acc-name">${iconHTML('gold',12)} ${_accountUsername}</span>
        <span class="acc-balance">${_accountBalance.toLocaleString()} gold</span>
        <button class="acc-logout" onclick="accountLogout()">Logout</button>
      </div>
      <div class="acc-slots">Tier IV slots: <b>${_accountTier4Slots}</b> &nbsp;·&nbsp; Tier V slots: <b>${_accountTier5Slots}</b></div>
      <div class="acc-btns">
        <button class="acc-buy-btn" onclick="accountPurchaseSlot(4)" ${_accountBalance < t4Cost ? 'disabled' : ''}>
          Buy T4 Slot — ${t4Cost.toLocaleString()} ${iconHTML('gold',12)}
        </button>
        <button class="acc-buy-btn" onclick="accountPurchaseSlot(5)" ${_accountBalance < t5Cost ? 'disabled' : ''}>
          Buy T5 Slot — ${t5Cost.toLocaleString()} ${iconHTML('gold',12)}
        </button>
      </div>
      <div class="acc-status" id="acc-status"></div>`;
  } else {
    panel.innerHTML = `
      <div class="acc-label">Save progress across sessions</div>
      <div class="acc-form">
        <input id="acc-user" class="acc-input" type="text" maxlength="24" placeholder="Username" autocomplete="off">
        <input id="acc-pass" class="acc-input" type="password" maxlength="64" placeholder="Password">
        <div class="acc-form-btns">
          <button class="acc-buy-btn" onclick="accountLogin()">Login</button>
          <button class="acc-buy-btn" onclick="accountRegister()">Register</button>
        </div>
      </div>
      <div class="acc-status" id="acc-status"></div>`;
    document.getElementById('acc-user')?.addEventListener('keydown', e => { if (e.key==='Enter') accountLogin(); });
    document.getElementById('acc-pass')?.addEventListener('keydown', e => { if (e.key==='Enter') accountLogin(); });
  }
}

function _setAccountStatus(msg, isError) {
  const el = document.getElementById('acc-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#d06040' : '#80b870';
}

function openLeaderboard()  {}
function closeLeaderboard() {}
function goOffline() {}
function _reconnectUI() {}

// ── Chat ──────────────────────────────────────────────────────────
const _CHAT_MAX = 60;
let _chatMessages = [];
let _chatOpen = false;
let _chatFadeTimer = null;

function _chatReceive(name, text) {
  const log = document.getElementById('chat-log');
  if (!log) return;
  _chatMessages.push({ name, text });
  if (_chatMessages.length > _CHAT_MAX) _chatMessages.shift();
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-name">${name}:</span> ${text.replace(/</g,'&lt;')}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  _chatShowLog();
  _resetChatFade();
}

function _chatShowLog() {
  const log = document.getElementById('chat-log');
  if (log && log.children.length) log.style.display = '';
}

function _resetChatFade() {
  if (_chatOpen) return;
  if (_chatFadeTimer) clearTimeout(_chatFadeTimer);
  _chatFadeTimer = setTimeout(() => {
    if (!_chatOpen) document.getElementById('chat-log').style.display = 'none';
  }, 6000);
}

function openChat() {
  if (_chatOpen) return;
  _chatOpen = true;
  if (_chatFadeTimer) { clearTimeout(_chatFadeTimer); _chatFadeTimer = null; }
  const row   = document.getElementById('chat-input-row');
  const log   = document.getElementById('chat-log');
  const input = document.getElementById('chat-input');
  if (log && log.children.length) log.style.display = '';
  row.classList.add('open');
  input.value = '';
  input.focus();
}

function closeChat() {
  _chatOpen = false;
  document.getElementById('chat-input-row').classList.remove('open');
  document.getElementById('chat-input').blur();
  _resetChatFade();
}

function _sendChat() {
  const input = document.getElementById('chat-input');
  const text  = (input.value || '').trim();
  if (text) {
    _chatReceive('You', text);
    netSend({ type: 'chat', text });
  }
  closeChat();
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chat-input');
  if (!input) return;
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter')  { e.preventDefault(); _sendChat(); }
    if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
  });
});
