// ── renderer.js ──

// ═══════════════════════════════════════════════════
//  CANVAS / CONTEXT
// ═══════════════════════════════════════════════════
const canvas   = document.getElementById('gameCanvas');
const ctx      = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx    = mmCanvas.getContext('2d');

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
resize();
addEventListener('resize', resize);

// ═══════════════════════════════════════════════════
//  TILE COLORS (animated)
// ═══════════════════════════════════════════════════
function cl(v) { return Math.round(Math.max(0,Math.min(255,v))); }
function tint(r,g,b,s,n) {
  const nv=n*38;
  return `rgb(${cl(r*s+nv)},${cl(g*s+nv*0.82)},${cl(b*s+nv*0.65)})`;
}

function tileBaseColor(tx, ty, t, v, time) {
  const h = mapHeight[ty]?.[tx] ?? 0.5;
  const s = 0.78 + h*0.44;   // height-based shade: 0.78..1.22

  switch(t) {
    case T.DEEP: {
      const w=Math.sin(time*0.5+tx*0.28+ty*0.35)*9;
      return `rgb(${cl(16+w)},${cl(42+w)},${cl(92+w)})`;
    }
    case T.WATER: {
      const w=Math.sin(time*0.8+tx*0.4-ty*0.3)*11;
      return `rgb(${cl(34+w)},${cl(112+w)},${cl(184+w)})`;
    }
    case T.SAND:     return tint(228,194,108,s, v*0.07-0.035);
    case T.GRASS:    return tint( 70,158, 38,s, v*0.15-0.075);
    case T.FOREST:   return tint( 22, 80, 14,s, v*0.12-0.060);
    case T.HILL:     return tint(176,142, 86,s, v*0.09-0.045);
    case T.MOUNTAIN: return tint(112,110,124,s, v*0.07-0.035);
    case T.PEAK:     return tint(222,228,242,s, v*0.04-0.020);
    case T.RIVER: {
      const w=Math.sin(time*1.2+tx*0.55+ty*0.6)*13;
      return `rgb(${cl(40+w)},${cl(140+w)},${cl(202+w)})`;
    }
  }
  return '#f0f';
}

// ═══════════════════════════════════════════════════
//  PIXEL ART SPRITES
// ═══════════════════════════════════════════════════

// Draw an N×N pixel-art sprite at screen position (sx,sy) fitting a `size`×`size` square.
// rows: array of equal-length strings; pal: char→color (null/undefined = skip/transparent).
function drawSprite(rows, pal, sx, sy, size) {
  const n = rows[0].length;
  const ps = size / n;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < n; c++) {
      const col = pal[rows[r][c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(
        Math.floor(sx + c * ps),
        Math.floor(sy + r * ps),
        Math.ceil(ps),
        Math.ceil(ps)
      );
    }
  }
}

// ═══════════════════════════════════════════════════
//  TILE DETAIL DRAWING
// ═══════════════════════════════════════════════════
function drawDetails(tx, ty, t, sx, sy, sz, v, time) {
  if (sz < 8) return;

  // ── Mountain: pixel-art rocky peak ───────────────
  // (Forest trees are drawn as Y-sorted objects in drawObjects)
  if (t === T.MOUNTAIN) {
    drawSprite(STAMP.mtn, STAMP_PAL.mtn, sx, sy, sz);
  }

  // ── Hill: pixel-art rounded bump ─────────────────
  else if (t === T.HILL) {
    drawSprite(STAMP.hill, STAMP_PAL.hill, sx, sy, sz);
  }

  // ── Snowy peak ────────────────────────────────────
  else if (t === T.PEAK) {
    drawSprite(STAMP.peak, STAMP_PAL.peak, sx, sy, sz);
  }

  // ── Water / Deep: pixel-art ripple bars ──────────
  else if ((t === T.WATER || t === T.DEEP) && sz >= 12) {
    const ps  = Math.max(1, Math.ceil(sz * 0.06));
    const a   = t === T.DEEP ? 0.07 : 0.11;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    for (let w = 0; w < 2; w++) {
      const p  = (time * (0.07 + w * 0.03) + tx * 0.17 + ty * 0.13 + w * 0.28) % 0.55;
      const ry = sy + Math.floor(sz * (0.15 + p));
      if (ry < sy || ry > sy + sz - ps) continue;
      ctx.fillRect(sx + Math.floor(sz * 0.18), ry, Math.floor(sz * 0.64), ps);
    }
  }

  // ── River: scrolling pixel bars ──────────────────
  else if (t === T.RIVER && sz >= 10) {
    const ps = Math.max(1, Math.ceil(sz * 0.06));
    for (let i = 0; i < 2; i++) {
      const p  = (time * 0.22 + tx * 0.28 + ty * 0.36 + i * 0.5) % 1;
      const ry = sy + Math.floor(sz * p);
      if (ry < sy || ry >= sy + sz) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.18 - i * 0.06})`;
      ctx.fillRect(sx + Math.floor(sz * 0.16), ry, Math.floor(sz * 0.68), ps);
    }
  }

  // ── Sand: pixel ripple marks ──────────────────────
  else if (t === T.SAND && sz >= 16) {
    const ps = Math.max(1, Math.ceil(sz * 0.055));
    ctx.fillStyle = 'rgba(165,126,52,0.22)';
    for (let i = 0; i < 3; i++) {
      const ry  = sy + Math.floor(sz * (0.22 + i * 0.26));
      const barX = sx + Math.floor(sz * (0.10 + ihash(tx + i, ty, 43) * 0.18));
      const barW = Math.floor(sz * (0.28 + ihash(tx, ty + i, 42) * 0.22));
      ctx.fillRect(barX, ry, barW, ps);
    }
  }

  // ── Grass: small pixel tufts ──────────────────────
  else if (t === T.GRASS && sz >= 20) {
    const ps = Math.max(1, Math.ceil(sz * 0.055));
    ctx.fillStyle = 'rgba(92,170,46,0.28)';
    for (const [px, py] of [[0.22,0.72],[0.52,0.68],[0.36,0.82],[0.70,0.75],[0.15,0.62]]) {
      const gx = sx + Math.floor(px * sz);
      const gy = sy + Math.floor(py * sz);
      ctx.fillRect(gx, gy - ps * 2, ps, ps * 2);   // vertical blade
      ctx.fillRect(gx + ps, gy - ps, ps, ps);       // lean right
    }
  }
}

// ═══════════════════════════════════════════════════
//  Y-SORTED OBJECT DRAWING
// ═══════════════════════════════════════════════════

function drawTreeObj(tree, sz) {
  const treeSz = tree.scale * sz;
  if (treeSz < 3) return;
  const bx = tree.tx * sz + tree.ox * sz - camX;
  const by = tree.ty * sz + tree.oy * sz - camY;
  const wobble = _choppingIds.has(tree.id) ? Math.sin(time * 24) * treeSz * 0.09 : 0;
  const cx = bx + treeSz * 0.5 + wobble;

  // Ground shadow ellipse under trunk
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, by + treeSz * 0.84, treeSz * 0.22, treeSz * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();

  drawSprite(STAMP.tree, STAMP_PAL.tree, Math.floor(bx + wobble), Math.floor(by), treeSz);
}

function drawBuildingObj(b, sz) {
  const sx = Math.floor(b.tx * sz - camX);
  const sy = Math.floor(b.ty * sz - camY);
  const bsz = sz * b.w;   // sprite rendered at building width (square sprite scales uniformly)
  if (!b.complete) {
    ctx.globalAlpha = 0.25 + b.progress * 0.75;
    drawSprite(BSTAMP[b.type], BSTAMP_PAL[b.type], sx, sy, bsz);
    ctx.globalAlpha = 1.0;
    const dot = Math.max(1, Math.floor(bsz / 10));
    ctx.fillStyle = 'rgba(180,140,60,0.45)';
    for (let dy2 = 0; dy2 < bsz; dy2 += dot * 4)
      for (let dx2 = 0; dx2 < bsz; dx2 += dot * 4)
        ctx.fillRect(Math.floor(sx + dx2), Math.floor(sy + dy2), dot, dot);
    const ph = Math.max(3, Math.floor(bsz * 0.05));
    const pw = Math.floor(bsz * 0.82);
    const px2 = Math.floor(sx + (bsz - pw) / 2);
    const py2 = Math.floor(sy - ph - Math.max(2, bsz * 0.03));
    ctx.fillStyle = 'rgba(0,0,0,0.60)';
    ctx.fillRect(px2, py2, pw, ph);
    ctx.fillStyle = `rgb(${cl(60+180*b.progress)},${cl(200-100*b.progress)},40)`;
    ctx.fillRect(px2, py2, Math.floor(pw * b.progress), ph);
  } else {
    drawSprite(BSTAMP[b.type], BSTAMP_PAL[b.type], sx, sy, bsz);
  }
}

function drawTCSprite(tc, sz) {
  const sx = Math.floor(tc.tx * sz - camX);
  const sy = Math.floor(tc.ty * sz - camY);
  drawSprite(TC_STAMP, TC_PAL, sx, sy, sz);
  if (sz >= 22) {
    const ly = sy - Math.max(4, sz * 0.14);
    ctx.font = `bold ${Math.max(8, Math.floor(sz * 0.13))}px 'Cinzel',serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText('Town Center', sx + sz / 2, ly);
    ctx.fillStyle = '#c8922a';
    ctx.fillText('Town Center', sx + sz / 2, ly);
  }
}

function drawObjects() {
  const sz = TILE_SZ * zoom;

  // ── TC background effects (glow + territory ring) drawn before sort ──
  if (townCenter) {
    const sx = Math.floor(townCenter.tx * sz - camX);
    const sy = Math.floor(townCenter.ty * sz - camY);
    const grad = ctx.createRadialGradient(sx+sz/2, sy+sz/2, 0, sx+sz/2, sy+sz/2, sz*2.2);
    grad.addColorStop(0, 'rgba(200,146,42,0.22)');
    grad.addColorStop(1, 'rgba(200,146,42,0)');
    ctx.fillStyle = grad; ctx.fillRect(sx-sz, sy-sz, sz*3, sz*3);
    const rcx = townCenter.tx*sz+sz/2-camX, rcy = townCenter.ty*sz+sz/2-camY;
    ctx.strokeStyle = 'rgba(200,146,42,0.15)';
    ctx.lineWidth = Math.max(1, sz*0.12);
    ctx.setLineDash([Math.floor(sz*0.35), Math.floor(sz*0.18)]);
    ctx.beginPath(); ctx.arc(rcx, rcy, getTerritoryRadius()*sz, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Destination marker (below objects) ──
  if (selectedVillager && selectedVillager.path.length > 0) {
    const last = selectedVillager.path[selectedVillager.path.length - 1];
    const mx = (last.x+0.5)*sz-camX, my = (last.y+0.5)*sz-camY;
    const pr = Math.max(5, Math.floor(sz*0.18));
    const lw = Math.max(1, Math.round(pr*0.22));
    ctx.fillStyle = 'rgba(255,215,40,0.92)';
    ctx.fillRect(Math.floor(mx-pr), Math.floor(my-lw*0.5), pr*2, lw);
    ctx.fillRect(Math.floor(mx-lw*0.5), Math.floor(my-pr), lw, pr*2);
    ctx.fillStyle = 'rgba(255,215,40,0.50)';
    for (const [ox,oy] of [[-1,-1],[1,-1],[-1,1],[1,1]])
      ctx.fillRect(Math.floor(mx+ox*pr*0.62), Math.floor(my+oy*pr*0.62), lw, lw);
  }

  // ── Collect visible objects ──
  const c0 = Math.max(0, Math.floor(camX/sz) - 1);
  const r0 = Math.max(0, Math.floor(camY/sz) - 2);
  const c1 = Math.min(MAP_W-1, Math.ceil((camX+canvas.width)/sz) + 1);
  const r1 = Math.min(MAP_H-1, Math.ceil((camY+canvas.height)/sz) + 2);

  // Update chopping-tree set for wobble
  _choppingIds = new Set(
    villagers.filter(v=>v.state==='chopping'&&v.chopTarget).map(v=>v.chopTarget.id)
  );

  const objs = [];

  for (const tree of trees) {
    if (tree.tx < c0 || tree.tx > c1 || tree.ty < r0 || tree.ty > r1) continue;
    objs.push({k:0, sortY: tree.ty + tree.oy + tree.scale*0.85, d: tree});
  }
  for (const b of buildings) {
    if (b.tx < c0 || b.tx > c1 || b.ty < r0 || b.ty > r1) continue;
    objs.push({k:1, sortY: b.ty + b.h, d: b});
  }
  if (townCenter && townCenter.tx>=c0 && townCenter.tx<=c1 && townCenter.ty>=r0 && townCenter.ty<=r1) {
    objs.push({k:2, sortY: townCenter.ty + 1.0, d: townCenter});
  }
  for (const v of villagers) {
    if (v.x < c0-1 || v.x > c1+1 || v.y < r0-1 || v.y > r1+1) continue;
    objs.push({k:3, sortY: v.y, d: v});
  }

  // ── Sort by Y ascending (objects higher on screen drawn first / behind) ──
  objs.sort((a,b) => a.sortY - b.sortY);

  // ── Draw in order ──
  for (const {k, d} of objs) {
    if      (k===0) drawTreeObj(d, sz);
    else if (k===1) drawBuildingObj(d, sz);
    else if (k===2) drawTCSprite(d, sz);
    else            drawVillagerChar(d, d.x*sz-camX, d.y*sz-camY, sz);
  }
}

// ═══════════════════════════════════════════════════
//  VILLAGER RENDERING
// ═══════════════════════════════════════════════════
function drawVillagerChar(v, px, py, sz) {
  const moving = v.path.length > 0;
  const frame  = (moving && Math.floor(time * 5 + v.id * 0.61) % 2 === 1) ? 1 : 0;

  // 3/4 view: sprite is taller than a tile; feet anchor at the character's world pos
  const sprSz = Math.max(6, sz * 1.15);
  const sprX  = px - sprSz * 0.5;
  const sprY  = py - sprSz * 0.88; // head rises above world pos; feet near py+sprSz*0.12

  if (sprSz < 8) {
    const [cr,cg,cb] = ROLE_COLOR[v.role];
    ctx.fillStyle = v.selected ? 'rgba(255,215,0,1)' : `rgb(${cr},${cg},${cb})`;
    ctx.fillRect(Math.floor(sprX), Math.floor(sprY), Math.ceil(sprSz), Math.ceil(sprSz));
    return;
  }

  // Ground shadow under feet
  const shW = Math.ceil(sprSz * 0.55);
  const shH = Math.ceil(sprSz * 0.10);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(
    Math.floor(px - shW * 0.5),
    Math.floor(py + sprSz * 0.10),
    shW, shH
  );

  // Selection: bright pixel border
  if (v.selected) {
    const pad = Math.max(2, Math.floor(sz * 0.07));
    const bw  = Math.max(1, Math.floor(pad * 0.55));
    const x0  = Math.floor(sprX - pad), y0 = Math.floor(sprY - pad);
    const ww  = Math.ceil(sprSz + pad * 2);
    ctx.fillStyle = 'rgba(255,215,0,0.92)';
    ctx.fillRect(x0, y0, ww, bw);
    ctx.fillRect(x0, y0 + ww - bw, ww, bw);
    ctx.fillRect(x0, y0, bw, ww);
    ctx.fillRect(x0 + ww - bw, y0, bw, ww);
  }

  // Pixel-art sprite
  const sprites = VSPRITE[v.role] || VSPRITE.Basic;
  const pal     = VPAL[v.role]    || VPAL.Basic;
  drawSprite(sprites[frame], pal, sprX, sprY, sprSz);

  // Name label (high zoom only)
  if (sz >= 42) {
    const ny = Math.floor(sprY + sprSz + 3);
    ctx.font = `bold ${Math.max(9, sz * 0.135)}px 'Cinzel',serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.80)';
    ctx.strokeText(v.name, px, ny);
    ctx.fillStyle = 'rgba(255,238,188,0.96)';
    ctx.fillText(v.name, px, ny);
  }
}

// ═══════════════════════════════════════════════════
//  DAY / NIGHT
// ═══════════════════════════════════════════════════
function getNightAlpha() {
  // 0 at noon (t=0.5), 1 at midnight (t=0 or 1)
  const dist=Math.abs(dayTime-0.5); // 0=noon, 0.5=midnight
  return Math.pow(Math.max(0,(dist-0.25)/0.25),2);
}
function isNight()    { return getNightAlpha()>0.5; }
function isDaylight() { return getNightAlpha()<0.05; }
function getTimeLabel() {
  const t=dayTime;
  if (t<0.10||t>0.90) return 'Midnight';
  if (t<0.24) return 'Dawn';
  if (t<0.45) return 'Morning';
  if (t<0.56) return 'Noon';
  if (t<0.76) return 'Afternoon';
  if (t<0.88) return 'Dusk';
  return 'Night';
}

// ═══════════════════════════════════════════════════
//  NIGHT OVERLAY
// ═══════════════════════════════════════════════════
function drawNightOverlay() {
  const a=getNightAlpha();
  if (a<0.01) return;
  ctx.fillStyle=`rgba(4,6,24,${a*0.80})`;
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // Stars
  if (a>0.3) {
    const sa=Math.min(1,(a-0.3)/0.4);
    for (let i=0;i<80;i++) {
      const sx=Math.floor(ihash(i,0,7)*canvas.width);
      const sy=Math.floor(ihash(i,1,8)*canvas.height*0.5);
      const bright=0.35+ihash(i,3,10)*0.55;
      ctx.fillStyle=`rgba(255,255,240,${sa*bright})`;
      const ss=ihash(i,2,9)<0.12?2:1;
      ctx.fillRect(sx,sy,ss,ss);
    }
  }
}

// ═══════════════════════════════════════════════════
//  MINIMAP
// ═══════════════════════════════════════════════════
function buildMinimap() {
  const mw=mmCanvas.width, mh=mmCanvas.height;
  const off=document.createElement('canvas');
  off.width=mw; off.height=mh;
  const oc=off.getContext('2d');
  const img=oc.createImageData(mw,mh);
  const d=img.data;

  for (let py=0; py<mh; py++) {
    for (let px=0; px<mw; px++) {
      const tx=Math.floor(px/mw*MAP_W);
      const ty=Math.floor(py/mh*MAP_H);
      const [r,g,b]=TILE_RGB[mapTiles[ty][tx]];
      const i=(py*mw+px)*4;
      d[i]=r; d[i+1]=g; d[i+2]=b; d[i+3]=255;
    }
  }

  oc.putImageData(img,0,0);
  mmCache=off;
}

function drawMinimap() {
  const mw=mmCanvas.width, mh=mmCanvas.height;
  mmCtx.clearRect(0,0,mw,mh);
  if (mmCache) mmCtx.drawImage(mmCache,0,0);

  const sz=TILE_SZ*zoom;
  const vx=camX/sz/MAP_W*mw;
  const vy=camY/sz/MAP_H*mh;
  const vw=canvas.width /sz/MAP_W*mw;
  const vh=canvas.height/sz/MAP_H*mh;

  mmCtx.strokeStyle='rgba(255,210,70,0.9)';
  mmCtx.lineWidth=1.5;
  mmCtx.strokeRect(vx,vy,vw,vh);
}

// ═══════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════
function render() {
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Deep-space border colour
  ctx.fillStyle='#07050a';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  if (!mapTiles.length) return; // map not yet generated

  ctx.imageSmoothingEnabled = false;
  const sz=TILE_SZ*zoom;
  const c0=Math.max(0,  Math.floor(camX/sz));
  const r0=Math.max(0,  Math.floor(camY/sz));
  const c1=Math.min(MAP_W-1, Math.ceil((camX+canvas.width)/sz));
  const r1=Math.min(MAP_H-1, Math.ceil((camY+canvas.height)/sz));

  for (let row=r0; row<=r1; row++) {
    for (let col=c0; col<=c1; col++) {
      const t=mapTiles[row][col];
      const v=mapVariant[row][col];
      const sx=Math.floor(col*sz-camX);
      const sy=Math.floor(row*sz-camY);
      const sw=Math.ceil(sz)+1; // +1 eliminates seams

      ctx.fillStyle=tileBaseColor(col,row,t,v,time);
      ctx.fillRect(sx,sy,sw,sw);

      drawDetails(col,row,t,sx,sy,sz,v,time);

      // Subtle inner bevel for depth
      if (sz>=6) {
        const bv=Math.max(1,Math.min(3,sz*0.07));
        ctx.fillStyle='rgba(255,255,255,0.055)';
        ctx.fillRect(sx,sy,sw,bv);
        ctx.fillRect(sx,sy,bv,sw);
        ctx.fillStyle='rgba(0,0,0,0.10)';
        ctx.fillRect(sx,sy+sw-bv,sw,bv);
        ctx.fillRect(sx+sw-bv,sy,bv,sw);
      }

      // Fog of war overlay
      const fi = row*MAP_W + col;
      if (!fogVisible[fi]) {
        ctx.fillStyle = fogExplored[fi] ? 'rgba(0,0,0,0.62)' : '#07050a';
        ctx.fillRect(sx, sy, sw, sw);
      }
    }
  }

  // Grid overlay
  if (showGrid&&sz>=8) {
    ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=0.5;
    for (let col=c0; col<=c1+1; col++) {
      const x=Math.floor(col*sz-camX);
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
    }
    for (let row=r0; row<=r1+1; row++) {
      const y=Math.floor(row*sz-camY);
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
    }
  }

  drawNightOverlay();
  drawObjects();

  // Placement preview
  if (placingTownCenter) {
    const psz=TILE_SZ*zoom;
    const htx=Math.floor((msx+camX)/psz);
    const hty=Math.floor((msy+camY)/psz);
    const valid=canSettleAt(htx,hty);
    const hsx=Math.floor(htx*psz-camX);
    const hsy=Math.floor(hty*psz-camY);
    const hsw=Math.ceil(psz);
    ctx.fillStyle=valid?'rgba(80,200,80,0.18)':'rgba(200,60,60,0.18)';
    ctx.fillRect(hsx,hsy,hsw,hsw);
    ctx.globalAlpha=0.65;
    drawSprite(TC_STAMP,TC_PAL,hsx,hsy,psz);
    ctx.globalAlpha=1.0;
    const bw=Math.max(1,Math.floor(psz*0.06));
    ctx.fillStyle=valid?'rgba(80,200,80,0.9)':'rgba(200,60,60,0.9)';
    ctx.fillRect(hsx,hsy,hsw,bw); ctx.fillRect(hsx,hsy+hsw-bw,hsw,bw);
    ctx.fillRect(hsx,hsy,bw,hsw); ctx.fillRect(hsx+hsw-bw,hsy,bw,hsw);
  }

  if (placingType !== null) {
    const psz=TILE_SZ*zoom;
    const htx=Math.floor((msx+camX)/psz);
    const hty=Math.floor((msy+camY)/psz);
    const valid=canBuildAt(htx,hty,placingType);
    const hsx=Math.floor(htx*psz-camX);
    const hsy=Math.floor(hty*psz-camY);
    const [pw,ph]=STRUCT_SIZE[placingType]||[1,1];
    const hsw=Math.ceil(psz*pw);
    const hsh=Math.ceil(psz*ph);
    const bsz=psz*pw; // sprite rendered at building width
    ctx.fillStyle=valid?'rgba(80,200,80,0.18)':'rgba(200,60,60,0.18)';
    ctx.fillRect(hsx,hsy,hsw,hsh);
    ctx.globalAlpha=0.65;
    drawSprite(BSTAMP[placingType],BSTAMP_PAL[placingType],hsx,hsy,bsz);
    ctx.globalAlpha=1.0;
    const bww=Math.max(1,Math.floor(psz*0.06));
    ctx.fillStyle=valid?'rgba(80,200,80,0.85)':'rgba(200,60,60,0.85)';
    ctx.fillRect(hsx,hsy,hsw,bww);
    ctx.fillRect(hsx,hsy+hsh-bww,hsw,bww);
    ctx.fillRect(hsx,hsy,bww,hsh);
    ctx.fillRect(hsx+hsw-bww,hsy,bww,hsh);
  }

  // Vignette
  const vg=ctx.createRadialGradient(
    canvas.width*.5,canvas.height*.5,canvas.height*.28,
    canvas.width*.5,canvas.height*.5,canvas.height*.88
  );
  vg.addColorStop(0,'rgba(0,0,0,0)');
  vg.addColorStop(1,'rgba(0,0,0,0.38)');
  ctx.fillStyle=vg;
  ctx.fillRect(0,0,canvas.width,canvas.height);
}
