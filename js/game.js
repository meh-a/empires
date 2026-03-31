// ── game.js ──

// ═══════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════
function notify(msg, type) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' toast-'+type : '');
  el.textContent = msg;
  stack.appendChild(el);
  // Animate in
  requestAnimationFrame(()=>el.classList.add('toast-show'));
  setTimeout(()=>{
    el.classList.remove('toast-show');
    setTimeout(()=>el.remove(), 400);
  }, 2800);
}

// ═══════════════════════════════════════════════════
//  VILLAGER PANEL HUD
// ═══════════════════════════════════════════════════
const vpanel  = document.getElementById('villager-panel');
const vpName  = document.getElementById('vp-name');
const vpRole  = document.getElementById('vp-role');
const vpStatus= document.getElementById('vp-status');

function updateVillagerPanel() {
  if (!selectedVillager) { vpanel.classList.remove('visible'); return; }
  vpanel.classList.add('visible');
  const v = selectedVillager;

  // Role dot color
  const dot = document.getElementById('vp-dot');
  if (dot) {
    const rc = ROLE_COLOR[v.role] || [200,168,122];
    dot.style.background = `rgb(${rc[0]},${rc[1]},${rc[2]})`;
  }

  vpName.textContent = v.name;
  const tierLabel = ['I','II','III'][v.tier-1] || 'I';
  const toolLabel = ['Wood','Stone','Iron'][v.toolTier||0] || 'Wood';
  const toolSuffix = TOOL_ROLES.has(v.role) ? ` · ${toolLabel} Tools` : '';
  vpRole.textContent = `${v.role}`;

  // Tier pill
  const tierPill = document.getElementById('vp-tier');
  if (tierPill) tierPill.textContent = `Tier ${tierLabel}${toolSuffix}`;

  // XP bar
  const xpBar = document.getElementById('vp-xp-bar');
  const xpLabel = document.getElementById('vp-xp-label');
  if (xpBar && xpLabel) {
    if (v.tier < 3) {
      const req = v.tier === 1 ? TIER_XP_REQ[0] : TIER_XP_REQ[1];
      const base = v.tier === 1 ? 0 : TIER_XP_REQ[0];
      const pct = Math.min(100, ((v.xp - base) / (req - base)) * 100);
      xpBar.style.width = pct.toFixed(1) + '%';
      xpLabel.textContent = `${v.xp - base} / ${req - base} xp`;
    } else {
      xpBar.style.width = '100%';
      xpLabel.textContent = 'Max Tier';
    }
  }

  const labels = { idle:'Resting', roaming:'Wandering', patrolling:'Patrolling', moving:'Moving', building:'Building…', chopping:'Chopping…', sleeping:'Sleeping', farming:'Farming…', baking:'Baking…', mining:'Mining…', forging:'Forging…', guarding:'On Guard', repairing:'Repairing…', training:'Training…', exploring:'Exploring' };
  vpStatus.textContent = labels[v.state] || '—';
  const hv = document.getElementById('vp-hunger-val');
  if (hv) hv.textContent = Math.round(v.hunger*100) + '%';

  // Explorer note
  const explorerDiv = document.getElementById('vp-explorer-note');
  if (explorerDiv) explorerDiv.style.display = v.role === VROLE.EXPLORER ? 'block' : 'none';

  // Upgrade section — only for Basic villagers (or training)
  const upgDiv  = document.getElementById('vp-upgrade');
  const upgBtns = document.getElementById('vp-upgrade-btns');
  if ((v.role === VROLE.BASIC || v.state === 'training') && v.role !== VROLE.EXPLORER) {
    upgDiv.style.display = 'block';
    upgBtns.innerHTML = '';
    if (v.state === 'training') {
      const pct = Math.round((1 - v._trainingTimer / TRAIN_TIME) * 100);
      document.getElementById('vp-upgrade-cost').textContent =
        `Training ${v._trainingRole}… ${pct}% (${Math.ceil(v._trainingTimer)}s left)`;
    } else {
      const trainRoles = [VROLE.WOODCUTTER,VROLE.BUILDER,VROLE.FARMER,VROLE.BAKER,VROLE.STONE_MINER,VROLE.TOOLSMITH,VROLE.KNIGHT,VROLE.ARCHER,VROLE.MECHANIC];
      for (const r of trainRoles) {
        if (!hasPrereq(r)) continue; // hide roles whose building hasn't been built yet
        const btn = document.createElement('button');
        btn.className = 'upgrade-btn';
        btn.textContent = r;
        btn.disabled = gold < 20;
        btn.addEventListener('click', ()=>upgradeBasicTo(selectedVillager, r));
        upgBtns.appendChild(btn);
      }
      const timeLeft = v.upgradeTimer !== null ? Math.ceil(v.upgradeTimer)+'s' : '—';
      document.getElementById('vp-upgrade-cost').textContent = `Cost: ⚜ 20 gold  ·  Auto in: ${timeLeft}`;
    }
  } else {
    upgDiv.style.display = 'none';
  }

  // Possess button for knights
  const possessDiv = document.getElementById('vp-possess');
  if (possessDiv) {
    if (v.role === VROLE.KNIGHT) {
      possessDiv.style.display = 'block';
      const btn = possessDiv.querySelector('button');
      if (possessedVillager === v) {
        btn.textContent = '⬛ Release';
        btn.onclick = releasePossession;
      } else {
        btn.textContent = '⚔ Possess';
        btn.onclick = () => possessKnight(v);
      }
    } else {
      possessDiv.style.display = 'none';
    }
  }
}

// ═══════════════════════════════════════════════════
//  FOG OF WAR
// ═══════════════════════════════════════════════════
function updateFog() {
  fogVisible.fill(0);
  for (const v of villagers) {
    const vx = Math.round(v.x), vy = Math.round(v.y);
    const vr = v.role === VROLE.EXPLORER ? EXPLORER_FOG_RADIUS : FOG_RADIUS;
    for (let dy = -vr; dy <= vr; dy++) {
      const ty = vy + dy;
      if (ty < 0 || ty >= MAP_H) continue;
      const maxDx = Math.floor(Math.sqrt(vr*vr - dy*dy));
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        const tx = vx + dx;
        if (tx < 0 || tx >= MAP_W) continue;
        const idx = ty * MAP_W + tx;
        fogVisible[idx]  = 1;
        fogExplored[idx] = 1;
      }
    }
  }

  // Outpost fog reveal
  for (const b of buildings) {
    if (b.type !== 9 || !b.complete) continue;
    const OR = 8;
    for (let dy=-OR; dy<=OR; dy++) {
      const ty2=b.ty+dy;
      if (ty2<0||ty2>=MAP_H) continue;
      const maxDx=Math.floor(Math.sqrt(OR*OR-dy*dy));
      for (let dx=-maxDx; dx<=maxDx; dx++) {
        const tx2=b.tx+dx;
        if (tx2<0||tx2>=MAP_W) continue;
        const idx=ty2*MAP_W+tx2;
        fogVisible[idx]=1; fogExplored[idx]=1;
      }
    }
  }

  // Node discovery
  for (const node of resourceNodes) {
    if (!node.discovered && fogVisible[node.ty * MAP_W + node.tx]) {
      node.discovered = true;
      node.active = true;
      notify(`Discovered: ${NODE_NAMES[node.type]}!`);
    }
  }
}

function updateDayNight(dt) {
  const prev = dayTime;
  dayTime = (dayTime + dt/DAY_LENGTH) % 1;
  // Crossed midnight → new day
  if (prev > 0.9 && dayTime < 0.1) { day++; notify(`Day ${day}`); }
}

// ═══════════════════════════════════════════════════
//  HUD UPDATE
// ═══════════════════════════════════════════════════
function updateHUD() {
  document.getElementById('res-gold').textContent  = gold;
  document.getElementById('res-wood').textContent  = wood;
  document.getElementById('res-food').textContent  = food;
  document.getElementById('res-crops').textContent = crops;
  document.getElementById('res-stone').textContent = stone;
  document.getElementById('res-iron').textContent  = iron;

  // Population display (house-based cap)
  const popEl = document.getElementById('pop-display');
  if (popEl) {
    const cap = getPopCap();
    popEl.textContent = cap > 0 ? `${villagers.length}/${cap}` : `${villagers.length}/—`;
    popEl.style.color = (cap > 0 && villagers.length >= cap) ? '#e06060' : '';
  }

  // Day display
  const dayEl = document.getElementById('day-display');
  if (dayEl) dayEl.textContent = `Day ${day}`;

  // Time label
  document.getElementById('time-display').textContent = getTimeLabel();

  // Hunger bar (average)
  const avg = villagers.length ? villagers.reduce((s,v)=>s+v.hunger,0)/villagers.length : 1;
  const fill = document.getElementById('hunger-bar-inner');
  fill.style.width = (avg*100).toFixed(1)+'%';
  const r=cl(240-avg*180), g=cl(avg*200+20);
  fill.style.background = `rgb(${r},${g},20)`;

  // Food-low warning on food chip
  const foodChip = document.getElementById('food-chip');
  if (foodChip) foodChip.classList.toggle('res-low', food < villagers.length * 2);
}

// ═══════════════════════════════════════════════════
//  CAMERA FOLLOW
// ═══════════════════════════════════════════════════
function updateCameraFollow(dt) {
  if (!cameraFollow||!villagers.length) return;
  let cx=0, cy=0;
  for (const v of villagers) { cx+=v.x; cy+=v.y; }
  cx/=villagers.length; cy/=villagers.length;
  const sz=TILE_SZ*zoom;
  // Frame-rate independent exponential lerp — half-life ~125ms
  const alpha=1-Math.pow(0.5, dt*8);
  camX+=(cx*sz-canvas.width/2  - camX)*alpha;
  camY+=(cy*sz-canvas.height/2 - camY)*alpha;
  clamp();
}

// ═══════════════════════════════════════════════════
//  TOWN CENTER
// ═══════════════════════════════════════════════════
function canSettleAt(tx, ty) {
  if (tx<1||tx>=MAP_W-1||ty<1||ty>=MAP_H-1) return false;
  if (!WALKABLE_TILES.has(mapTiles[ty][tx])) return false;
  if (buildings.some(b=>b.tx===tx&&b.ty===ty)) return false;
  let w=0;
  for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) {
    const nx=tx+dx, ny=ty+dy;
    if (nx>=0&&nx<MAP_W&&ny>=0&&ny<MAP_H&&WALKABLE_TILES.has(mapTiles[ny][nx])) w++;
  }
  return w>=15;
}

function placeTownCenter(tx, ty) {
  townCenter={tx,ty,hp:TC_HP_MAX,maxHp:TC_HP_MAX};
  settled=true; placingTownCenter=false;
  setTimeout(() => initEnemyKingdom(), 0);
  document.getElementById('settle-btn').classList.add('hidden');
  document.getElementById('build-toggle-btn').classList.remove('hidden');
  const hint=document.getElementById('hint');
  hint.classList.remove('hidden');
  hint.innerHTML='<b>B</b> Build &nbsp;·&nbsp; <b>Click</b> Select/Move &nbsp;·&nbsp; <b>Scroll</b> Zoom &nbsp;·&nbsp; <b>F</b> Follow &nbsp;·&nbsp; <b>R</b> New World';
  setTimeout(()=>hint.classList.add('hidden'),5000);
  cameraFollow=true;
}

// ═══════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════
const keys={};
let msx=canvas.width/2, msy=canvas.height/2;

addEventListener('keydown', e=>{
  keys[e.key.toLowerCase()]=true;
  if (e.key==='g'||e.key==='G') showGrid=!showGrid;
  if (e.key==='r'||e.key==='R') { SEED=Math.floor(Math.random()*1e6); init(); }
  if (e.key==='f'||e.key==='F') { cameraFollow=!cameraFollow; }
  if (e.key==='b'||e.key==='B') { if (settled) toggleBuildPanel(); }
  if (e.key==='Escape') {
    if (possessedVillager) {
      releasePossession();
    } else if (buildMode||placingType!==null) {
      buildMode=false; placingType=null;
      document.getElementById('build-panel').classList.remove('visible');
      document.querySelectorAll('.build-btn').forEach(b=>b.classList.remove('active'));
    } else {
      for (const v of villagers) v.selected=false;
      selectedVillager=null;
      updateVillagerPanel();
    }
  }
  if ([' '].includes(e.key)) e.preventDefault();
});
addEventListener('keyup', e=>{ keys[e.key.toLowerCase()]=false; });

canvas.addEventListener('mousedown', e=>{
  // Possessed knight: left-click attacks nearest enemy, right-click also attacks
  if (possessedVillager && (e.button===0 || e.button===2)) {
    const sz=TILE_SZ*zoom;
    const wx=(e.clientX+camX)/sz, wy=(e.clientY+camY)/sz;
    const target=findCombatTarget(wx,wy);
    if (target) { directKnightAttack(possessedVillager, target); e.preventDefault(); return; }
  }
  // Right-click: combat attack if knight selected (non-possessed)
  if (e.button===2 && selectedVillager?.role===VROLE.KNIGHT && !possessedVillager) {
    const sz=TILE_SZ*zoom;
    const wx=(e.clientX+camX)/sz, wy=(e.clientY+camY)/sz;
    const target=findCombatTarget(wx,wy);
    if (target) { directKnightAttack(selectedVillager,target); e.preventDefault(); return; }
  }
  // Only prevent default for right-clicks (context menu suppression).
  // Left-click must NOT be prevented here — doing so swallows the mouseup
  // event that the selection/movement handler depends on.
  if (e.button !== 0) e.preventDefault();
});

let _roadPainting = false;
canvas.addEventListener('mousedown', e=>{ if (e.button===0 && placingType===8) _roadPainting=true; });
canvas.addEventListener('mouseup',   e=>{ _roadPainting=false; });

addEventListener('mousemove', e=>{
  msx=e.clientX; msy=e.clientY;
  // Paint roads while dragging
  if (_roadPainting && placingType===8) {
    const sz=TILE_SZ*zoom;
    const tx=Math.floor((e.clientX+camX)/sz);
    const ty=Math.floor((e.clientY+camY)/sz);
    placeBuilding(tx, ty, 8);
  }
});

canvas.addEventListener('contextmenu', e=>e.preventDefault());

canvas.addEventListener('wheel', e=>{
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const wxBefore = (e.clientX + camX) / (TILE_SZ * zoom);
  const wyBefore = (e.clientY + camY) / (TILE_SZ * zoom);
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
  camX = wxBefore * TILE_SZ * zoom - e.clientX;
  camY = wyBefore * TILE_SZ * zoom - e.clientY;
  clamp();
},{passive:false});

// Minimap click → smooth pan camera
mmCanvas.addEventListener('click', e=>{
  const rect=mmCanvas.getBoundingClientRect();
  const mx=(e.clientX-rect.left)/mmCanvas.width;
  const my=(e.clientY-rect.top) /mmCanvas.height;
  const sz=TILE_SZ*zoom;
  camTargetX=Math.max(0,Math.min(MAP_W*sz-canvas.width,  mx*MAP_W*sz - canvas.width/2));
  camTargetY=Math.max(0,Math.min(MAP_H*sz-canvas.height, my*MAP_H*sz - canvas.height/2));
  cameraFollow=false;
});

// Villager selection / movement via left-click
let _lbX=0, _lbY=0;
canvas.addEventListener('mousedown', e=>{
  if (e.button===0) { _lbX=e.clientX; _lbY=e.clientY; }
});
canvas.addEventListener('mouseup', e=>{
  if (e.button!==0) return;
  const moved=Math.hypot(e.clientX-_lbX, e.clientY-_lbY);
  if (moved>5) return; // was a drag — ignore
  handleCanvasClick(e.clientX, e.clientY);
});

function handleCanvasClick(cx, cy) {
  const sz=TILE_SZ*zoom;
  const wx=(cx+camX)/sz, wy=(cy+camY)/sz;
  const tx=Math.floor(wx), ty=Math.floor(wy);

  // Town center placement mode
  if (placingTownCenter) {
    if (canSettleAt(tx,ty)) placeTownCenter(tx,ty);
    return;
  }

  // Build placement mode
  if (placingType!==null) {
    placeBuilding(tx,ty,placingType);
    return; // stay in placement mode
  }

  // Find nearest villager within 0.6 tiles
  let best=null, bestDist=0.6;
  for (const v of villagers) {
    const d=Math.hypot(v.x-wx, v.y-wy);
    if (d<bestDist) { bestDist=d; best=v; }
  }

  if (best) {
    const wasSelected=best.selected;
    for (const v of villagers) v.selected=false;
    selectedVillager=wasSelected?null:best;
    if (selectedVillager) selectedVillager.selected=true;
    cameraFollow=false;
    updateVillagerPanel();
    return;
  }

  if (selectedVillager) {
    moveVillagerTo(selectedVillager,tx,ty);
    cameraFollow=false;
    return;
  }

  cameraFollow=true;
}

// ── Touch support ──────────────────────────────────────
let _touch1 = null, _touch2 = null;
let _touchMoved = false;
let _longPressTimer = null;
const LONG_PRESS_MS   = 450;
const TAP_MOVE_THRESH = 8;

function simulateRightClick(sx, sy) {
  const sz = TILE_SZ * zoom;
  const wx = (sx + camX) / sz, wy = (sy + camY) / sz;
  if (possessedVillager) {
    const target = findCombatTarget(wx, wy);
    if (target) directKnightAttack(possessedVillager, target);
  } else if (selectedVillager?.role === VROLE.KNIGHT) {
    const target = findCombatTarget(wx, wy);
    if (target) directKnightAttack(selectedVillager, target);
  }
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    _touch1 = { x: t.clientX, y: t.clientY };
    _touch2 = null;
    _touchMoved = false;
    _longPressTimer = setTimeout(() => {
      if (!_touchMoved) simulateRightClick(_touch1.x, _touch1.y);
      _longPressTimer = null;
    }, LONG_PRESS_MS);
  } else if (e.touches.length === 2) {
    clearTimeout(_longPressTimer); _longPressTimer = null;
    const a = e.touches[0], b = e.touches[1];
    _touch1 = { x: a.clientX, y: a.clientY };
    _touch2 = { x: b.clientX, y: b.clientY };
    _touchMoved = true;
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && _touch1) {
    const t = e.touches[0];
    const dx = t.clientX - _touch1.x;
    const dy = t.clientY - _touch1.y;
    if (Math.hypot(dx, dy) > TAP_MOVE_THRESH) {
      _touchMoved = true;
      clearTimeout(_longPressTimer); _longPressTimer = null;
    }
    if (placingType === 8) {
      // Road drag: paint tiles instead of panning
      const sz = TILE_SZ * zoom;
      const tx = Math.floor((t.clientX + camX) / sz);
      const ty = Math.floor((t.clientY + camY) / sz);
      placeBuilding(tx, ty, 8);
    } else {
      camX -= dx; camY -= dy;
      clamp();
    }
    _touch1.x = t.clientX; _touch1.y = t.clientY;
  } else if (e.touches.length === 2 && _touch1 && _touch2) {
    const a = e.touches[0], b = e.touches[1];
    const prevDist = Math.hypot(_touch2.x - _touch1.x, _touch2.y - _touch1.y);
    const newDist  = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    if (prevDist > 0) {
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const factor = newDist / prevDist;
      const wxBefore = (midX + camX) / (TILE_SZ * zoom);
      const wyBefore = (midY + camY) / (TILE_SZ * zoom);
      zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * factor));
      camX = wxBefore * TILE_SZ * zoom - midX;
      camY = wyBefore * TILE_SZ * zoom - midY;
      clamp();
    }
    _touch1.x = a.clientX; _touch1.y = a.clientY;
    _touch2.x = b.clientX; _touch2.y = b.clientY;
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  clearTimeout(_longPressTimer); _longPressTimer = null;
  if (!_touchMoved && _touch1) handleCanvasClick(_touch1.x, _touch1.y);
  if (e.touches.length === 0) { _touch1 = null; _touch2 = null; }
}, { passive: false });
// D-pad wiring: set keys[] so possessed knight movement works
;(function wireDpad() {
  const map = { 'dp-up':'w', 'dp-down':'s', 'dp-left':'a', 'dp-right':'d' };
  for (const [id, key] of Object.entries(map)) {
    const btn = document.getElementById(id);
    btn.addEventListener('touchstart', e => { e.preventDefault(); keys[key]=true;  }, { passive:false });
    btn.addEventListener('touchend',   e => { e.preventDefault(); keys[key]=false; }, { passive:false });
    btn.addEventListener('touchcancel',e => { keys[key]=false; });
    btn.addEventListener('mousedown',  () => keys[key]=true);
    btn.addEventListener('mouseup',    () => keys[key]=false);
    btn.addEventListener('mouseleave', () => keys[key]=false);
  }
})();
// ── End touch support ───────────────────────────────────

function possessKnight(v) {
  if (possessedVillager) releasePossession();
  possessedVillager = v;
  v.path = []; v.state = 'idle';
  cameraFollow = false;
  document.getElementById('possess-bar').classList.remove('hidden');
  document.getElementById('possess-name').textContent = v.name;
  document.getElementById('dpad').classList.remove('hidden');
  notify(`Possessing ${v.name} — WASD to move, click to attack, ESC to release`);
}

function releasePossession() {
  if (!possessedVillager) return;
  notify(`Released ${possessedVillager.name}`);
  possessedVillager.state = 'idle';
  possessedVillager.idleTimer = 1;
  possessedVillager = null;
  document.getElementById('possess-bar').classList.add('hidden');
  document.getElementById('dpad').classList.add('hidden');
  cameraFollow = true;
}

function clamp() {
  const sz=TILE_SZ*zoom;
  const maxX=Math.max(0, MAP_W*sz-canvas.width);
  const maxY=Math.max(0, MAP_H*sz-canvas.height);
  camX=Math.max(0,Math.min(maxX,camX));
  camY=Math.max(0,Math.min(maxY,camY));
}

// ═══════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════
function update(dt) {
  // zoom is now fixed — no scroll handler changes it

  // ── Smooth minimap pan ──
  if (camTargetX!==null) {
    const alpha=1-Math.pow(0.5,dt*15);
    camX+=(camTargetX-camX)*alpha;
    camY+=(camTargetY-camY)*alpha;
    clamp();
    if (Math.abs(camX-camTargetX)<0.5&&Math.abs(camY-camTargetY)<0.5) {
      camX=camTargetX; camY=camTargetY;
      camTargetX=null; camTargetY=null;
    }
  }

  // ── WASD: move possessed knight OR pan camera ──
  const PAN_ACCEL = 1800;
  const PAN_FRIC  = 10;
  let inputX = 0, inputY = 0;
  if (keys['a']) inputX -= 1;
  if (keys['d']) inputX += 1;
  if (keys['w']) inputY -= 1;
  if (keys['s']) inputY += 1;

  if (possessedVillager && !possessedVillager._despawn) {
    // WASD moves the possessed knight
    const pv = possessedVillager;
    if ((inputX !== 0 || inputY !== 0) && pv.path.length === 0 && pv.state !== 'fighting') {
      const ntx = pv.tx + inputX, nty = pv.ty + inputY;
      if (ntx >= 0 && ntx < MAP_W && nty >= 0 && nty < MAP_H
          && WALKABLE_TILES.has(mapTiles[nty][ntx])
          && !villagerBlocked[nty*MAP_W+ntx]) {
        pv.path = [{x: ntx, y: nty}];
        pv.state = 'moving';
      }
    }
    // Camera tightly follows possessed knight
    const sz = TILE_SZ * zoom;
    const alpha = 1 - Math.pow(0.5, dt * 14);
    camX += (pv.x * sz - canvas.width  / 2 - camX) * alpha;
    camY += (pv.y * sz - canvas.height / 2 - camY) * alpha;
    clamp();
    camVX = 0; camVY = 0;
  } else {
    if (inputX !== 0 || inputY !== 0) {
      const len = Math.sqrt(inputX*inputX + inputY*inputY);
      camVX += (inputX/len) * PAN_ACCEL * dt;
      camVY += (inputY/len) * PAN_ACCEL * dt;
      const spd = Math.sqrt(camVX*camVX + camVY*camVY);
      if (spd > PAN_PX) { camVX = camVX/spd*PAN_PX; camVY = camVY/spd*PAN_PX; }
      cameraFollow = false; camTargetX = null;
    } else {
      const decay = Math.pow(0.001, dt * PAN_FRIC / 10);
      camVX *= decay; camVY *= decay;
      if (Math.abs(camVX) < 0.5 && Math.abs(camVY) < 0.5) { camVX = 0; camVY = 0; }
    }
    if (camVX !== 0 || camVY !== 0) { camX += camVX*dt; camY += camVY*dt; clamp(); }
  }

  updateCameraFollow(dt);
  updateDayNight(dt);
  updateVillagers(dt);
  updateRegrowth(dt);
  updateNPCs(dt);
  updateBandits(dt);
  updateCombat(dt);
  updateSpawning(dt);
  updateGold(dt);
  updateFeeding(dt);
  if (mapTiles.length && (frameCount % 3 === 0)) updateFog();
  updateHUD();
  time+=dt;
}

let lastT=0, frameCount=0;
function loop(ts) {
  const dt=Math.min((ts-lastT)/1000, 0.05); lastT=ts; frameCount++;
  update(dt);
  render();
  drawMinimap();
  requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════
//  INIT / LOADING
// ═══════════════════════════════════════════════════
async function init() {
  const loading=document.getElementById('loading');
  const bar=document.getElementById('loading-bar-fill');
  loading.style.opacity='1';
  loading.style.pointerEvents='all';
  loading.style.display='flex';
  // Build panel (idempotent — only populate buttons once)
  if (!document.querySelector('.build-btn')) {
    const btns = document.getElementById('build-btns');
    STRUCT_NAME.forEach((name,i)=>{
      const cost = STRUCT_COST[i] || {};
      const costStr = Object.entries(cost).map(([r,n])=>`${n}${r[0].toUpperCase()}`).join(' ');
      const btn = document.createElement('button');
      btn.className = 'build-btn'; btn.id = `bbtn-${i}`;
      btn.innerHTML = `<span class="build-btn-icon">${STRUCT_ICON[i]}</span><span class="build-btn-name">${name}</span><span class="build-btn-cost">${costStr}</span>`;
      btn.addEventListener('click', ()=>selectBuildType(i));
      btns.appendChild(btn);
    });
  }
  // Settle button wiring (idempotent)
  if (!document.getElementById('settle-btn')._wired) {
    document.getElementById('settle-btn').addEventListener('click',()=>{
      if (settled) return;
      placingTownCenter=!placingTownCenter;
      const btn=document.getElementById('settle-btn');
      btn.classList.toggle('placing',placingTownCenter);
      btn.textContent=placingTownCenter?'Click to place…':'Settle Here';
    });
    document.getElementById('settle-btn')._wired=true;
  }

  document.getElementById('loading-sub').textContent=`Forging realm #${SEED}…`;
  bar.style.width='0%';

  await new Promise(r => requestAnimationFrame(r));
  bar.style.width='10%';

  await generate(SEED, pct => { bar.style.width = pct.toFixed(0) + '%'; });
  bar.style.width='80%';

  await new Promise(r => requestAnimationFrame(r));
  buildMinimap();
  spawnVillagers();
  cameraFollow=true;
  bar.style.width='100%';

  // Reset settle button UI
  const sb=document.getElementById('settle-btn');
  sb.classList.remove('hidden','placing');
  sb.textContent='Settle Here';
  document.getElementById('build-toggle-btn').classList.add('hidden');
  document.getElementById('dpad').classList.add('hidden');
  // Initial hint
  const hint=document.getElementById('hint');
  hint.innerHTML='Roam freely &nbsp;·&nbsp; Find a good spot &nbsp;·&nbsp; <b>Settle</b> to found your kingdom';
  hint.classList.remove('hidden');

  // Centre camera on the villager group
  {
    const sz=TILE_SZ*zoom;
    let cx=MAP_W/2, cy=MAP_H/2;
    if (villagers.length) {
      cx=0; cy=0;
      for (const v of villagers) { cx+=v.x; cy+=v.y; }
      cx/=villagers.length; cy/=villagers.length;
    }
    camX=cx*sz - canvas.width/2;
    camY=cy*sz - canvas.height/2;
  }
  clamp();

  await new Promise(r => requestAnimationFrame(r));
  loading.style.opacity='0';
  loading.style.pointerEvents='none';
  setTimeout(()=>loading.style.display='none', 700);

  requestAnimationFrame(loop);
}

init();