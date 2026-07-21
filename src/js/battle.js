// ==========================================================
// くまっちパズル AI対戦モード
// プレイヤー側とAI側、それぞれ独立した盤面を同じルールで動かし、
// 連鎖に応じておじゃまブロックを相手に送り合う。
// 盤面の共通ロジック(定数・消去判定・重力・スコア計算・DOM構築)は
// puzzle-core.js を参照(battle.html で本ファイルより先に読み込む)。
// ==========================================================

const AI_MOVE_STEP_MS = 130; // AIが1マス動くのにかける時間(見た目のため。難易度別の値はgetAIMoveStepMsを参照)
function getAIMoveStepMs(difficulty) {
  switch (difficulty) {
    case 'easy': return 260;
    case 'normal': return 190;
    case 'hard': return 120;
    case 'master': return 90;
    default: return AI_MOVE_STEP_MS;
  }
}

// ----------------------------------------------------------
// AIのシミュレーション用: 消去→重力を全て解決した結果を同期的に計算
// ----------------------------------------------------------
function simulateResolve(grid) {
  let chainCount = 0, totalCleared = 0, whiteUsed = false, firstGroupCount = 0;
  while (true) {
    const groups = findGroups(grid);
    if (groups.length === 0) break;
    const cellsToClear = [];
    groups.forEach(g => g.forEach(([r, c]) => cellsToClear.push([r, c])));
    if (cellsToClear.length === 0) break;
    const clearSet = new Set(cellsToClear.map(([r, c]) => `${r},${c}`));
    cellsToClear.forEach(([r, c]) => {
      [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]].forEach(([nr, nc]) => {
        if (nr < 0 || nr >= SPAWN_ROW || nc < 0 || nc >= COLS) return;
        const key = `${nr},${nc}`;
        if (clearSet.has(key)) return;
        if (grid[nr][nc] === 'gray' || grid[nr][nc] === 'white') {
          clearSet.add(key);
          cellsToClear.push([nr, nc]);
          if (grid[nr][nc] === 'white') whiteUsed = true;
        }
      });
    });
    chainCount += 1;
    if (chainCount === 1) firstGroupCount = groups.length;
    totalCleared += cellsToClear.length;
    cellsToClear.forEach(([r, c]) => { grid[r][c] = null; });
    applyGravity(grid);
  }
  const allClear = grid.slice(0, SPAWN_ROW).every(row => row.every(cell => cell === null));
  return { chainCount, totalCleared, whiteUsed, allClear, firstGroupCount };
}
function findRestingRow(grid, axisCol, orientation) {
  if (!canPlace(grid, SPAWN_ROW, axisCol, orientation)) return null;
  let row = SPAWN_ROW;
  while (canPlace(grid, row - 1, axisCol, orientation)) row--;
  return row;
}
function simulatePlacement(grid, axisColor, subColor, axisCol, orientation) {
  const restRow = findRestingRow(grid, axisCol, orientation);
  if (restRow === null) return null;
  const g2 = cloneGrid(grid);
  const off = offsetFor(orientation);
  g2[restRow][axisCol] = axisColor;
  g2[restRow + off.dr][axisCol + off.dc] = subColor;
  const res = simulateResolve(g2);
  const heights = columnHeights(g2);
  const holes = countHoles(g2, heights);
  return { ...res, grid: g2, maxHeight: Math.max(...heights), holes };
}
function computeSetupPotential(grid) {
  // まだ消えていない色クラスタ(2〜3個の隣接)を評価し、将来の連鎖の"仕込み"を数値化する
  const visited = Array.from({ length: SPAWN_ROW }, () => new Array(COLS).fill(false));
  let potential = 0;
  for (let r = 0; r < SPAWN_ROW; r++) for (let c = 0; c < COLS; c++) {
    const seed = grid[r][c];
    if (!seed || seed === 'gray' || seed === 'white' || visited[r][c]) continue;
    const stack = [[r, c]]; visited[r][c] = true; let size = 0;
    while (stack.length) {
      const [cr, cc2] = stack.pop(); size++;
      for (const [nr, nc] of [[cr + 1, cc2], [cr - 1, cc2], [cr, cc2 + 1], [cr, cc2 - 1]]) {
        if (nr < 0 || nr >= SPAWN_ROW || nc < 0 || nc >= COLS) continue;
        if (visited[nr][nc]) continue;
        if (grid[nr][nc] === seed) { visited[nr][nc] = true; stack.push([nr, nc]); }
      }
    }
    if (size === 3) potential += 12;
    else if (size === 2) potential += 4;
  }
  return potential;
}
function scoreCandidate(sim, difficulty) {
  let holePenalty = 18, heightPenalty = 3, chainWeight = 550, setupWeight = 2;
  if (difficulty === 'easy') { holePenalty = 10; heightPenalty = 2; chainWeight = 400; setupWeight = 0; }
  else if (difficulty === 'hard') { holePenalty = 24; heightPenalty = 3; chainWeight = 950; setupWeight = 7; }
  else if (difficulty === 'master') { holePenalty = 20; heightPenalty = 2; chainWeight = 1150; setupWeight = 10; }
  let score = sim.chainCount * chainWeight + sim.totalCleared * 8;
  if (sim.allClear) score += 3000;
  score -= sim.holes * holePenalty;
  score -= sim.maxHeight * heightPenalty;
  score += computeSetupPotential(sim.grid) * setupWeight;
  return score;
}
function decideMove(side) {
  const candidates = [];
  for (let col = 0; col < COLS; col++) {
    for (let orientation = 0; orientation < 4; orientation++) {
      const sim = simulatePlacement(side.grid, side.current.axisColor, side.current.subColor, col, orientation);
      if (!sim) continue;
      let score = scoreCandidate(sim, side.difficulty);
      if (side.difficulty === 'hard' || side.difficulty === 'master') {
        const nextPiece = side.queue[0];
        let bestNext = -Infinity;
        if (nextPiece) {
          for (let c2 = 0; c2 < COLS; c2++) for (let o2 = 0; o2 < 4; o2++) {
            const sim2 = simulatePlacement(sim.grid, nextPiece.axisColor, nextPiece.subColor, c2, o2);
            if (sim2) {
              const s2 = scoreCandidate(sim2, side.difficulty);
              if (s2 > bestNext) bestNext = s2;
            }
          }
        }
        if (bestNext > -Infinity) score += bestNext * 0.75;
      }
      candidates.push({ col, orientation, score });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);

  if (side.difficulty === 'easy') {
    const r = Math.random();
    if (r < 0.70) return candidates[0];
    if (r < 0.90) return candidates[1] || candidates[0];
    const rest = candidates.slice(2);
    if (rest.length > 0) return rest[Math.floor(Math.random() * rest.length)];
    return candidates[candidates.length - 1];
  }
  return candidates[0];
}

// ----------------------------------------------------------
// サイド(プレイヤー/AI)の生成
// ----------------------------------------------------------
function createSide(id, isAI, difficulty) {
  return {
    id,
    isAI,
    difficulty,
    grid: makeEmptyGrid(),
    queue: [],
    current: null,
    fallTimer: 0,
    softDropping: false,
    lockTimer: null,
    isLocking: false,
    gameOver: false,
    level: 1,
    clearedThisLevel: 0,
    score: 0,
    chainCount: 0,
    incoming: 0,
    aiPlan: null,
    rotationFailedDir: null,
    cellEls: buildBoardDom(document.getElementById(`grid-cells-${id}`)),
    nextBoxEl: document.getElementById(`next-${id}`),
    scoreEl: document.getElementById(`score-${id}`),
    levelEl: document.getElementById(`level-${id}`),
    garbageEl: document.getElementById(`garbage-${id}`),
    chainToastEl: document.getElementById(`chain-toast-${id}`),
  };
}

function randomColorFor(side) {
  const forceAll = matchDifficulty === 'hard' || matchDifficulty === 'master';
  const pool = colorsForLevel(side.level, forceAll);
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
function fillQueue(side) {
  while (side.queue.length < 2) {
    const axisColor = randomColorFor(side);
    let subColor = randomColorFor(side);
    // 白×白の組み合わせは避ける(同時に2個出てこないように)
    if (axisColor === 'white' && subColor === 'white') {
      const forceAll = matchDifficulty === 'hard' || matchDifficulty === 'master';
      const nonWhitePool = colorsForLevel(side.level, forceAll).filter(c => c !== 'white');
      subColor = nonWhitePool.length > 0
        ? nonWhitePool[Math.floor(Math.random() * nonWhitePool.length)]
        : subColor;
    }
    side.queue.push({ axisColor, subColor });
  }
}

function spawnPiece(side, opponent) {
  fillQueue(side);
  const next = side.queue.shift();
  fillQueue(side);
  const axisRow = SPAWN_ROW;
  const axisCol = Math.floor(COLS / 2) - 1;
  const piece = { axisRow, axisCol, orientation: 0, axisColor: next.axisColor, subColor: next.subColor };
  const off = offsetFor(piece.orientation);
  piece.subRow = piece.axisRow + off.dr;
  piece.subCol = piece.axisCol + off.dc;

  if (cellOccupied(side.grid, piece.axisRow, piece.axisCol) || cellOccupied(side.grid, piece.subRow, piece.subCol)) {
    endMatch(side, opponent);
    return null;
  }
  side.softDropping = false;
  return piece;
}

function planAndQueueAIMove(side) {
  const best = decideMove(side);
  if (!best) { side.aiPlan = null; return; }
  side.current.orientation = best.orientation;
  const off = offsetFor(best.orientation);
  side.current.subRow = side.current.axisRow + off.dr;
  side.current.subCol = side.current.axisCol + off.dc;
  const dc = best.col - side.current.axisCol;
  side.aiPlan = { movesLeft: Math.abs(dc), dir: dc === 0 ? 0 : (dc > 0 ? 1 : -1), moveTimer: 0 };
}

// ----------------------------------------------------------
// 操作: 移動・回転(壁蹴り: 左1マス→右1マス→上1マス)
// ----------------------------------------------------------
function tryMove(side, dc) {
  if (!side.current || side.gameOver) return;
  const newAxisCol = side.current.axisCol + dc;
  if (canPlace(side.grid, side.current.axisRow, newAxisCol, side.current.orientation)) {
    side.current.axisCol = newAxisCol;
    const off = offsetFor(side.current.orientation);
    side.current.subCol = side.current.axisCol + off.dc;
    resetLockIfFloating(side);
    renderSide(side);
  }
}
function tryMoveVertical(side, dr) {
  if (!side.current) return false;
  const newAxisRow = side.current.axisRow + dr;
  if (canPlace(side.grid, newAxisRow, side.current.axisCol, side.current.orientation)) {
    side.current.axisRow = newAxisRow;
    const off = offsetFor(side.current.orientation);
    side.current.subRow = side.current.axisRow + off.dr;
    return true;
  }
  return false;
}
function tryRotate(side, dir) {
  if (!side.current || side.gameOver) return;
  const delta = dir === 'cw' ? 1 : 3;
  const newOrientation = (side.current.orientation + delta) % 4;
  const c = side.current;

  if (canPlace(side.grid, c.axisRow, c.axisCol, newOrientation)) { applyRotation(side, newOrientation); side.rotationFailedDir = null; return; }
  if (canPlace(side.grid, c.axisRow, c.axisCol - 1, newOrientation)) { c.axisCol -= 1; applyRotation(side, newOrientation); side.rotationFailedDir = null; return; }
  if (canPlace(side.grid, c.axisRow, c.axisCol + 1, newOrientation)) { c.axisCol += 1; applyRotation(side, newOrientation); side.rotationFailedDir = null; return; }
  if (canPlace(side.grid, c.axisRow + 1, c.axisCol, newOrientation)) { c.axisRow += 1; applyRotation(side, newOrientation); side.rotationFailedDir = null; return; }

  if (side.rotationFailedDir === dir) {
    if (!tryMoveVertical(side, 1)) tryMoveVertical(side, -1);
    side.rotationFailedDir = null;
    renderSide(side);
    return;
  }
  side.rotationFailedDir = dir;
}
function applyRotation(side, newOrientation) {
  side.current.orientation = newOrientation;
  const off = offsetFor(newOrientation);
  side.current.subRow = side.current.axisRow + off.dr;
  side.current.subCol = side.current.axisCol + off.dc;
  resetLockIfFloating(side);
  renderSide(side);
}

// ----------------------------------------------------------
// 落下 / 固定
// ----------------------------------------------------------
function resetLockIfFloating(side) {
  if (side.isLocking && canFall(side)) { side.isLocking = false; clearTimeout(side.lockTimer); }
}
function canFall(side) {
  if (!side.current) return false;
  return canPlace(side.grid, side.current.axisRow - 1, side.current.axisCol, side.current.orientation);
}
function stepFall(side, opponent) {
  if (!side.current || side.gameOver) return;
  if (canFall(side)) {
    side.current.axisRow -= 1;
    const off = offsetFor(side.current.orientation);
    side.current.subRow = side.current.axisRow + off.dr;
    side.isLocking = false;
    renderSide(side);
  } else {
    startLockSequence(side, opponent);
  }
}
function startLockSequence(side, opponent) {
  if (side.isLocking) return;
  side.isLocking = true;
  side.lockTimer = setTimeout(() => {
    if (side.current && !canFall(side)) lockPiece(side, opponent);
    side.isLocking = false;
  }, LOCK_DELAY);
}
function lockPiece(side, opponent) {
  if (!side.current || side.gameOver) return;
  side.grid[side.current.axisRow][side.current.axisCol] = side.current.axisColor;
  side.grid[side.current.subRow][side.current.subCol] = side.current.subColor;
  side.current = null;
  applyGravity(side.grid);
  renderSide(side);
  resolveBoardAnimated(side).then((garbageAmount) => {
    if (side.gameOver) return;
    if (garbageAmount > 0) sendGarbage(side, opponent, garbageAmount);
    const placedGarbage = dropPendingGarbage(side);
    if (side.gameOver) return;

    if (placedGarbage.length > 0) {
      renderSide(side);
      placedGarbage.forEach(([r, c]) => {
        if (r < ROWS) {
          const el = side.cellEls[r][c];
          el.classList.remove('garbage-fall');
          void el.offsetWidth;
          el.classList.add('garbage-fall');
        }
      });
      // お邪魔が落ちきる演出が終わるまで待ってから次のピースを出す
      setTimeout(() => {
        if (side.gameOver) return;
        side.current = spawnPiece(side, opponent);
        if (side.current && side.isAI) planAndQueueAIMove(side);
        renderSide(side);
      }, GARBAGE_FALL_ANIM_MS);
    } else {
      side.current = spawnPiece(side, opponent);
      if (side.current && side.isAI) planAndQueueAIMove(side);
      renderSide(side);
    }
  });
}

// ----------------------------------------------------------
// 消去判定・連鎖の実行(アニメーション付き)
// ----------------------------------------------------------
function resolveBoardAnimated(side) {
  return new Promise((resolve) => {
    side.chainCount = 0;
    let totalGarbage = 0;

    function step() {
      const groups = findGroups(side.grid);
      if (groups.length === 0) { renderSide(side); finish(); return; }

      // findGroups()の時点で白・灰は色グループに含まれないので、そのままcellsToClearとする
      const perGroupCleared = groups;
      const cellsToClear = [];
      perGroupCleared.forEach(g => cellsToClear.push(...g));

      if (cellsToClear.length === 0) { renderSide(side); finish(); return; }

      // お邪魔ブロック・白ブロックは、隣接する色ブロックが消える時に巻き込まれて一緒に消える
      const clearSet = new Set(cellsToClear.map(([r, c]) => `${r},${c}`));
      const grayToClear = [];
      const whiteSweptToClear = [];
      cellsToClear.forEach(([r, c]) => {
        [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]].forEach(([nr, nc]) => {
          if (nr < 0 || nr >= SPAWN_ROW || nc < 0 || nc >= COLS) return;
          const key = `${nr},${nc}`;
          if (clearSet.has(key)) return;
          if (side.grid[nr][nc] === 'gray') { clearSet.add(key); grayToClear.push([nr, nc]); }
          else if (side.grid[nr][nc] === 'white') { clearSet.add(key); whiteSweptToClear.push([nr, nc]); }
        });
      });
      const allClearingCells = [...cellsToClear, ...grayToClear, ...whiteSweptToClear];

      side.chainCount += 1;
      allClearingCells.forEach(([r, c]) => { if (r < ROWS) side.cellEls[r][c].classList.add('clearing'); });

      // 得点計算(新方式): グループごとのサイズ→同時消去ボーナス表 + 連鎖ボーナス(加算・倍々)
      const groupSizes = perGroupCleared.map(g => g.length).filter(sz => sz > 0);
      const clearScore = computeClearScore(groupSizes);
      const chainBonus = computeChainBonus(side.chainCount);
      side.score += clearScore + chainBonus;
      // 白ブロックを消すと、1個につき相手へお邪魔12個+自分の得点+5000点
      if (whiteSweptToClear.length > 0) {
        side.score += whiteSweptToClear.length * 5000;
        totalGarbage += whiteSweptToClear.length * 12;
      }
      side.scoreEl.textContent = side.score;

      totalGarbage += getGarbageSendAmount(side.chainCount) + getSimultaneousBonus(groups.length);

      side.clearedThisLevel += allClearingCells.length;
      while (side.clearedThisLevel >= getRequiredClears(side.level)) {
        side.clearedThisLevel -= getRequiredClears(side.level);
        side.level += 1;
        side.levelEl.textContent = side.level;
      }

      showChainToast(side, side.chainCount);

      setTimeout(() => {
        allClearingCells.forEach(([r, c]) => { side.grid[r][c] = null; });
        applyGravity(side.grid);

        const isAllClear = side.grid.slice(0, SPAWN_ROW).every(row => row.every(cell => cell === null));
        if (isAllClear) {
          totalGarbage += getGarbageSendAmount(5); // 全消しは5連鎖相当のお邪魔を送る
          side.score += 5000;
          side.scoreEl.textContent = side.score;
        }

        renderSide(side);
        allClearingCells.forEach(([r, c]) => { if (r < ROWS) side.cellEls[r][c].classList.remove('clearing'); });
        setTimeout(step, FALL_SETTLE_DELAY);
      }, 260);
    }

    function finish() {
      resolve(totalGarbage);
    }
    step();
  });
}

function showChainToast(side, n) {
  if (n < 2) return;
  side.chainToastEl.textContent = `${n} れんさ!!`;
  side.chainToastEl.classList.remove('show');
  void side.chainToastEl.offsetWidth;
  side.chainToastEl.classList.add('show');
}

// ----------------------------------------------------------
// おじゃまブロックの送受信
// ----------------------------------------------------------
function sendGarbage(fromSide, toSide, amount) {
  const cancel = Math.min(amount, fromSide.incoming);
  fromSide.incoming -= cancel;
  const remaining = amount - cancel;
  if (remaining > 0) toSide.incoming += remaining;
  fromSide.garbageEl.textContent = Math.ceil(fromSide.incoming);
  toSide.garbageEl.textContent = Math.ceil(toSide.incoming);
}

function dropPendingGarbage(side) {
  if (side.incoming <= 0 || side.gameOver) return [];
  const dropCount = Math.min(Math.round(side.incoming), GARBAGE_DROP_CAP);
  side.incoming -= dropCount;
  side.garbageEl.textContent = Math.ceil(side.incoming);

  const cols = [0, 1, 2, 3, 4, 5];
  for (let i = cols.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cols[i], cols[j]] = [cols[j], cols[i]];
  }
  const placed = [];
  let ci = 0, guard = 0;
  while (placed.length < dropCount && guard < dropCount * 40) {
    guard++;
    const col = cols[ci % cols.length]; ci++;
    let row = 0;
    while (row <= SPAWN_ROW && side.grid[row][col] !== null) row++;
    if (row > SPAWN_ROW) continue;
    side.grid[row][col] = 'gray';
    placed.push([row, col]);
  }
  return placed;
}

// ----------------------------------------------------------
// 描画
// ----------------------------------------------------------
function renderSide(side) {
  if (!side.lastRenderedGrid) {
    side.lastRenderedGrid = [];
    for (let r = 0; r < ROWS; r++) side.lastRenderedGrid.push(new Array(COLS).fill(undefined));
  }

  const display = [];
  for (let r = 0; r < ROWS; r++) display.push(side.grid[r].slice(0, COLS));
  if (side.current) {
    if (side.current.axisRow < ROWS) display[side.current.axisRow][side.current.axisCol] = side.current.axisColor;
    if (side.current.subRow < ROWS) display[side.current.subRow][side.current.subCol] = side.current.subColor;
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (display[r][c] !== side.lastRenderedGrid[r][c]) {
        applyBlockFace(side.cellEls[r][c], display[r][c]);
        side.lastRenderedGrid[r][c] = display[r][c];
      }
    }
  }

  const next = side.queue[0];
  const nextKey = next ? `${next.axisColor},${next.subColor}` : '';
  if (side.lastRenderedNextKey !== nextKey) {
    side.lastRenderedNextKey = nextKey;
    side.nextBoxEl.innerHTML = '';
    if (next) {
      [next.axisColor, next.subColor].forEach(color => {
        const d = document.createElement('div');
        d.className = 'next-mini-cell';
        d.style.backgroundImage = `url("${BLOCK_IMAGE_PATHS[color]}")`;
        d.style.backgroundSize = '100% 100%';
        d.style.backgroundPosition = 'center';
        d.style.backgroundRepeat = 'no-repeat';
        side.nextBoxEl.appendChild(d);
      });
    }
  }
}

// ----------------------------------------------------------
// 勝敗判定
// ----------------------------------------------------------
let matchOver = false;
function endMatch(losingSide, winningSide) {
  if (matchOver) return;
  matchOver = true;
  losingSide.gameOver = true;
  winningSide.gameOver = true;
  const playerWon = losingSide.id === 'ai';
  const titleEl = document.getElementById('result-title');
  titleEl.textContent = playerWon ? 'WIN!' : 'LOSE...';
  titleEl.className = playerWon ? 'win' : 'lose';
  document.getElementById('result-overlay').classList.add('show');

  lastMatchDurationSeconds = Math.max(0, Math.round((Date.now() - matchStartTime) / 1000));
  const rankSubmitBlock = document.getElementById('rank-submit');
  const timeDisplayEl = document.getElementById('match-time-display');

  if (playerWon) {
    rankSubmitBlock.style.display = '';
    timeDisplayEl.style.display = '';
    timeDisplayEl.textContent = `クリアタイム: ${formatDuration(lastMatchDurationSeconds)}`;
    rankNameInput.value = '';
    rankStatusEl.textContent = '';
    rankSubmitBtn.disabled = false;
    rankSubmitBtn.textContent = 'ランキングに登録';
  } else {
    rankSubmitBlock.style.display = 'none';
    timeDisplayEl.style.display = 'none';
  }
}

// ----------------------------------------------------------
// セットアップ・入力・メインループ
// ----------------------------------------------------------
let playerSide = null;
let aiSide = null;
let loopStarted = false;
let matchStartTime = 0;
let matchDifficulty = null;
let lastMatchDurationSeconds = 0;
let lastMatchDifficulty = null;

function prepareBoards(difficulty) {
  document.getElementById('result-overlay').classList.remove('show');
  document.getElementById('setup-overlay').style.display = 'none';
  document.getElementById('ai-label').textContent = `AI (${difficulty.toUpperCase()})`;
  matchTimerEl.textContent = '0:00';
  matchStartTime = 0;
  matchDifficulty = difficulty;
  paused = false;
  pauseOverlay.classList.remove('show');
  pauseToggle.textContent = '⏸';

  playerSide = createSide('player', false, null);
  aiSide = createSide('ai', true, difficulty);
  renderSide(playerSide);
  renderSide(aiSide);
}

function beginGameplay(difficulty) {
  matchOver = false;
  matchStartTime = Date.now();
  lastMatchDifficulty = difficulty;

  playerSide.current = spawnPiece(playerSide, aiSide);
  aiSide.current = spawnPiece(aiSide, playerSide);
  if (aiSide.current) planAndQueueAIMove(aiSide);
  renderSide(playerSide);
  renderSide(aiSide);

  if (!loopStarted) { loopStarted = true; requestAnimationFrame(loop); }
}

// ----------------------------------------------------------
// BGM: 難易度選択中はタイトルBGM、開始直前は無音、開始後はゲームBGM
// ----------------------------------------------------------
const titleBgm = document.getElementById('title-bgm');
const matchTimerEl = document.getElementById('match-timer');
const gameBgm = document.getElementById('game-bgm');
const soundToggle = document.getElementById('sound-toggle');
titleBgm.volume = 0.3;
gameBgm.volume = 0.22;
let activeBgm = titleBgm;
let soundMuted = false;

function updateSoundIcon() {
  soundToggle.textContent = (!soundMuted) ? '🔊' : '🔈';
}
function playBgm(el) {
  if (soundMuted) return;
  const p = el.play();
  if (p && p.catch) p.catch(() => {});
}
function tryStartTitleBgmOnLoad() {
  titleBgm.muted = true;
  const p = titleBgm.play();
  if (p && p.then) {
    p.then(() => {
      titleBgm.muted = false;
      updateSoundIcon();
    }).catch(() => {
      titleBgm.muted = false;
      const resumeOnInteraction = () => {
        if (activeBgm === titleBgm) playBgm(titleBgm);
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
tryStartTitleBgmOnLoad();
updateSoundIcon();

soundToggle.addEventListener('click', () => {
  soundMuted = !soundMuted;
  if (soundMuted) {
    titleBgm.pause();
    gameBgm.pause();
  } else {
    playBgm(activeBgm);
  }
  updateSoundIcon();
});

// ----------------------------------------------------------
// 3秒カウントダウン(無音)→ゲームBGM再生→試合開始
// ----------------------------------------------------------
function startCountdownThenMatch(difficulty) {
  titleBgm.pause(); // カウントダウン中は無音
  prepareBoards(difficulty); // 前回の盤面をすぐにクリアする

  const overlay = document.getElementById('countdown-overlay');
  const numberEl = document.getElementById('countdown-number');
  overlay.classList.add('show');

  let count = 3;
  numberEl.textContent = count;
  numberEl.classList.remove('pulse'); void numberEl.offsetWidth; numberEl.classList.add('pulse');

  const timer = setInterval(() => {
    count -= 1;
    if (count > 0) {
      numberEl.textContent = count;
      numberEl.classList.remove('pulse'); void numberEl.offsetWidth; numberEl.classList.add('pulse');
    } else {
      clearInterval(timer);
      overlay.classList.remove('show');
      beginGameplay(difficulty);
      activeBgm = gameBgm;
      gameBgm.currentTime = 0;
      playBgm(gameBgm);
      updateSoundIcon();
    }
  }, 1000);
}

function resetMatch(difficulty) {
  startCountdownThenMatch(difficulty);
}

let currentDifficulty = 'normal';
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentDifficulty = btn.dataset.diff;
    document.getElementById('setup-overlay').style.display = 'none';
    startCountdownThenMatch(currentDifficulty);
  });
});

document.getElementById('result-retry').addEventListener('click', () => startCountdownThenMatch(currentDifficulty));
document.getElementById('result-title-btn').addEventListener('click', () => { window.location.href = 'index.html'; });

// ----------------------------------------------------------
// ランキング登録(Supabase)
// ----------------------------------------------------------
const rankNameInput = document.getElementById('rank-name');
const rankSubmitBtn = document.getElementById('rank-submit-btn');
const rankStatusEl = document.getElementById('rank-status');

rankSubmitBtn.addEventListener('click', async () => {
  const name = rankNameInput.value.trim().slice(0, 12);
  if (!name) { rankStatusEl.textContent = 'なまえを入力してください'; return; }
  if (!supabaseClient) { rankStatusEl.textContent = 'ランキング機能は準備中です'; return; }
  if (!playerSide) return;

  rankSubmitBtn.disabled = true;
  rankSubmitBtn.textContent = '送信中...';

  const { data: existing, error: selectError } = await supabaseClient
    .from('scores')
    .select('id, duration_seconds')
    .eq('mode', 'battle')
    .eq('difficulty', lastMatchDifficulty)
    .eq('name', name)
    .maybeSingle();

  if (selectError) {
    rankStatusEl.textContent = '登録に失敗しました';
    rankSubmitBtn.disabled = false;
    rankSubmitBtn.textContent = 'ランキングに登録';
    console.error(selectError);
    return;
  }

  if (existing && existing.duration_seconds <= lastMatchDurationSeconds) {
    rankStatusEl.textContent = `自己ベスト(${formatDuration(existing.duration_seconds)})を更新できませんでした`;
    rankSubmitBtn.disabled = false;
    rankSubmitBtn.textContent = 'ランキングに登録';
    return;
  }

  const payload = {
    name: name,
    score: playerSide.score,
    level: playerSide.level,
    mode: 'battle',
    difficulty: lastMatchDifficulty,
    duration_seconds: lastMatchDurationSeconds,
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

document.addEventListener('keydown', (e) => {
  if (!playerSide || playerSide.gameOver || matchOver || paused) return;
  switch (e.key) {
    case 'ArrowLeft': tryMove(playerSide, -1); break;
    case 'ArrowRight': tryMove(playerSide, 1); break;
    case 'ArrowUp': case 'x': case 'X': tryRotate(playerSide, 'cw'); break;
    case 'z': case 'Z': tryRotate(playerSide, 'ccw'); break;
    case 'ArrowDown': playerSide.softDropping = true; break;
  }
});
document.addEventListener('keyup', (e) => {
  if (playerSide && e.key === 'ArrowDown') playerSide.softDropping = false;
});

// タッチ操作パッド(スマホ用) - プレイヤー側のみ操作可能
function bindTouchButton(id, onPress, onRelease) {
  const el = document.getElementById(id);
  if (!el) return;
  const canAct = () => playerSide && !playerSide.gameOver && !matchOver && !paused;
  const press = (e) => { e.preventDefault(); if (canAct()) onPress(); };
  const release = (e) => { e.preventDefault(); if (onRelease) onRelease(); };
  el.addEventListener('touchstart', press, { passive: false });
  el.addEventListener('mousedown', press);
  if (onRelease) {
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('mouseup', release);
    el.addEventListener('mouseleave', release);
  }
}
bindTouchButton('touch-left', () => tryMove(playerSide, -1));
bindTouchButton('touch-right', () => tryMove(playerSide, 1));
bindTouchButton('touch-up', () => tryRotate(playerSide, 'cw'));
bindTouchButton('touch-rotate-l', () => tryRotate(playerSide, 'ccw'));
bindTouchButton('touch-rotate-r', () => tryRotate(playerSide, 'cw'));
bindTouchButton('touch-down', () => { playerSide.softDropping = true; }, () => { if (playerSide) playerSide.softDropping = false; });

// ----------------------------------------------------------
// ポーズ機能: ポーズ中は両者の盤面を完全に隠し、進行を止める
// ----------------------------------------------------------
let paused = false;
let pauseStartedAt = 0;
let bgmWasPlayingBeforePause = false;
const pauseToggle = document.getElementById('pause-toggle');
const pauseOverlay = document.getElementById('pause-overlay');
const resumeBtn = document.getElementById('resume-btn');

function setPaused(value) {
  if (!playerSide || matchOver || paused === value) return;
  paused = value;
  if (paused) {
    pauseStartedAt = Date.now();
    if (playerSide) playerSide.softDropping = false;
    pauseOverlay.classList.add('show');
    pauseToggle.textContent = '▶';
    bgmWasPlayingBeforePause = !activeBgm.paused;
    activeBgm.pause();
  } else {
    if (matchStartTime) matchStartTime += Date.now() - pauseStartedAt;
    pauseOverlay.classList.remove('show');
    pauseToggle.textContent = '⏸';
    if (bgmWasPlayingBeforePause) playBgm(activeBgm);
  }
}
pauseToggle.addEventListener('click', () => setPaused(!paused));
resumeBtn.addEventListener('click', () => setPaused(false));

let lastTime = 0;
function updateSide(side, dt, opponent) {
  if (side.gameOver || !side.current) return;
  if (side.isAI && side.aiPlan) {
    side.aiPlan.moveTimer += dt;
    if (side.aiPlan.moveTimer >= getAIMoveStepMs(side.difficulty)) {
      side.aiPlan.moveTimer = 0;
      if (side.aiPlan.movesLeft > 0 && side.aiPlan.dir !== 0) {
        tryMove(side, side.aiPlan.dir);
        side.aiPlan.movesLeft--;
      }
      if (side.aiPlan.movesLeft <= 0) { side.softDropping = true; side.aiPlan = null; }
    }
  }
  side.fallTimer += dt;
  const interval = side.softDropping ? FALL_INTERVAL_SOFT : getFallInterval(side.level);
  if (side.fallTimer >= interval) { side.fallTimer = 0; stepFall(side, opponent); }
}
function loop(time) {
  if (!lastTime) lastTime = time;
  const dt = time - lastTime;
  lastTime = time;
  if (playerSide && aiSide && !matchOver && !paused) {
    updateSide(playerSide, dt, aiSide);
    updateSide(aiSide, dt, playerSide);
    if (matchStartTime) {
      matchTimerEl.textContent = formatDuration(Math.floor((Date.now() - matchStartTime) / 1000));
    }
  }
  requestAnimationFrame(loop);
}
