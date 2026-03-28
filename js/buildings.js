// ── buildings.js ──

// ═══════════════════════════════════════════════════
//  BUILDINGS
// ═══════════════════════════════════════════════════
function mkBuilding(type, tx, ty) {
  const [w, h] = STRUCT_SIZE[type] || [1, 1];
  return { id:_bid++, type, tx, ty, w, h, progress:0, complete:false, assignedBuilders:[] };
}

function canBuildAt(tx, ty, type) {
  const [w, h] = STRUCT_SIZE[type] || [1, 1];
  if (tx<0||tx+w>MAP_W||ty<0||ty+h>MAP_H) return false;
  for (let dy=0; dy<h; dy++) for (let dx=0; dx<w; dx++) {
    if (!STRUCT_VALID[type].has(mapTiles[ty+dy][tx+dx])) return false;
    if (buildings.some(b=>tx+dx>=b.tx&&tx+dx<b.tx+b.w&&ty+dy>=b.ty&&ty+dy<b.ty+b.h)) return false;
  }
  return true;
}

function canAffordBuilding(type) {
  const cost = STRUCT_COST[type];
  if (!cost) return true;
  const res = {wood, stone, iron, food, crops, gold};
  return Object.entries(cost).every(([r,n]) => (res[r]||0) >= n);
}

function placeBuilding(tx, ty, type) {
  if (!canBuildAt(tx,ty,type)) return false;
  if (!canAffordBuilding(type)) { notify('Not enough resources!'); return false; }
  const cost = STRUCT_COST[type] || {};
  if (cost.wood)  wood  -= cost.wood;
  if (cost.stone) stone -= cost.stone;
  if (cost.iron)  iron  -= cost.iron;
  if (cost.gold)  gold  -= cost.gold;
  buildings.push(mkBuilding(type,tx,ty));
  return true;
}

function findBuildTarget(builder) {
  let best=null, bestDist=Infinity;
  for (const b of buildings) {
    if (b.complete) continue;
    if (b.assignedBuilders.length>=STRUCT_MAX_BUILDERS) continue;
    if (b.assignedBuilders.includes(builder.id)) continue;
    const d=Math.abs(b.tx-builder.tx)+Math.abs(b.ty-builder.ty);
    if (d<bestDist) { bestDist=d; best=b; }
  }
  return best;
}

function assignBuilderTo(builder, bld) {
  const path=findPath(Math.floor(builder.x),Math.floor(builder.y),bld.tx,bld.ty);
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

function toggleBuildPanel() {
  if (!settled) return;
  buildMode=!buildMode;
  if (!buildMode) { placingType=null; }
  document.getElementById('build-panel').classList.toggle('visible',buildMode);
  document.querySelectorAll('.build-btn').forEach(b=>b.classList.remove('active'));
}

function selectBuildType(type) {
  placingType=(placingType===type)?null:type;
  document.querySelectorAll('.build-btn').forEach((b,i)=>b.classList.toggle('active',i===placingType));
}
