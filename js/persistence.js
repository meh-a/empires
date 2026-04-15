// ── persistence.js ──

// ═══════════════════════════════════════════════════
//  SAVE / LOAD GAME STATE
// ═══════════════════════════════════════════════════

let _savedVillagers = null;
let _savedBuildings = null;
let _autoSaveInterval = null;

function saveGame() {
  const gameState = {
    // World seed
    seed: SEED,
    
    // Time
    day: day,
    dayTime: dayTime,
    time: time,
    
    // Resources
    gold: gold,
    wood: wood,
    food: food,
    crops: crops,
    stone: stone,
    iron: iron,
    
    // Tools
    toolStock: [...toolStock],
    
    // Entities (serialize carefully)
    villagers: villagers.map(v => ({
      id: v.id,
      name: v.name,
      x: v.x,
      y: v.y,
      tx: v.tx,
      ty: v.ty,
      role: v.role,
      tier: v.tier,
      xp: v.xp,
      toolTier: v.toolTier,
      state: v.state,
      hunger: v.hunger,
      tired: v.tired,
      hp: v.hp,
      maxHp: v.maxHp,
      idleTimer: v.idleTimer,
      upgradeTimer: v.upgradeTimer,
      patrolAngle: v.patrolAngle,
      chopTimer: v.chopTimer,
      farmTimer: v.farmTimer,
      bakeTimer: v.bakeTimer,
      mineTimer: v.mineTimer,
      forgeTimer: v.forgeTimer,
      repairTimer: v.repairTimer,
      attackTimer: v.attackTimer,
      chopTarget: v.chopTarget ? { id: v.chopTarget.id, tx: v.chopTarget.tx, ty: v.chopTarget.ty } : null,
      farmTarget: v.farmTarget ? { id: v.farmTarget.id } : null,
      bakeryTarget: v.bakeryTarget ? { id: v.bakeryTarget.id } : null,
      mineTarget: v.mineTarget ? { id: v.mineTarget.id } : null,
      forgeTarget: v.forgeTarget ? { id: v.forgeTarget.id } : null,
      buildTarget: v.buildTarget,
      repairTarget: v.repairTarget,
      towerTarget: v.towerTarget,
    })),
    
    buildings: buildings.map(b => ({
      id: b.id,
      type: b.type,
      tx: b.tx,
      ty: b.ty,
      w: b.w,
      h: b.h,
      hp: b.hp,
      maxHp: b.maxHp,
      complete: b.complete,
      progress: b.progress,
      fertility: b.fertility,
      mountainBonus: b.mountainBonus,
      adjacencyBonus: b.adjacencyBonus,
    })),
    
    // Trees
    trees: trees.map(t => ({
      id: t.id,
      tx: t.tx,
      ty: t.ty,
      ox: t.ox,
      oy: t.oy,
      scale: t.scale,
    })),
    
    // Building counts
    buildCounts: [...buildCounts],
    
    // Town center
    townCenter: townCenter ? { tx: townCenter.tx, ty: townCenter.ty } : null,
    settled: settled,
    
    // Road tiles (convert Set to array)
    roadTiles: Array.from(roadTiles),
    
    // Regrowth queue
    regrowthQueue: regrowthQueue.map(r => ({ tx: r.tx, ty: r.ty, timer: r.timer })),
  };
  
  // Save to localStorage
  localStorage.setItem('empires-save', JSON.stringify(gameState));
  notify('💾 Game saved!', '');
}

function loadGame() {
  const saved = localStorage.getItem('empires-save');
  if (!saved) return false;
  
  try {
    const gameState = JSON.parse(saved);
    
    // Restore world with saved seed
    SEED = gameState.seed;
    
    // Restore time
    day = gameState.day;
    dayTime = gameState.dayTime;
    time = gameState.time;
    
    // Restore resources
    gold = gameState.gold;
    wood = gameState.wood;
    food = gameState.food;
    crops = gameState.crops;
    stone = gameState.stone;
    iron = gameState.iron;
    
    // Restore tools
    toolStock = gameState.toolStock ? [...gameState.toolStock] : [999, 0, 0];
    
    // Restore town center and settlement state
    townCenter = gameState.townCenter;
    settled = gameState.settled;
    
    // Restore build counts
    buildCounts = gameState.buildCounts ? [...gameState.buildCounts] : buildCounts;
    
    // Road tiles
    roadTiles = new Set(gameState.roadTiles || []);
    
    // Regrowth queue
    regrowthQueue = gameState.regrowthQueue ? [...gameState.regrowthQueue] : [];
    
    // Store villagers and buildings for reconstruction after world gen
    _savedVillagers = gameState.villagers;
    _savedBuildings = gameState.buildings;
    _savedTrees = gameState.trees;
    
    return true;
  } catch (e) {
    console.error('Failed to load save:', e);
    return false;
  }
}

function deleteSave() {
  localStorage.removeItem('empires-save');
  notify('Save deleted');
}

// Auto-save every 60 seconds during gameplay
function startAutoSave() {
  if (_autoSaveInterval) return; // Already running
  _autoSaveInterval = setInterval(() => {
    if (settled && !placingTownCenter && gameState === 'playing') {
      saveGame();
    }
  }, 60000); // 60 seconds
}

function stopAutoSave() {
  if (_autoSaveInterval) {
    clearInterval(_autoSaveInterval);
    _autoSaveInterval = null;
  }
}

// Helper to link rebuilt IDs after world load
function _linkSavedEntities() {
  if (!_savedVillagers || !_savedBuildings) return;
  
  // Rebuild villager reference maps
  const villagerMap = new Map();
  const buildingMap = new Map();
  
  for (const v of villagers) {
    villagerMap.set(v.id, v);
  }
  for (const b of buildings) {
    buildingMap.set(b.id, b);
  }
  
  // Re-link targets
  for (const v of villagers) {
    if (v.chopTarget?.id !== undefined) {
      const tree = trees.find(t => t.id === v.chopTarget.id);
      v.chopTarget = tree || null;
    }
    if (v.farmTarget?.id !== undefined) {
      v.farmTarget = buildingMap.get(v.farmTarget.id) || null;
    }
    if (v.bakeryTarget?.id !== undefined) {
      v.bakeryTarget = buildingMap.get(v.bakeryTarget.id) || null;
    }
    if (v.mineTarget?.id !== undefined) {
      v.mineTarget = buildingMap.get(v.mineTarget.id) || null;
    }
    if (v.forgeTarget?.id !== undefined) {
      v.forgeTarget = buildingMap.get(v.forgeTarget.id) || null;
    }
  }
}