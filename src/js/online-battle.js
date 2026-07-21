// ==========================================================
// くまっちパズル オンライン対戦モード
//
// 設計方針:
// - 自分側の盤面(mySide)は今まで通り完全にローカルで動かす
//   (物理演算・入力・消去判定は puzzle-core.js の共通ロジック + AI対戦と同じ挙動)
// - 相手側の盤面(opponentMirror)はローカルでは一切シミュレーションしない。
//   相手のクライアントから Supabase Realtime Broadcast で送られてくる
//   「表示用グリッドのスナップショット」をそのまま描画するだけの"ミラー"。
//   → 通信が多少遅延しても、盤面がズレて壊れる(デシンク)ことがない。
// - おじゃまブロックの送受信は Broadcast メッセージでやり取りする。
// - 対戦相手探し(ルームコード/ランダムマッチング)は Supabase Realtime の
//   チャンネル名 = ルームコード として扱う。ランダムマッチングだけ
//   supabase/schema.sql の find_or_create_match RPC でルームコードを発行する。
// ==========================================================

const SNAPSHOT_INTERVAL_MS = 120;
const RANDOM_POLL_INTERVAL_MS = 1800;
const ROOM_CHANNEL_PREFIX = 'kumacchi-room-';
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字(0/O/1/I)を除いた読み上げやすいコード

function makeClientId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const myClientId = makeClientId();

function makeRoomCode(len) {
  len = len || 6;
  let s = '';
  for (let i = 0; i < len; i++) s += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return s;
}

// ----------------------------------------------------------
// 相手盤面スナップショット用: 1マス1文字にエンコードして送る(帯域節約)
// ----------------------------------------------------------
const COLOR_CODE = { red: 'r', blue: 'b', yellow: 'y', green: 'g', purple: 'p', white: 'w', gray: 'x' };
const CODE_COLOR = {};
Object.keys(COLOR_CODE).forEach((k) => { CODE_COLOR[COLOR_CODE[k]] = k; });

function encodeDisplayGrid(side) {
  const display = [];
  for (let r = 0; r < ROWS; r++) display.push(side.grid[r].slice(0, COLS));
  if (side.current) {
    if (side.current.axisRow < ROWS) display[side.current.axisRow][side.current.axisCol] = side.current.axisColor;
    if (side.current.subRow < ROWS) display[side.current.subRow][side.current.subCol] = side.current.subColor;
  }
  let s = '';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = display[r][c];
    s += v ? COLOR_CODE[v] : '.';
  }
  return s;
}

// ----------------------------------------------------------
// 自分側の盤面(ローカルで完全に動かす)
// ----------------------------------------------------------
function createLocalSide() {
  return {
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
    rotationFailedDir: null,
    cellEls: buildBoardDom(document.getElementById('grid-cells-player')),
    nextBoxEl: document.getElementById('next-player'),
    scoreEl: document.getElementById('score-player'),
    levelEl: document.getElementById('level-player'),
    garbageEl: document.getElementById('garbage-player'),
    chainToastEl: document.getElementById('chain-toast-player'),
  };
}

function randomColorFor(side) {
  const pool = colorsForLevel(side.level, false);
  // 白は他の色より出現しにくくする(重み0.35倍)
  const weights = pool.map((c) => (c === 'white' ? 0.35 : 1));
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
    if (axisColor === 'white' && subColor === 'white') {
      const nonWhitePool = colorsForLevel(side.level, false).filter((c) => c !== 'white');
      subColor = nonWhitePool.length > 0
        ? nonWhitePool[Math.floor(Math.random() * nonWhitePool.length)]
        : subColor;
    }
    side.queue.push({ axisColor, subColor });
  }
}
function spawnPiece(side) {
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
    handleLocalGameOver();
    return null;
  }
  side.softDropping = false;
  return piece;
}

// ----------------------------------------------------------
// 操作: 移動・回転(壁蹴り: 左1マス→右1マス→上1マス) ※AI対戦のプレイヤー側と同じ挙動
// ----------------------------------------------------------
function tryMove(dc) {
  const side = mySide;
  if (!side || !side.current || side.gameOver || matchOver) return;
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
function tryRotate(dir) {
  const side = mySide;
  if (!side || !side.current || side.gameOver || matchOver) return;
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
function stepFall() {
  const side = mySide;
  if (!side || !side.current || side.gameOver || matchOver) return;
  if (canFall(side)) {
    side.current.axisRow -= 1;
    const off = offsetFor(side.current.orientation);
    side.current.subRow = side.current.axisRow + off.dr;
    side.isLocking = false;
    renderSide(side);
  } else {
    startLockSequence(side);
  }
}
function startLockSequence(side) {
  if (side.isLocking) return;
  side.isLocking = true;
  side.lockTimer = setTimeout(() => {
    if (side.current && !canFall(side)) lockPiece();
    side.isLocking = false;
  }, LOCK_DELAY);
}
function lockPiece() {
  const side = mySide;
  if (!side || !side.current || side.gameOver) return;
  side.grid[side.current.axisRow][side.current.axisCol] = side.current.axisColor;
  side.grid[side.current.subRow][side.current.subCol] = side.current.subColor;
  side.current = null;
  applyGravity(side.grid);
  renderSide(side);
  resolveBoardAnimated(side).then((garbageAmount) => {
    if (side.gameOver) return;
    if (garbageAmount > 0) netSendGarbage(garbageAmount);
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
      setTimeout(() => {
        if (side.gameOver) return;
        side.current = spawnPiece(side);
        renderSide(side);
      }, GARBAGE_FALL_ANIM_MS);
    } else {
      side.current = spawnPiece(side);
      renderSide(side);
    }
  });
}

// ----------------------------------------------------------
// 消去判定・連鎖の実行(アニメーション付き) ※AI対戦と全く同じロジック
// ----------------------------------------------------------
function resolveBoardAnimated(side) {
  return new Promise((resolve) => {
    side.chainCount = 0;
    let totalGarbage = 0;

    function step() {
      const groups = findGroups(side.grid);
      if (groups.length === 0) { renderSide(side); finish(); return; }

      const perGroupCleared = groups;
      const cellsToClear = [];
      perGroupCleared.forEach((g) => cellsToClear.push(...g));

      if (cellsToClear.length === 0) { renderSide(side); finish(); return; }

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

      const groupSizes = perGroupCleared.map((g) => g.length).filter((sz) => sz > 0);
      const clearScore = computeClearScore(groupSizes);
      const chainBonus = computeChainBonus(side.chainCount);
      side.score += clearScore + chainBonus;
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

        const isAllClear = side.grid.slice(0, SPAWN_ROW).every((row) => row.every((cell) => cell === null));
        if (isAllClear) {
          totalGarbage += getGarbageSendAmount(5);
          side.score += 5000;
          side.scoreEl.textContent = side.score;
        }

        renderSide(side);
        allClearingCells.forEach(([r, c]) => { if (r < ROWS) side.cellEls[r][c].classList.remove('clearing'); });
        setTimeout(step, FALL_SETTLE_DELAY);
      }, 260);
    }

    function finish() { resolve(totalGarbage); }
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
// おじゃまブロックの送受信(ネットワーク越し)
// ----------------------------------------------------------
function netSendGarbage(amount) {
  const side = mySide;
  const cancel = Math.min(amount, side.incoming);
  side.incoming -= cancel;
  const remaining = amount - cancel;
  side.garbageEl.textContent = Math.ceil(side.incoming);
  if (remaining > 0 && roomChannel) {
    roomChannel.send({ type: 'broadcast', event: 'garbage', payload: { amount: remaining } });
  }
}
function onNetGarbage(payload) {
  if (matchOver || !mySide || !payload) return;
  mySide.incoming += payload.amount;
  mySide.garbageEl.textContent = Math.ceil(mySide.incoming);
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
// 描画: 自分側(通常のシミュレーション結果をそのまま描く)
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
      [next.axisColor, next.subColor].forEach((color) => {
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
// 描画: 相手側(ネットワークから届いたスナップショットをそのまま反映するだけの"ミラー")
// ----------------------------------------------------------
function createOpponentMirror() {
  return {
    cellEls: buildBoardDom(document.getElementById('grid-cells-opponent')),
    lastRenderedGrid: null,
    nextBoxEl: document.getElementById('next-opponent'),
    scoreEl: document.getElementById('score-opponent'),
    levelEl: document.getElementById('level-opponent'),
    garbageEl: document.getElementById('garbage-opponent'),
    chainToastEl: document.getElementById('chain-toast-opponent'),
    lastRenderedNextKey: '',
  };
}
function renderMirrorGrid(mirror, gridStr) {
  if (!gridStr) return;
  if (!mirror.lastRenderedGrid) {
    mirror.lastRenderedGrid = [];
    for (let r = 0; r < ROWS; r++) mirror.lastRenderedGrid.push(new Array(COLS).fill(undefined));
  }
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = gridStr[i++];
      const color = (!ch || ch === '.') ? null : CODE_COLOR[ch];
      if (mirror.lastRenderedGrid[r][c] !== color) {
        applyBlockFace(mirror.cellEls[r][c], color);
        mirror.lastRenderedGrid[r][c] = color;
      }
    }
  }
}
function renderMirrorNext(mirror, nextColors) {
  const key = nextColors ? nextColors.join(',') : '';
  if (mirror.lastRenderedNextKey === key) return;
  mirror.lastRenderedNextKey = key;
  mirror.nextBoxEl.innerHTML = '';
  if (nextColors) {
    nextColors.forEach((color) => {
      const d = document.createElement('div');
      d.className = 'next-mini-cell';
      d.style.backgroundImage = `url("${BLOCK_IMAGE_PATHS[color]}")`;
      d.style.backgroundSize = '100% 100%';
      d.style.backgroundPosition = 'center';
      d.style.backgroundRepeat = 'no-repeat';
      mirror.nextBoxEl.appendChild(d);
    });
  }
}
function showMirrorChainToast(mirror, n) {
  if (!n || n < 2) return;
  mirror.chainToastEl.textContent = `${n} れんさ!!`;
  mirror.chainToastEl.classList.remove('show');
  void mirror.chainToastEl.offsetWidth;
  mirror.chainToastEl.classList.add('show');
}
let lastMirrorChain = 0;
function onNetSnapshot(payload) {
  if (!opponentMirror || !payload) return;
  renderMirrorGrid(opponentMirror, payload.grid);
  renderMirrorNext(opponentMirror, payload.next);
  opponentMirror.scoreEl.textContent = payload.score;
  opponentMirror.levelEl.textContent = payload.level;
  opponentMirror.garbageEl.textContent = payload.incoming;
  if (payload.chain && payload.chain !== lastMirrorChain) {
    showMirrorChainToast(opponentMirror, payload.chain);
  }
  lastMirrorChain = payload.chain || 0;
}

// ----------------------------------------------------------
// 勝敗判定
// ----------------------------------------------------------
function handleLocalGameOver() {
  if (matchOver) return;
  matchOver = true;
  mySide.gameOver = true;
  if (roomChannel) {
    roomChannel.send({ type: 'broadcast', event: 'gameover', payload: { loser: myClientId, ts: Date.now() } });
  }
  finishMatch(false);
}
function onNetGameOver(payload) {
  if (matchOver || !payload || payload.loser === myClientId) return;
  matchOver = true;
  finishMatch(true);
}
function finishMatch(playerWon) {
  stopSnapshotLoop();
  const titleEl = document.getElementById('result-title');
  titleEl.textContent = playerWon ? 'WIN!' : 'LOSE...';
  titleEl.className = playerWon ? 'win' : 'lose';
  document.getElementById('result-overlay').classList.add('show');
}

// ----------------------------------------------------------
// ネットワーク: ルーム接続(ルームコード方式・ランダムマッチング共通)
// ----------------------------------------------------------
let roomChannel = null;
let matchStarted = false;
let matchOver = false;
let opponentNickname = '対戦相手';
let myNickname = '';
let mySide = null;
let opponentMirror = null;
let matchStartTime = 0;
let loopStarted = false;
let snapshotTimer = null;

function connectToRoom(roomCode) {
  matchStarted = false;
  matchOver = false;
  const channelName = ROOM_CHANNEL_PREFIX + roomCode;

  roomChannel = supabaseClient.channel(channelName, {
    config: { broadcast: { self: false }, presence: { key: myClientId } },
  });

  roomChannel.on('broadcast', { event: 'start' }, ({ payload }) => {
    if (matchStarted) return;
    matchStarted = true;
    opponentNickname = (payload && payload.nickname) || '対戦相手';
    beginMatchFlow();
  });
  roomChannel.on('broadcast', { event: 'garbage' }, ({ payload }) => onNetGarbage(payload));
  roomChannel.on('broadcast', { event: 'snapshot' }, ({ payload }) => onNetSnapshot(payload));
  roomChannel.on('broadcast', { event: 'gameover' }, ({ payload }) => onNetGameOver(payload));

  roomChannel.on('presence', { event: 'sync' }, () => tryStartAsInitiator());
  roomChannel.on('presence', { event: 'leave' }, () => {
    if (matchStarted && !matchOver) {
      matchOver = true;
      stopSnapshotLoop();
      document.getElementById('disconnect-overlay').classList.add('show');
    }
  });

  roomChannel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await roomChannel.track({ clientId: myClientId, nickname: myNickname, joinedAt: Date.now() });
    }
  });
}

function tryStartAsInitiator() {
  if (matchStarted || !roomChannel) return;
  const state = roomChannel.presenceState();
  const ids = Object.keys(state).sort();
  if (ids.length < 2) return;
  const iAmInitiator = ids[0] === myClientId;
  if (!iAmInitiator) return;

  matchStarted = true;
  const otherKey = ids.find((id) => id !== myClientId);
  const otherMeta = state[otherKey] && state[otherKey][0];
  opponentNickname = (otherMeta && otherMeta.nickname) || '対戦相手';

  roomChannel.send({ type: 'broadcast', event: 'start', payload: { nickname: myNickname } });
  beginMatchFlow();
}

function disconnectRoom() {
  matchStarted = false;
  if (roomChannel && supabaseClient) {
    supabaseClient.removeChannel(roomChannel);
  }
  roomChannel = null;
}

// ----------------------------------------------------------
// ランダムマッチング(Supabase RPC をポーリング)
// ----------------------------------------------------------
let randomPollTimer = null;
let randomPollCancelled = true;
let randomWaitStartedAt = 0;
let randomWaitDisplayTimer = null;

function updateRandomWaitTimer() {
  const el = document.getElementById('random-wait-timer');
  const sec = Math.floor((Date.now() - randomWaitStartedAt) / 1000);
  el.textContent = `経過時間: ${sec}秒`;
}
function startRandomMatching() {
  randomPollCancelled = false;
  randomWaitStartedAt = Date.now();
  updateRandomWaitTimer();
  randomWaitDisplayTimer = setInterval(updateRandomWaitTimer, 1000);
  pollRandomMatch();
}
async function pollRandomMatch() {
  if (randomPollCancelled) return;
  try {
    const { data, error } = await supabaseClient.rpc('find_or_create_match', {
      p_client_id: myClientId,
      p_nickname: myNickname,
    });
    if (randomPollCancelled) return;
    if (error) {
      console.error(error);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.matched && row.room_code) {
        clearInterval(randomWaitDisplayTimer);
        connectToRoom(row.room_code);
        return;
      }
    }
  } catch (e) {
    console.error(e);
  }
  randomPollTimer = setTimeout(pollRandomMatch, RANDOM_POLL_INTERVAL_MS);
}
function cancelRandomMatching() {
  randomPollCancelled = true;
  if (randomPollTimer) clearTimeout(randomPollTimer);
  if (randomWaitDisplayTimer) clearInterval(randomWaitDisplayTimer);
  if (supabaseClient) {
    supabaseClient.rpc('leave_matchmaking', { p_client_id: myClientId }).catch(() => {});
  }
}

// ----------------------------------------------------------
// 対戦成立 → カウントダウン → 開始
// ----------------------------------------------------------
function beginMatchFlow() {
  document.getElementById('opponent-label').textContent = opponentNickname;
  showLobbyScreen('screen-matched');
  document.getElementById('matched-opponent-name').textContent = `vs ${opponentNickname}`;
  setTimeout(() => {
    document.getElementById('lobby-overlay').style.display = 'none';
    startCountdownThenMatch();
  }, 900);
}

function prepareBoards() {
  document.getElementById('result-overlay').classList.remove('show');
  document.getElementById('disconnect-overlay').classList.remove('show');
  matchTimerEl.textContent = '0:00';
  matchStartTime = 0;
  lastMirrorChain = 0;
  mySide = createLocalSide();
  opponentMirror = createOpponentMirror();
  renderSide(mySide);
}

function startCountdownThenMatch() {
  titleBgm.pause();
  prepareBoards();

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
      beginGameplay();
      activeBgm = gameBgm;
      gameBgm.currentTime = 0;
      playBgm(gameBgm);
      updateSoundIcon();
    }
  }, 1000);
}

function beginGameplay() {
  matchOver = false;
  matchStartTime = Date.now();
  mySide.current = spawnPiece(mySide);
  renderSide(mySide);
  startSnapshotLoop();
  if (!loopStarted) { loopStarted = true; requestAnimationFrame(loop); }
}

// ----------------------------------------------------------
// スナップショット送信(相手に自分の盤面を伝える)
// ----------------------------------------------------------
function startSnapshotLoop() {
  stopSnapshotLoop();
  snapshotTimer = setInterval(() => {
    if (!roomChannel || matchOver || !mySide) return;
    const gridStr = encodeDisplayGrid(mySide);
    const next = mySide.queue[0];
    roomChannel.send({
      type: 'broadcast',
      event: 'snapshot',
      payload: {
        grid: gridStr,
        next: next ? [next.axisColor, next.subColor] : null,
        score: mySide.score,
        level: mySide.level,
        incoming: Math.ceil(mySide.incoming),
        chain: mySide.chainCount > 1 ? mySide.chainCount : 0,
      },
    });
  }, SNAPSHOT_INTERVAL_MS);
}
function stopSnapshotLoop() {
  if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
}

// ----------------------------------------------------------
// メインループ(自分側のみ物理演算する。相手側はスナップショット反映のみ)
// ----------------------------------------------------------
let lastTime = 0;
function updateMySide(dt) {
  const side = mySide;
  if (!side || side.gameOver || !side.current) return;
  side.fallTimer += dt;
  const interval = side.softDropping ? FALL_INTERVAL_SOFT : getFallInterval(side.level);
  if (side.fallTimer >= interval) { side.fallTimer = 0; stepFall(); }
}
function loop(time) {
  if (!lastTime) lastTime = time;
  const dt = time - lastTime;
  lastTime = time;
  if (mySide && !matchOver) {
    updateMySide(dt);
    if (matchStartTime) {
      matchTimerEl.textContent = formatDuration(Math.floor((Date.now() - matchStartTime) / 1000));
    }
  }
  requestAnimationFrame(loop);
}

// ----------------------------------------------------------
// BGM
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
// ロビーUI
// ----------------------------------------------------------
const lobbyOverlay = document.getElementById('lobby-overlay');
function showLobbyScreen(id) {
  document.querySelectorAll('.lobby-screen').forEach((el) => el.classList.toggle('active', el.id === id));
}

document.querySelectorAll('.lobby-back-btn[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => {
    cancelRandomMatching();
    disconnectRoom();
    showLobbyScreen(btn.dataset.back);
  });
});

const nicknameInput = document.getElementById('nickname-input');
try {
  const saved = window.localStorage.getItem('kumacchi-nickname');
  if (saved) nicknameInput.value = saved;
} catch (e) { /* localStorageが使えない環境では無視 */ }

function getNickname() {
  const v = nicknameInput.value.trim().slice(0, 10);
  return v || 'ゲスト';
}
function persistNickname(name) {
  try { window.localStorage.setItem('kumacchi-nickname', name); } catch (e) { /* 無視 */ }
}

function requireSupabase() {
  if (!supabaseClient) {
    alert('オンライン対戦はまだ準備中です。src/js/supabase-config.js の設定を確認してください。');
    return false;
  }
  return true;
}

document.getElementById('btn-random-match').addEventListener('click', () => {
  if (!requireSupabase()) return;
  myNickname = getNickname();
  persistNickname(myNickname);
  showLobbyScreen('screen-random-wait');
  startRandomMatching();
});
document.getElementById('btn-cancel-random').addEventListener('click', () => {
  cancelRandomMatching();
  showLobbyScreen('screen-mode');
});

document.getElementById('btn-room-mode').addEventListener('click', () => {
  myNickname = getNickname();
  persistNickname(myNickname);
  showLobbyScreen('screen-room-choice');
});

document.getElementById('btn-room-create').addEventListener('click', () => {
  if (!requireSupabase()) return;
  const code = makeRoomCode();
  document.getElementById('room-code-display').textContent = code;
  showLobbyScreen('screen-room-host');
  connectToRoom(code);
});
document.getElementById('btn-cancel-host').addEventListener('click', () => {
  disconnectRoom();
  showLobbyScreen('screen-room-choice');
});
document.getElementById('btn-copy-code').addEventListener('click', () => {
  const code = document.getElementById('room-code-display').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {});
});

document.getElementById('btn-room-join').addEventListener('click', () => {
  showLobbyScreen('screen-room-join');
  document.getElementById('join-code-input').value = '';
  document.getElementById('join-error').textContent = '';
});
document.getElementById('btn-join-submit').addEventListener('click', () => {
  if (!requireSupabase()) return;
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (!code) { document.getElementById('join-error').textContent = 'コードを入力してください'; return; }
  document.getElementById('join-error').textContent = '';
  document.getElementById('room-code-display').textContent = code;
  showLobbyScreen('screen-room-host');
  connectToRoom(code);
});

document.getElementById('result-lobby-btn').addEventListener('click', () => {
  disconnectRoom();
  document.getElementById('result-overlay').classList.remove('show');
  lobbyOverlay.style.display = '';
  showLobbyScreen('screen-mode');
  activeBgm = titleBgm;
  gameBgm.pause();
  playBgm(titleBgm);
});
document.getElementById('result-title-btn').addEventListener('click', () => {
  disconnectRoom();
  window.location.href = 'index.html';
});
document.getElementById('disconnect-back-btn').addEventListener('click', () => {
  document.getElementById('disconnect-overlay').classList.remove('show');
  disconnectRoom();
  lobbyOverlay.style.display = '';
  showLobbyScreen('screen-mode');
  activeBgm = titleBgm;
  gameBgm.pause();
  playBgm(titleBgm);
});

window.addEventListener('beforeunload', () => {
  if (supabaseClient) {
    try { supabaseClient.rpc('leave_matchmaking', { p_client_id: myClientId }); } catch (e) { /* 無視 */ }
  }
});

// ----------------------------------------------------------
// 入力: キーボード(自分側のみ操作可能)
// ----------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (!mySide || mySide.gameOver || matchOver || !matchStarted) return;
  switch (e.key) {
    case 'ArrowLeft': tryMove(-1); break;
    case 'ArrowRight': tryMove(1); break;
    case 'ArrowUp': case 'x': case 'X': tryRotate('cw'); break;
    case 'z': case 'Z': tryRotate('ccw'); break;
    case 'ArrowDown': mySide.softDropping = true; break;
  }
});
document.addEventListener('keyup', (e) => {
  if (mySide && e.key === 'ArrowDown') mySide.softDropping = false;
});

// タッチ操作パッド(スマホ用)
function bindTouchButton(id, onPress, onRelease) {
  const el = document.getElementById(id);
  if (!el) return;
  const canAct = () => mySide && !mySide.gameOver && !matchOver && matchStarted;
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
bindTouchButton('touch-left', () => tryMove(-1));
bindTouchButton('touch-right', () => tryMove(1));
bindTouchButton('touch-up', () => tryRotate('cw'));
bindTouchButton('touch-rotate-l', () => tryRotate('ccw'));
bindTouchButton('touch-rotate-r', () => tryRotate('cw'));
bindTouchButton('touch-down', () => { mySide.softDropping = true; }, () => { if (mySide) mySide.softDropping = false; });
