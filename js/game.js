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

  const labels = { idle:'Resting', roaming:'Wandering', patrolling:'Patrolling', moving:'Moving', building:'Building…', chopping:'Chopping…', sleeping:'Sleeping', farming:'Farming…', baking:'Baking…', mining:'Mining…', forging:'Forging…', guarding:'On Guard' };
  vpStatus.textContent = labels[v.state] || '—';
  const hv = document.getElementById('vp-hunger-val');
  if (hv) hv.textContent = Math.round(v.hunger*100) + '%';

  // Upgrade section — only for Basic villagers
  const upgDiv  = document.getElementById('vp-upgrade');
  const upgBtns = document.getElementById('vp-upgrade-btns');
  if (v.role === VROLE.BASIC) {
    upgDiv.style.display = 'block';
    upgBtns.innerHTML = '';
    const trainRoles = [VROLE.WOODCUTTER,VROLE.BUILDER,VROLE.FARMER,VROLE.BAKER,VROLE.STONE_MINER,VROLE.TOOLSMITH,VROLE.KNIGHT,VROLE.ARCHER];
    for (const r of trainRoles) {
      const btn = document.createElement('button');
      btn.className = 'upgrade-btn';
      btn.textContent = r;
      btn.disabled = gold < 20;
      btn.addEventListener('click', ()=>upgradeBasicTo(selectedVillager, r));
      upgBtns.appendChild(btn);
    }
    const timeLeft = v.upgradeTimer !== null ? Math.ceil(v.upgradeTimer)+'s' : '—';
    document.getElementById('vp-upgrade-cost').textContent = `Cost: ⚜ 20 gold  ·  Auto in: ${timeLeft}`;
  } else {
    upgDiv.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════
//  FOG OF WAR
// ═══════════════════════════════════════════════════
function updateFog() {
  fogVisible.fill(0);
  for (const v of villagers) {
    const vx = Math.round(v.x), vy = Math.round(v.y);
    for (let dy = -FOG_RADIUS; dy <= FOG_RADIUS; dy++) {
      const ty = vy + dy;
      if (ty < 0 || ty >= MAP_H) continue;
      const maxDx = Math.floor(Math.sqrt(FOG_RADIUS*FOG_RADIUS - dy*dy));
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        const tx = vx + dx;
        if (tx < 0 || tx >= MAP_W) continue;
        const idx = ty * MAP_W + tx;
        fogVisible[idx]  = 1;
        fogExplored[idx] = 1;
      }
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

  // Population display
  const popEl = document.getElementById('pop-display');
  if (popEl) popEl.textContent = `${villagers.length}/${MAX_VILLAGERS}`;

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
  if (!cameraFollow||!villagers.length||dragging) return;
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
  initEnemyKingdom();
  document.getElementById('settle-btn').classList.add('hidden');
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
let dragging=false, dragX=0,dragY=0,dragCX=0,dragCY=0;
let lastDragX=0, lastDragY=0, lastDragT=0;
let msx=canvas.width/2, msy=canvas.height/2;

addEventListener('keydown', e=>{
  keys[e.key.toLowerCase()]=true;
  if (e.key==='g'||e.key==='G') showGrid=!showGrid;
  if (e.key==='r'||e.key==='R') { SEED=Math.floor(Math.random()*1e6); init(); }
  if (e.key==='f'||e.key==='F') { cameraFollow=!cameraFollow; }
  if (e.key==='b'||e.key==='B') { if (settled) toggleBuildPanel(); }
  if (e.key==='Escape') {
    if (buildMode||placingType!==null) {
      buildMode=false; placingType=null;
      document.getElementById('build-panel').classList.remove('visible');
      document.querySelectorAll('.build-btn').forEach(b=>b.classList.remove('active'));
    } else {
      for (const v of villagers) v.selected=false;
      selectedVillager=null;
      updateVillagerPanel();
    }
  }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
});
addEventListener('keyup', e=>{ keys[e.key.toLowerCase()]=false; });

canvas.addEventListener('mousedown', e=>{
  if (e.button===1||e.button===2) {
    // Check for combat attack (right-click on knight-selected + enemy target)
    if (e.button===2 && selectedVillager?.role===VROLE.KNIGHT) {
      const sz=TILE_SZ*zoom;
      const wx=(e.clientX+camX)/sz, wy=(e.clientY+camY)/sz;
      const target=findCombatTarget(wx,wy);
      if (target) { directKnightAttack(selectedVillager,target); e.preventDefault(); return; }
    }
    dragging=true;
    dragX=e.clientX; dragY=e.clientY;
    dragCX=camX;     dragCY=camY;
    lastDragX=e.clientX; lastDragY=e.clientY; lastDragT=performance.now();
    camVX=0; camVY=0;
    canvas.classList.add('panning');
    e.preventDefault();
  }
});
addEventListener('mouseup', ()=>{
  dragging=false;
  canvas.classList.remove('panning');
  // Clamp inertia velocity so flicks don't go crazy
  const MAX_V=2200;
  camVX=Math.max(-MAX_V,Math.min(MAX_V,camVX));
  camVY=Math.max(-MAX_V,Math.min(MAX_V,camVY));
});

addEventListener('mousemove', e=>{
  msx=e.clientX; msy=e.clientY;
  if (dragging) {
    const now=performance.now();
    const elapsed=now-lastDragT;
    if (elapsed>0&&elapsed<80) {
      camVX=-(e.clientX-lastDragX)/elapsed*1000;
      camVY=-(e.clientY-lastDragY)/elapsed*1000;
    }
    lastDragX=e.clientX; lastDragY=e.clientY; lastDragT=now;
    camX=dragCX-(e.clientX-dragX);
    camY=dragCY-(e.clientY-dragY);
    clamp();
  }
  // (tile/terrain info removed from HUD)
});

canvas.addEventListener('contextmenu', e=>e.preventDefault());

canvas.addEventListener('wheel', e=>{
  e.preventDefault();
  const factor=e.deltaY>0?0.87:1.14;
  const nz=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,zoomTarget*factor));
  // Save world-tile position under cursor as anchor — smooth zoom will keep it stationary
  zoomAnchorWX=(e.clientX+camX)/(TILE_SZ*zoom);
  zoomAnchorWY=(e.clientY+camY)/(TILE_SZ*zoom);
  zoomAnchorSX=e.clientX;
  zoomAnchorSY=e.clientY;
  zoomTarget=nz;
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
  camVX=0; camVY=0;
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
  // ── Smooth zoom (lerp toward zoomTarget, keep anchor stationary) ──
  if (Math.abs(zoom-zoomTarget)>0.0005) {
    zoom+=(zoomTarget-zoom)*(1-Math.pow(0.5,dt*12));
    if (!dragging) {
      camX=zoomAnchorWX*TILE_SZ*zoom-zoomAnchorSX;
      camY=zoomAnchorWY*TILE_SZ*zoom-zoomAnchorSY;
      clamp();
    }
  } else {
    zoom=zoomTarget;
  }

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

  let moved=false;
  if(keys['a']||keys['arrowleft'])  {camX-=PAN_PX*dt;moved=true;}
  if(keys['d']||keys['arrowright']) {camX+=PAN_PX*dt;moved=true;}
  if(keys['w']||keys['arrowup'])    {camY-=PAN_PX*dt;moved=true;}
  if(keys['s']||keys['arrowdown'])  {camY+=PAN_PX*dt;moved=true;}

  // Edge scroll (skip if over minimap area to avoid conflicts)
  const overMM = msx > canvas.width-220 && msy > canvas.height-220;
  if (!overMM) {
    if(msx < EDGE_PX)               {camX-=PAN_PX*0.6*dt;moved=true;}
    if(msx > canvas.width-EDGE_PX)  {camX+=PAN_PX*0.6*dt;moved=true;}
    if(msy < EDGE_PX)               {camY-=PAN_PX*0.6*dt;moved=true;}
    if(msy > canvas.height-EDGE_PX) {camY+=PAN_PX*0.6*dt;moved=true;}
  }

  if (moved) { cameraFollow=false; camVX=0; camVY=0; camTargetX=null; clamp(); }

  // ── Drag inertia (coasts after releasing middle/right drag) ──
  if (!dragging && !cameraFollow && (Math.abs(camVX)>1||Math.abs(camVY)>1)) {
    camX+=camVX*dt;
    camY+=camVY*dt;
    const decay=Math.pow(0.008,dt); // ~0.35s to fade
    camVX*=decay; camVY*=decay;
    clamp();
  }

  updateCameraFollow(dt);
  updateDayNight(dt);
  updateVillagers(dt);
  updateNPCs(dt);
  updateCombat(dt);
  updateSpawning(dt);
  updateGold(dt);
  updateFeeding(dt);
  if (mapTiles.length) updateFog();
  updateHUD();
  time+=dt;
}

let lastT=0;
function loop(ts) {
  const dt=Math.min((ts-lastT)/1000, 0.05); lastT=ts;
  update(dt);
  render();
  drawMinimap();
  requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════════════
//  INIT / LOADING
// ═══════════════════════════════════════════════════
function init() {
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

  setTimeout(()=>{ bar.style.width='20%';
  setTimeout(()=>{
    generate(SEED);
    bar.style.width='72%';
    setTimeout(()=>{
      buildMinimap();
      spawnVillagers();
      cameraFollow=true;
      bar.style.width='100%';

      // Reset settle button UI
      const sb=document.getElementById('settle-btn');
      sb.classList.remove('hidden','placing');
      sb.textContent='Settle Here';
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

      // Hint stays visible until settled; post-settle hint auto-fades (handled in placeTownCenter)

      setTimeout(()=>{
        loading.style.opacity='0';
        loading.style.pointerEvents='none';
        setTimeout(()=>loading.style.display='none', 700);
      }, 350);
    },60);
  },80);},120);
}

init();
requestAnimationFrame(loop);
