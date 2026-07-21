// ==========================================================
// くまっちパズル 共有エンジン
// 盤面の純粋なロジック(定数・消去判定・重力・スコア計算・DOM構築)を
// まとめたモジュール。AI対戦(battle.js)とオンライン対戦(online-battle.js)の
// 両方から読み込まれる。特定のモード(AI思考・ネットワーク通信)には依存しない。
// ==========================================================

const COLS = 6;
const ROWS = 12;
const SPAWN_ROW = ROWS; // 13段目(非表示)

const COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'white'];

const BLOCK_IMAGE_PATHS = {
  red: 'assets/images/blocks/red.png',
  blue: 'assets/images/blocks/blue.png',
  yellow: 'assets/images/blocks/yellow.png',
  green: 'assets/images/blocks/green.png',
  purple: 'assets/images/blocks/purple.png',
  white: 'assets/images/blocks/white.png',
  gray: 'assets/images/blocks/gray.png',
};

// 難易度選択・マッチング待ちの間に画像を先読みしておき、対戦開始直後に
// ブロックが一瞬見えなくなる(画像読み込み待ち)のを防ぐ
Object.values(BLOCK_IMAGE_PATHS).forEach((src) => {
  const img = new Image();
  img.src = src;
});

const FALL_INTERVAL_BASE = 800;
const FALL_INTERVAL_MIN = 100;
const FALL_INTERVAL_SOFT = 45;
const LOCK_DELAY = 350;
const FALL_SETTLE_DELAY = 220; // ms (重力で落ちきってから次の連鎖判定に入るまでの間)
const GARBAGE_DROP_CAP = 30; // 1回の着地でまとめて落とす最大おじゃま数
const GARBAGE_FALL_ANIM_MS = 950; // お邪魔の落下演出(CSS側は0.9秒)が終わるまでの待ち時間

function colorsForLevel(lv, forceAllColors) {
  if (forceAllColors) return COLORS;
  if (lv >= 20) return COLORS;
  if (lv >= 10) return COLORS.slice(0, 5);
  return COLORS.slice(0, 4);
}
function getRequiredClears(lv) {
  return Math.round(50 * Math.pow(1.1, lv - 1));
}

// ----------------------------------------------------------
// 得点計算
// 基本: 1個10点。同時に複数の色グループが消えた場合はボーナステーブルを適用。
// 連鎖ボーナスは加算式で、連鎖するごとに倍になる(2連鎖+40, 3連鎖+80, 4連鎖+160...)
// ----------------------------------------------------------
const MULTI_COLOR_BONUS = { 2: 160, 3: 320, 4: 640, 5: 800 };
function computeClearScore(groupSizes) {
  const n = groupSizes.length;
  if (n === 0) return 0;
  if (n === 1) {
    const size = groupSizes[0];
    let s = size * 10;
    if (size >= 10) s += 500; // 同色10個以上の大量同時消しボーナス
    return s;
  }
  if (MULTI_COLOR_BONUS[n] !== undefined) return MULTI_COLOR_BONUS[n];
  return 40 * Math.pow(2, n); // 6色以上の同時消去は事実上発生しないための概算値
}
function computeChainBonus(chainCount) {
  if (chainCount < 2) return 0;
  return 40 * Math.pow(2, chainCount - 2);
}
function getFallInterval(lv) {
  const clampedLv = Math.min(Math.max(lv, 1), 50);
  let interval;
  if (clampedLv <= 5) interval = FALL_INTERVAL_BASE;
  else {
    const ratio = (clampedLv - 5) / (50 - 5);
    interval = FALL_INTERVAL_BASE - (FALL_INTERVAL_BASE - FALL_INTERVAL_MIN) * ratio;
  }
  if (lv >= 10) interval = interval / 1.2;
  return Math.max(interval, 30);
}
function getGarbageSendAmount(chain) {
  const table = [0, 1, 2, 6, 12, 20, 30, 42, 56, 72, 90];
  if (chain <= 10) return table[chain] || 0;
  return 90 + (chain - 10) * 18;
}
function getSimultaneousBonus(groupCount) {
  if (groupCount >= 5) return 12;
  if (groupCount === 4) return 8;
  if (groupCount === 3) return 5;
  if (groupCount === 2) return 2;
  return 0;
}

// ----------------------------------------------------------
// 純粋な盤面操作関数 (grid引数を取り、実盤面にもAIのシミュレーションにも使う)
// ----------------------------------------------------------
function makeEmptyGrid() {
  const g = [];
  for (let r = 0; r <= SPAWN_ROW; r++) g.push(new Array(COLS).fill(null));
  return g;
}
function cloneGrid(grid) { return grid.map(row => row.slice()); }

function offsetFor(orientation) {
  switch (orientation) {
    case 0: return { dr: -1, dc: 0 };
    case 1: return { dr: 0, dc: 1 };
    case 2: return { dr: 1, dc: 0 };
    case 3: return { dr: 0, dc: -1 };
  }
}
function cellOccupied(grid, row, col) {
  if (col < 0 || col >= COLS || row < 0 || row > SPAWN_ROW) return true;
  return grid[row][col] !== null && grid[row][col] !== undefined;
}
function canPlace(grid, axisRow, axisCol, orientation) {
  const off = offsetFor(orientation);
  const subRow = axisRow + off.dr;
  const subCol = axisCol + off.dc;
  if (axisCol < 0 || axisCol >= COLS || subCol < 0 || subCol >= COLS) return false;
  if (axisRow < 0 || subRow < 0) return false;
  if (axisRow > SPAWN_ROW || subRow > SPAWN_ROW) return false;
  if (cellOccupied(grid, axisRow, axisCol)) return false;
  if (cellOccupied(grid, subRow, subCol)) return false;
  return true;
}
function findGroups(grid) {
  const visited = Array.from({ length: SPAWN_ROW }, () => new Array(COLS).fill(false));
  const groups = [];
  function bfsFrom(r, c, seedColor) {
    const stack = [[r, c]]; visited[r][c] = true; const group = [];
    while (stack.length) {
      const [cr, cc] = stack.pop(); group.push([cr, cc]);
      const neighbors = [[cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]];
      for (const [nr, nc] of neighbors) {
        if (nr < 0 || nr >= SPAWN_ROW || nc < 0 || nc >= COLS) continue;
        if (visited[nr][nc]) continue;
        if (grid[nr][nc] === seedColor) { visited[nr][nc] = true; stack.push([nr, nc]); }
      }
    }
    return group;
  }
  // 白・灰(お邪魔)は色グループに参加しない。隣接する色が消える時だけ巻き込まれて消える。
  for (let r = 0; r < SPAWN_ROW; r++) for (let c = 0; c < COLS; c++) {
    const seedColor = grid[r][c];
    if (!seedColor || seedColor === 'gray' || seedColor === 'white' || visited[r][c]) continue;
    const group = bfsFrom(r, c, seedColor);
    if (group.length >= 4) groups.push(group);
  }
  return groups;
}
function applyGravity(grid) {
  for (let c = 0; c < COLS; c++) {
    const stack = [];
    for (let r = 0; r < SPAWN_ROW; r++) if (grid[r][c] !== null) stack.push(grid[r][c]);
    for (let r = 0; r < SPAWN_ROW; r++) grid[r][c] = r < stack.length ? stack[r] : null;
  }
}
function columnHeights(grid) {
  const heights = [];
  for (let c = 0; c < COLS; c++) {
    let h = 0;
    for (let r = SPAWN_ROW - 1; r >= 0; r--) { if (grid[r][c] !== null) { h = r + 1; break; } }
    heights.push(h);
  }
  return heights;
}
function countHoles(grid, heights) {
  let holes = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < heights[c]; r++) if (grid[r][c] === null) holes++;
  }
  return holes;
}

// ----------------------------------------------------------
// DOM構築・描画(プレイヤー盤面・AI盤面・ネットワーク相手盤面のいずれにも使う)
// ----------------------------------------------------------
function buildBoardDom(gridCellsEl) {
  gridCellsEl.innerHTML = ''; // 前回分の古いセルを必ず消してから作り直す
  const cellEls = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    cellEls[r] = cellEls[r] || [];
    for (let c = 0; c < COLS; c++) {
      const div = document.createElement('div');
      div.className = 'cell';
      div.style.gridRowStart = (ROWS - r);
      div.style.gridColumnStart = (c + 1);
      gridCellsEl.appendChild(div);
      cellEls[r][c] = div;
    }
  }
  return cellEls;
}

function applyBlockFace(el, color) {
  if (!color) { el.className = 'cell'; el.style.backgroundImage = ''; return; }
  el.className = 'cell filled cube' + (color === 'gray' ? ' gray-block' : '');
  el.style.backgroundImage = `url("${BLOCK_IMAGE_PATHS[color]}")`;
  el.style.backgroundSize = '100% 100%';
  el.style.backgroundPosition = 'center';
  el.style.backgroundRepeat = 'no-repeat';
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
