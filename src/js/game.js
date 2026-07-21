// ==========================================================
// くまっちパズル Phase1: コアゲームロジック
// フィールド・落下・移動・回転・壁蹴り・ネクスト・消去・重力・連鎖
// ==========================================================

const COLS = 6;
const ROWS = 12;      // 表示される段数
const SPAWN_ROW = ROWS; // 13段目(非表示スポーン位置)。row index 0=最下段, 12=非表示
const COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'white']; // レベルに応じて解放

const FALL_INTERVAL_BASE = 800; // ms (Lv1-5)
const FALL_INTERVAL_MIN = 100;  // ms (Lv50到達時の最高速度)
const FALL_INTERVAL_SOFT = 45;    // ms (ソフトドロップ中)
const LOCK_DELAY = 350;           // ms (着地してから固定するまでの猶予)
const FALL_SETTLE_DELAY = 220;    // ms (重力で落ちきってから次の連鎖判定に入るまでの間)

// レベルに応じた自然落下の間隔(ms)を計算する。
// Lv1-5: 固定速度 / Lv6-50: 徐々に速く(線形補間) / Lv51-99: 最高速度維持
// Lv10以降はさらに1.2倍速くなる(間隔を1.2で割る)
function getFallInterval(lv) {
  const clampedLv = Math.min(Math.max(lv, 1), 50);
  let interval;
  if (clampedLv <= 5) {
    interval = FALL_INTERVAL_BASE;
  } else {
    const ratio = (clampedLv - 5) / (50 - 5);
    interval = FALL_INTERVAL_BASE - (FALL_INTERVAL_BASE - FALL_INTERVAL_MIN) * ratio;
  }
  if (lv >= 10) {
    interval = interval / 1.2;
  }
  return Math.max(interval, 30); // 極端に速くなりすぎないよう下限を設ける
}

// レベルごとの解放色 (Lv1-9:4色 / Lv10-19:5色(紫) / Lv20-99:6色(白))
function colorsForLevel(lv) {
  if (lv >= 20) return COLORS; // 赤青黄緑紫白
  if (lv >= 10) return COLORS.slice(0, 5); // 紫まで
  return COLORS.slice(0, 4); // 赤青黄緑
}

// レベルアップに必要な消去数: Lv1→2は50個、以降1レベルごとに1.1倍
function getRequiredClears(lv) {
  return Math.round(50 * Math.pow(1.1, lv - 1));
}

// ----------------------------------------------------------
// 得点計算(新方式)
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

// grid[row][col] = null または色文字列。row 0が最下段。
let grid = [];
for (let r = 0; r <= SPAWN_ROW; r++) {
  grid.push(new Array(COLS).fill(null));
}

let queue = [];       // ネクスト待機列 [{axisColor, subColor}, ...]
let current = null;   // 現在操作中のピース
let fallTimer = 0;
let lastTime = 0;
let softDropping = false;
let lockTimer = null;
let isLocking = false;
let gameOver = false;
let chainCount = 0;
let totalCleared = 0;
let score = 0;
let level = 1;
let clearedThisLevel = 0;

// 回転の壁蹴り失敗状態(同じキーを連続で押すと上下シフトになる仕様)
let rotationFailedDir = null; // 'cw' | 'ccw' | null

// ----------------------------------------------------------
// DOM初期化
// ----------------------------------------------------------
const boardEl = document.getElementById('board');
const gridCellsEl = document.getElementById('grid-cells');
const nextBoxes = [document.getElementById('next1'), document.getElementById('next2')];
const chainToastEl = document.getElementById('chain-toast');
const zenkeshiToastEl = document.getElementById('zenkeshi-toast');
const scoreEl = document.getElementById('score-value');
const levelEl = document.getElementById('level-value');
const liveTimeEl = document.getElementById('live-time-value');
const gameoverEl = document.getElementById('gameover');
const retryBtn = document.getElementById('retry-btn');
const titleBtn = document.getElementById('title-btn');

const cellEls = []; // cellEls[row][col]
function buildBoardDom() {
  gridCellsEl.innerHTML = '';
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
}
buildBoardDom();

function randomColor() {
  const pool = colorsForLevel(level);
  // 白は他の色より出現しにくくする(重み0.35倍)
  const weights = pool.map(c => (c === 'white' ? 0.35 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function fillQueue() {
  while (queue.length < 2) {
    const axisColor = randomColor();
    let subColor = randomColor();
    // 白×白の組み合わせは避ける(同時に2個出てこないように)
    if (axisColor === 'white' && subColor === 'white') {
      const nonWhitePool = colorsForLevel(level).filter(c => c !== 'white');
      subColor = nonWhitePool.length > 0
        ? nonWhitePool[Math.floor(Math.random() * nonWhitePool.length)]
        : subColor;
    }
    queue.push({ axisColor, subColor });
  }
}
fillQueue();

// ----------------------------------------------------------
// ピース定義
// orientation: 0=subは下, 1=subは右, 2=subは上, 3=subは左 (axis基準)
// ----------------------------------------------------------
function offsetFor(orientation) {
  switch (orientation) {
    case 0: return { dr: -1, dc: 0 };
    case 1: return { dr: 0, dc: 1 };
    case 2: return { dr: 1, dc: 0 };
    case 3: return { dr: 0, dc: -1 };
  }
}

function spawnPiece() {
  fillQueue();
  const next = queue.shift();
  fillQueue();

  const axisRow = SPAWN_ROW;
  const axisCol = Math.floor(COLS / 2) - 1;
  const piece = {
    axisRow, axisCol,
    orientation: 0,
    axisColor: next.axisColor,
    subColor: next.subColor,
  };
  const off = offsetFor(piece.orientation);
  piece.subRow = piece.axisRow + off.dr;
  piece.subCol = piece.axisCol + off.dc;

  // 出現位置が既に埋まっていたらゲームオーバー
  if (cellOccupied(piece.axisRow, piece.axisCol) || cellOccupied(piece.subRow, piece.subCol)) {
    triggerGameOver();
    return null;
  }
  return piece;
}

function cellOccupied(row, col) {
  if (col < 0 || col >= COLS || row < 0 || row > SPAWN_ROW) return true;
  return grid[row][col] !== null && grid[row][col] !== undefined;
}

function canPlace(axisRow, axisCol, orientation) {
  const off = offsetFor(orientation);
  const subRow = axisRow + off.dr;
  const subCol = axisCol + off.dc;
  if (axisCol < 0 || axisCol >= COLS || subCol < 0 || subCol >= COLS) return false;
  if (axisRow < 0 || subRow < 0) return false;
  if (axisRow > SPAWN_ROW || subRow > SPAWN_ROW) return false;
  if (cellOccupied(axisRow, axisCol)) return false;
  if (cellOccupied(subRow, subCol)) return false;
  return true;
}

// ----------------------------------------------------------
// 操作: 移動
// ----------------------------------------------------------
function tryMove(dc) {
  if (!current || gameOver) return;
  const newAxisCol = current.axisCol + dc;
  if (canPlace(current.axisRow, newAxisCol, current.orientation)) {
    current.axisCol = newAxisCol;
    const off = offsetFor(current.orientation);
    current.subCol = current.axisCol + off.dc;
    resetLockIfFloating();
    render();
  }
}

function tryMoveVertical(dr) {
  if (!current) return false;
  const newAxisRow = current.axisRow + dr;
  if (canPlace(newAxisRow, current.axisCol, current.orientation)) {
    current.axisRow = newAxisRow;
    const off = offsetFor(current.orientation);
    current.subRow = current.axisRow + off.dr;
    return true;
  }
  return false;
}

// ----------------------------------------------------------
// 操作: 回転 (壁蹴り: 左1マス→右1マス→上1マス)
// 壁蹴りが全て失敗した場合、同じキーを連続で押すと上下にシフトする(上優先)
// ----------------------------------------------------------
function tryRotate(dir) { // dir: 'cw' or 'ccw'
  if (!current || gameOver) return;
  const delta = dir === 'cw' ? 1 : 3;
  const newOrientation = (current.orientation + delta) % 4;

  // 1. そのまま回転
  if (canPlace(current.axisRow, current.axisCol, newOrientation)) {
    applyRotation(newOrientation);
    rotationFailedDir = null;
    return;
  }
  // 2. 左に1マス
  if (canPlace(current.axisRow, current.axisCol - 1, newOrientation)) {
    current.axisCol -= 1;
    applyRotation(newOrientation);
    rotationFailedDir = null;
    return;
  }
  // 3. 右に1マス
  if (canPlace(current.axisRow, current.axisCol + 1, newOrientation)) {
    current.axisCol += 1;
    applyRotation(newOrientation);
    rotationFailedDir = null;
    return;
  }
  // 4. 上に1マス
  if (canPlace(current.axisRow + 1, current.axisCol, newOrientation)) {
    current.axisRow += 1;
    applyRotation(newOrientation);
    rotationFailedDir = null;
    return;
  }

  // すべて失敗
  if (rotationFailedDir === dir) {
    // 同じキーの連続入力 → 上下にシフト(上優先)
    if (!tryMoveVertical(1)) {
      tryMoveVertical(-1);
    }
    rotationFailedDir = null;
    render();
    return;
  }
  rotationFailedDir = dir;
}

function applyRotation(newOrientation) {
  current.orientation = newOrientation;
  const off = offsetFor(current.orientation);
  current.subRow = current.axisRow + off.dr;
  current.subCol = current.axisCol + off.dc;
  resetLockIfFloating();
  render();
}

// ----------------------------------------------------------
// 落下 / 固定
// ----------------------------------------------------------
function resetLockIfFloating() {
  if (isLocking && canFall()) {
    isLocking = false;
    clearTimeout(lockTimer);
  }
}

function canFall() {
  if (!current) return false;
  return canPlace(current.axisRow - 1, current.axisCol, current.orientation);
}

function stepFall() {
  if (!current || gameOver) return;
  if (canFall()) {
    current.axisRow -= 1;
    const off = offsetFor(current.orientation);
    current.subRow = current.axisRow + off.dr;
    isLocking = false;
    render();
  } else {
    startLockSequence();
  }
}

function startLockSequence() {
  if (isLocking) return;
  isLocking = true;
  lockTimer = setTimeout(() => {
    if (current && !canFall()) {
      lockPiece();
    }
    isLocking = false;
  }, LOCK_DELAY);
}

function lockPiece() {
  if (!current) return;
  grid[current.axisRow][current.axisCol] = current.axisColor;
  grid[current.subRow][current.subCol] = current.subColor;
  current = null;
  applyGravity(); // 片方の下に隙間がある場合、そのブロックだけ落下させる
  render();
  resolveBoard().then(() => {
    if (!gameOver) {
      current = spawnPiece();
      render();
    }
  });
}

// ----------------------------------------------------------
// 消去判定・重力・連鎖
// ----------------------------------------------------------
function findGroups() {
  const visited = Array.from({ length: SPAWN_ROW }, () => new Array(COLS).fill(false));
  const groups = [];

  function bfsFrom(r, c, seedColor) {
    const stack = [[r, c]];
    visited[r][c] = true;
    const group = [];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      group.push([cr, cc]);
      const neighbors = [[cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]];
      for (const [nr, nc] of neighbors) {
        if (nr < 0 || nr >= SPAWN_ROW || nc < 0 || nc >= COLS) continue;
        if (visited[nr][nc]) continue;
        if (grid[nr][nc] === seedColor) {
          visited[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
    }
    return group;
  }

  // 白・灰(お邪魔)は色グループに参加しない。隣接する色が消える時だけ巻き込まれて消える。
  for (let r = 0; r < SPAWN_ROW; r++) {
    for (let c = 0; c < COLS; c++) {
      const seedColor = grid[r][c];
      if (!seedColor || seedColor === 'gray' || seedColor === 'white' || visited[r][c]) continue;
      const group = bfsFrom(r, c, seedColor);
      if (group.length >= 4) groups.push(group);
    }
  }
  return groups;
}

function applyGravity() {
  for (let c = 0; c < COLS; c++) {
    const stack = [];
    for (let r = 0; r < SPAWN_ROW; r++) {
      if (grid[r][c] !== null) stack.push(grid[r][c]);
    }
    for (let r = 0; r < SPAWN_ROW; r++) {
      grid[r][c] = r < stack.length ? stack[r] : null;
    }
  }
}

function resolveBoard() {
  return new Promise((resolve) => {
    chainCount = 0;
    scoreEl.textContent = score;

    function step() {
      const groups = findGroups();
      if (groups.length === 0) {
        render();
        resolve();
        return;
      }

      // findGroups()の時点で白・灰は色グループに含まれないので、そのままcellsToClearとする
      const perGroupCleared = groups;
      const cellsToClear = [];
      perGroupCleared.forEach(g => cellsToClear.push(...g));

      if (cellsToClear.length === 0) {
        // 消せるセルが1つもなければこれ以上は連鎖しない
        render();
        resolve();
        return;
      }

      // お邪魔ブロック・白ブロックは、隣接する色ブロックが消える時に巻き込まれて一緒に消える
      const clearSet = new Set(cellsToClear.map(([r, c]) => `${r},${c}`));
      const grayToClear = [];
      const whiteSweptToClear = [];
      cellsToClear.forEach(([r, c]) => {
        [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]].forEach(([nr, nc]) => {
          if (nr < 0 || nr >= SPAWN_ROW || nc < 0 || nc >= COLS) return;
          const key = `${nr},${nc}`;
          if (clearSet.has(key)) return;
          if (grid[nr][nc] === 'gray') { clearSet.add(key); grayToClear.push([nr, nc]); }
          else if (grid[nr][nc] === 'white') { clearSet.add(key); whiteSweptToClear.push([nr, nc]); }
        });
      });
      const allClearingCells = [...cellsToClear, ...grayToClear, ...whiteSweptToClear];

      chainCount += 1;

      allClearingCells.forEach(([r, c]) => {
        if (r < ROWS) cellEls[r][c].classList.add('clearing');
      });

      // 得点計算(新方式): グループサイズ→同時消去ボーナス表 + 連鎖ボーナス(加算・倍々)
      const groupSizes = perGroupCleared.map(g => g.length).filter(sz => sz > 0);
      const clearScore = computeClearScore(groupSizes);
      const chainBonus = computeChainBonus(chainCount);
      totalCleared += allClearingCells.length;
      score += clearScore + chainBonus;
      // 白ブロックを消すと、1個につき「同色10個消し」相当の得点+5000点ボーナス
      if (whiteSweptToClear.length > 0) {
        score += whiteSweptToClear.length * (computeClearScore([10]) + 5000);
      }
      scoreEl.textContent = score;

      clearedThisLevel += allClearingCells.length;
      while (clearedThisLevel >= getRequiredClears(level)) {
        clearedThisLevel -= getRequiredClears(level);
        level += 1;
        levelEl.textContent = level;
      }

      showChainToast(chainCount);

      setTimeout(() => {
        allClearingCells.forEach(([r, c]) => {
          grid[r][c] = null;
        });
        applyGravity();

        // 全消し判定(盤面に何も残っていない場合)
        const isAllClear = grid.slice(0, SPAWN_ROW).every(row => row.every(cell => cell === null));
        if (isAllClear) {
          score += 5000;
          scoreEl.textContent = score;
          showZenkeshiEffect();
        }

        render();
        allClearingCells.forEach(([r, c]) => {
          if (r < ROWS) cellEls[r][c].classList.remove('clearing');
        });
        // ブロックが落ちきるまで少し待ってから次の連鎖判定を行う
        setTimeout(step, FALL_SETTLE_DELAY);
      }, 300);
    }
    step();
  });
}

function showChainToast(n) {
  if (n < 1) return;
  chainToastEl.textContent = n >= 2 ? `${n} れんさ!!` : '';
  if (n < 2) return;
  chainToastEl.classList.remove('show');
  void chainToastEl.offsetWidth; // reflow でアニメーション再トリガー
  chainToastEl.classList.add('show');
}

function showZenkeshiEffect() {
  zenkeshiToastEl.classList.remove('show');
  void zenkeshiToastEl.offsetWidth; // reflow でアニメーション再トリガー
  zenkeshiToastEl.classList.add('show');
}

// ----------------------------------------------------------
// ゲームオーバー
// ----------------------------------------------------------
function triggerGameOver() {
  gameOver = true;
  gameoverEl.classList.add('show');
  lastPlayDurationSeconds = Math.max(0, Math.round((Date.now() - gameStartTime) / 1000));
  timeDisplayEl.textContent = `プレイ時間: ${formatDuration(lastPlayDurationSeconds)}`;
  rankNameInput.value = '';
  rankStatusEl.textContent = '';
  rankSubmitBtn.disabled = false;
  rankSubmitBtn.textContent = 'ランキングに登録';
}

function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function resetGame() {
  grid = [];
  for (let r = 0; r <= SPAWN_ROW; r++) grid.push(new Array(COLS).fill(null));
  queue = [];
  fillQueue();
  score = 0;
  totalCleared = 0;
  chainCount = 0;
  level = 1;
  clearedThisLevel = 0;
  gameOver = false;
  gameoverEl.classList.remove('show');
  scoreEl.textContent = '0';
  levelEl.textContent = '1';
  liveTimeEl.textContent = '0:00';
  gameStartTime = Date.now();
  paused = false;
  pauseOverlay.classList.remove('show');
  pauseToggle.textContent = '⏸';
  current = spawnPiece();
  render();
}

retryBtn.addEventListener('click', resetGame);
titleBtn.addEventListener('click', () => {
  window.location.href = 'index.html';
});

// ----------------------------------------------------------
// ランキング登録(Supabase)
// ----------------------------------------------------------
const rankNameInput = document.getElementById('rank-name');
const rankSubmitBtn = document.getElementById('rank-submit-btn');
const rankStatusEl = document.getElementById('rank-status');
const timeDisplayEl = document.getElementById('time-display');

rankSubmitBtn.addEventListener('click', async () => {
  const name = rankNameInput.value.trim().slice(0, 12);
  if (!name) {
    rankStatusEl.textContent = 'なまえを入力してください';
    return;
  }
  if (!supabaseClient) {
    rankStatusEl.textContent = 'ランキング機能は準備中です';
    return;
  }
  rankSubmitBtn.disabled = true;
  rankSubmitBtn.textContent = '送信中...';

  const { data: existing, error: selectError } = await supabaseClient
    .from('scores')
    .select('id, score')
    .eq('mode', 'solo')
    .eq('name', name)
    .maybeSingle();

  if (selectError) {
    rankStatusEl.textContent = '登録に失敗しました';
    rankSubmitBtn.disabled = false;
    rankSubmitBtn.textContent = 'ランキングに登録';
    console.error(selectError);
    return;
  }

  if (existing && existing.score >= score) {
    rankStatusEl.textContent = `自己ベスト(${existing.score}点)を更新できませんでした`;
    rankSubmitBtn.disabled = false;
    rankSubmitBtn.textContent = 'ランキングに登録';
    return;
  }

  const payload = {
    name: name,
    score: score,
    level: level,
    mode: 'solo',
    duration_seconds: lastPlayDurationSeconds,
  };

  const { error } = existing
    ? await supabaseClient.from('scores').update(payload).eq('id', existing.id)
    : await supabaseClient.from('scores').insert(payload);

  if (error) {
    rankStatusEl.textContent = '登録に失敗しました';
    rankSubmitBtn.disabled = false;
    rankSubmitBtn.textContent = 'ランキングに登録';
    console.error(error);
  } else {
    rankStatusEl.textContent = existing ? '自己ベストを更新しました!' : '登録しました!';
    rankSubmitBtn.textContent = '登録済み';
  }
});

// ゲーム中BGM: 音量小さめ・自動再生ブロック対策
const bgm = document.getElementById('bgm');
const soundToggle = document.getElementById('sound-toggle');
bgm.volume = 0.22;

function updateSoundIcon() {
  soundToggle.textContent = (!bgm.paused && !bgm.muted) ? '🔊' : '🔈';
}
function tryPlayBgm() {
  bgm.muted = true;
  const p = bgm.play();
  if (p && p.then) {
    p.then(() => { bgm.muted = false; updateSoundIcon(); }).catch(() => {
      bgm.muted = false;
      const resumeOnInteraction = () => {
        bgm.play().then(updateSoundIcon).catch(() => {});
        document.removeEventListener('click', resumeOnInteraction);
        document.removeEventListener('keydown', resumeOnInteraction);
        document.removeEventListener('touchstart', resumeOnInteraction);
      };
      document.addEventListener('click', resumeOnInteraction, { once: true });
      document.addEventListener('keydown', resumeOnInteraction, { once: true });
      document.addEventListener('touchstart', resumeOnInteraction, { once: true });
    });
  }
}
tryPlayBgm();
soundToggle.addEventListener('click', () => {
  if (bgm.paused) { bgm.play().then(updateSoundIcon).catch(() => {}); }
  else { bgm.pause(); updateSoundIcon(); }
});

// ----------------------------------------------------------
// くまの顔ブロック画像 (背景を透過処理したPNG画像を使用し、
// 立体感のある3Dブロック風グラデーションの上に重ねて表示する)
// ----------------------------------------------------------
const BLOCK_IMAGE_PATHS = {
  red: 'assets/images/blocks/red.png',
  blue: 'assets/images/blocks/blue.png',
  yellow: 'assets/images/blocks/yellow.png',
  green: 'assets/images/blocks/green.png',
  purple: 'assets/images/blocks/purple.png',
  white: 'assets/images/blocks/white.png',
  gray: 'assets/images/blocks/gray.png',
};

// ページ読み込み時に画像を先読みしておき、ゲーム開始直後にブロックが
// 一瞬見えなくなる(画像読み込み待ち)のを防ぐ
Object.values(BLOCK_IMAGE_PATHS).forEach((src) => {
  const img = new Image();
  img.src = src;
});

function applyBlockFace(el, color) {
  if (!color) {
    el.className = 'cell';
    el.style.backgroundImage = '';
    return;
  }
  el.className = 'cell filled cube';
  el.style.backgroundImage = `url("${BLOCK_IMAGE_PATHS[color]}")`;
  el.style.backgroundSize = '100% 100%';
  el.style.backgroundPosition = 'center';
  el.style.backgroundRepeat = 'no-repeat';
}

// ----------------------------------------------------------
// 描画
// ----------------------------------------------------------
let lastRenderedGrid = null;
let lastRenderedNextKey = null;
function render() {
  if (!lastRenderedGrid) {
    lastRenderedGrid = [];
    for (let r = 0; r < ROWS; r++) lastRenderedGrid.push(new Array(COLS).fill(undefined));
  }

  // 盤面 + 落下中ピースを合成した「今表示すべき色」を作る
  const display = [];
  for (let r = 0; r < ROWS; r++) display.push(grid[r].slice(0, COLS));
  if (current) {
    if (current.axisRow < ROWS) display[current.axisRow][current.axisCol] = current.axisColor;
    if (current.subRow < ROWS) display[current.subRow][current.subCol] = current.subColor;
  }

  // 前回描画時と変わったセルだけ更新する(毎回全セルを描き直すと点滅の原因になるため)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (display[r][c] !== lastRenderedGrid[r][c]) {
        applyBlockFace(cellEls[r][c], display[r][c]);
        lastRenderedGrid[r][c] = display[r][c];
      }
    }
  }

  // ネクスト表示
  const nextKey = queue.slice(0, 2).map(p => `${p.axisColor},${p.subColor}`).join('|');
  if (lastRenderedNextKey !== nextKey) {
    lastRenderedNextKey = nextKey;
    queue.slice(0, 2).forEach((p, i) => {
      const box = nextBoxes[i];
      box.innerHTML = '';
      [p.axisColor, p.subColor].forEach(color => {
        const d = document.createElement('div');
        d.className = 'next-cell cube';
        d.style.backgroundImage = `url("${BLOCK_IMAGE_PATHS[color]}")`;
        d.style.backgroundSize = '100% 100%';
        d.style.backgroundPosition = 'center';
        d.style.backgroundRepeat = 'no-repeat';
        box.appendChild(d);
      });
    });
  }
}

// ----------------------------------------------------------
// 入力
// ----------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (gameOver || paused) return;
  switch (e.key) {
    case 'ArrowLeft':
      tryMove(-1);
      break;
    case 'ArrowRight':
      tryMove(1);
      break;
    case 'ArrowUp':
    case 'x':
    case 'X':
      tryRotate('cw');
      break;
    case 'z':
    case 'Z':
      tryRotate('ccw');
      break;
    case 'ArrowDown':
      softDropping = true;
      break;
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowDown') softDropping = false;
});

// タッチ操作パッド(スマホ用)
function bindTouchButton(id, onPress, onRelease) {
  const el = document.getElementById(id);
  if (!el) return;
  const press = (e) => { e.preventDefault(); if (!gameOver && !paused) onPress(); };
  const release = (e) => { e.preventDefault(); if (onRelease) onRelease(); };
  el.addEventListener('touchstart', press, { passive: false });
  el.addEventListener('mousedown', press);
  if (onRelease) {
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('mouseup', release);
    el.addEventListener('mouseleave', release);
  }
}
bindTouchButton('touch-left', () => tryMove(-1));
bindTouchButton('touch-right', () => tryMove(1));
bindTouchButton('touch-up', () => tryRotate('cw'));
bindTouchButton('touch-rotate-l', () => tryRotate('ccw'));
bindTouchButton('touch-rotate-r', () => tryRotate('cw'));
bindTouchButton('touch-down', () => { softDropping = true; }, () => { softDropping = false; });

// ----------------------------------------------------------
// ポーズ機能: ポーズ中は盤面を完全に隠し、落下・入力・タイムを止める
// ----------------------------------------------------------
let paused = false;
let pauseStartedAt = 0;
let bgmWasPlayingBeforePause = false;
const pauseToggle = document.getElementById('pause-toggle');
const pauseOverlay = document.getElementById('pause-overlay');
const resumeBtn = document.getElementById('resume-btn');

function setPaused(value) {
  if (gameOver || paused === value) return;
  paused = value;
  if (paused) {
    pauseStartedAt = Date.now();
    softDropping = false;
    pauseOverlay.classList.add('show');
    pauseToggle.textContent = '▶';
    bgmWasPlayingBeforePause = !bgm.paused;
    bgm.pause();
  } else {
    // 停止していた時間ぶん、開始時刻を後ろにずらして経過時間の計算がずれないようにする
    gameStartTime += Date.now() - pauseStartedAt;
    pauseOverlay.classList.remove('show');
    pauseToggle.textContent = '⏸';
    if (bgmWasPlayingBeforePause) bgm.play().then(updateSoundIcon).catch(() => {});
  }
}
pauseToggle.addEventListener('click', () => setPaused(!paused));
resumeBtn.addEventListener('click', () => setPaused(false));

// ----------------------------------------------------------
// メインループ
// ----------------------------------------------------------
function loop(time) {
  if (!lastTime) lastTime = time;
  const dt = time - lastTime;
  lastTime = time;

  if (!gameOver && !paused && current) {
    fallTimer += dt;
    const interval = softDropping ? FALL_INTERVAL_SOFT : getFallInterval(level);
    if (fallTimer >= interval) {
      fallTimer = 0;
      stepFall();
    }
    liveTimeEl.textContent = formatDuration(Math.floor((Date.now() - gameStartTime) / 1000));
  }
  requestAnimationFrame(loop);
}

// ----------------------------------------------------------
// 開始
// ----------------------------------------------------------
let gameStartTime = Date.now();
let lastPlayDurationSeconds = 0;
current = spawnPiece();
render();
requestAnimationFrame(loop);
