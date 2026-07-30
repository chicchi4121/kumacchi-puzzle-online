/**
 * NetworkProtocol.js
 * ------------------------------------------------------------
 * オンライン対戦(Supabase Realtime)で送受信するメッセージの組み立て・
 * 解釈・状態同期の適用ロジックをまとめた「純粋関数」モジュール。
 *
 * 開発ルール9(描画とロジックの分離)の応用として、Supabase接続そのもの
 * (NetworkSystem.js)や実際のPhaser/Three.js描画とは完全に独立させてある。
 * そのため、このファイルの内容はNode上でCDN接続なしに全てユニット
 * テストできる(test_network.mjs参照)。このサンドボックス環境では
 * Supabase Realtimeへの実接続そのものは検証できないが、「何を・どんな
 * 形式で送るか/受け取った内容をどう状態に反映するか」は完全に検証済みの
 * ロジックとして提供できる。
 *
 * ---- アーキテクチャ(ホスト権威型) ----
 * 部屋を作った側(ホスト)だけがゲームロジック全体(マップ生成・AI・爆弾・
 * アイテム・勝敗判定)を実行する。参加した側(ゲスト)はホストから届く
 * 状態(state)・単発イベント(event)を自分の画面に反映するだけで、
 * 自分のキー入力はホストへ送信するのみ(ローカルでは移動処理を行わない)。
 * これにより、参加人数が増えても各クライアントのシミュレーションが
 * 食い違う「デシンク」が原理的に起こらない(ホストの1つの結果を全員が
 * ただ描画するだけのため)。
 * ------------------------------------------------------------
 */
import {
  CUBE_FACE_NAMES,
  BLOCK_TYPES,
  BLOCK_TYPE_CHAR,
  CHAR_BLOCK_TYPE,
  ROOM_CODE_LENGTH,
  ROOM_CODE_ALPHABET,
  NETWORK_STATE_BROADCAST_INTERVAL_MS,
} from '../constants/GameConstants.js';
import { random } from '../utils/Random.js';

// ---- 部屋コード ----------------------------------------------------------

/** 誤読しにくい文字だけを使った短い部屋コードを生成する(既定は完全ランダム) */
export function generateRoomCode(rng = random) {
  const alphabet = ROOM_CODE_ALPHABET.split('');
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += rng.pick(alphabet);
  }
  return code;
}

/** ユーザーが手入力するのでよくある表記ゆれ(小文字・全角・前後空白)を正規化する */
export function normalizeRoomCode(input) {
  return String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/[０-９Ａ-Ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)); // 全角->半角
}

// ---- マップ(CubeStage)のシリアライズ ---------------------------------------

/** 1面ぶんのStageをブロック種別1文字/マスの文字列にエンコードする */
export function encodeFaceGrid(stage) {
  let grid = '';
  for (let row = 0; row < stage.rows; row++) {
    for (let col = 0; col < stage.cols; col++) {
      grid += BLOCK_TYPE_CHAR[stage.getBlockType(col, row)] ?? BLOCK_TYPE_CHAR[BLOCK_TYPES.EMPTY];
    }
  }
  return { cols: stage.cols, rows: stage.rows, grid };
}

/** CubeStage全体(6面)をエンコードする(match_initメッセージの中身) */
export function encodeCubeStage(cubeStage) {
  const faces = {};
  for (const name of CUBE_FACE_NAMES) {
    faces[name] = encodeFaceGrid(cubeStage.getFaceStage(name));
  }
  return { faces, startPositions: cubeStage.getStartPositions() };
}

/**
 * エンコードされたマップから、CubeRenderer.init()が必要とする最小限の
 * インターフェース(getFaceStage(face).{cols,rows,getBlockType}) だけを
 * 備えた「見た目専用」のミラーステージを作る(ゲスト側で使用)。
 * ゲストは移動判定(isWalkable/resolveMove)を一切ローカルで行わない
 * (ホストが権威を持つため)ので、このミラーにはそれらのメソッドは無い。
 */
export function createMirrorStage(encoded) {
  const faces = {};
  for (const [name, faceData] of Object.entries(encoded?.faces ?? {})) {
    const { cols, rows, grid } = faceData;
    // 破壊済みマス(ホストからのexplosionイベントで随時追加)。gridの元の
    // 文字列は書き換えず、上書き分だけこのMapで管理する(col,row -> EMPTY)。
    const overrides = new Map();
    faces[name] = {
      cols,
      rows,
      overrides,
      getBlockType(col, row) {
        if (col < 0 || row < 0 || col >= cols || row >= rows) return BLOCK_TYPES.HARD;
        const idx = row * cols + col;
        if (overrides.has(idx)) return BLOCK_TYPES.EMPTY;
        const ch = grid[idx];
        return CHAR_BLOCK_TYPE[ch] ?? BLOCK_TYPES.EMPTY;
      },
    };
  }
  return {
    faces,
    getFaceStage(face) {
      return faces[face];
    },
    getStartPositions() {
      return encoded?.startPositions ?? [];
    },
    /** ホストからのexplosionイベントを受けて、破壊されたマスをEMPTY扱いにする */
    setBlockEmpty(face, col, row) {
      const faceData = faces[face];
      if (!faceData) return;
      faceData.overrides.set(row * faceData.cols + col, BLOCK_TYPES.EMPTY);
    },
  };
}

// ---- match_init (ホスト→全員、対戦開始時に1回) -----------------------------

/**
 * @param {CubeStage} cubeStage
 * @param {Array<Player>} players
 * @param {object} matchConfig - { aiDifficulty, timeLimitMs, humanCount, aiCount }
 */
export function buildMatchInitMessage(cubeStage, players, matchConfig) {
  return {
    type: 'match_init',
    stage: encodeCubeStage(cubeStage),
    roster: players.map((p) => ({
      playerId: p.playerId,
      colorIndex: p.colorIndex,
      isAI: p.isAI,
      face: p.face,
      col: p.col,
      row: p.row,
    })),
    config: { ...matchConfig },
  };
}

// ---- state (ホスト→全員、周期的なブロードキャスト) --------------------------

/** Playerの公開状態のうち、ネットワーク越しに送る必要がある最小限をシリアライズする */
export function serializePlayerState(player) {
  return {
    id: player.playerId,
    face: player.face,
    col: player.col,
    row: player.row,
    facing: player.facing,
    isAlive: player.isAlive,
    lives: player.lives,
    activeBombCount: player.activeBombCount,
    maxBombs: player.maxBombs,
    blastRange: player.blastRange,
    colorIndex: player.colorIndex,
    stats: {
      kills: player.stats?.kills ?? 0,
      bombsExploded: player.stats?.bombsExploded ?? 0,
      itemsCollected: player.stats?.itemsCollected ?? 0,
    },
  };
}

/**
 * 受信したplayer state(1人分)を、ゲスト側で保持しているPlayerインスタンス
 * (実際に描画に使う「ミラー」オブジェクト)へ反映する。
 *
 * 移動アニメーション(getMoveProgress)は_prevFace/_moveStartAt/
 * _moveDurationMsに依存するが、ホストとゲストの時計(scene.time.now)は
 * 同期していない(別々の端末)ため、ホストが記録したタイムスタンプを
 * そのまま使うと補間が破綻する(進捗が常に0または1に張り付く等)。
 * そのため、ここでは「位置が変わったこと」をゲスト自身が検知した瞬間の
 * ゲスト側の時計(nowMs)を基準にアニメーションを開始させることで、
 * ホスト側の時計に一切依存しない安定した補間にしている。
 *
 * @param {Player} mirrorPlayer - ゲスト側で保持するPlayerインスタンス(実際にtryMove等は呼ばない、状態のミラー用途)
 * @param {object} state - serializePlayerStateが作った1人分の状態
 * @param {number} nowMs - ゲスト側のscene.time.now
 */
export function applyPlayerState(mirrorPlayer, state, nowMs) {
  const moved =
    mirrorPlayer.face !== state.face || mirrorPlayer.col !== state.col || mirrorPlayer.row !== state.row;
  if (moved) {
    mirrorPlayer._prevFace = mirrorPlayer.face;
    mirrorPlayer._prevCol = mirrorPlayer.col;
    mirrorPlayer._prevRow = mirrorPlayer.row;
    mirrorPlayer._moveStartAt = nowMs;
    mirrorPlayer._moveDurationMs = NETWORK_STATE_BROADCAST_INTERVAL_MS;
    mirrorPlayer.isMoving = true;
  }
  mirrorPlayer.face = state.face;
  mirrorPlayer.col = state.col;
  mirrorPlayer.row = state.row;
  mirrorPlayer.facing = state.facing;
  mirrorPlayer.isAlive = state.isAlive;
  mirrorPlayer.lives = state.lives;
  mirrorPlayer.activeBombCount = state.activeBombCount;
  mirrorPlayer.maxBombs = state.maxBombs;
  mirrorPlayer.blastRange = state.blastRange;
  mirrorPlayer.colorIndex = state.colorIndex;
  mirrorPlayer.stats = { ...state.stats };
  return mirrorPlayer;
}

export function buildStateMessage(seq, elapsedMs, players, bombs, items, isOver, winnerId) {
  return {
    type: 'state',
    seq,
    elapsedMs,
    players: players.map(serializePlayerState),
    bombs: bombs.filter((b) => !b.detonated).map((b) => ({ id: b.id, face: b.face, col: b.col, row: b.row })),
    items: items.map((it) => ({ id: it.id, face: it.face, col: it.col, row: it.row, type: it.type })),
    isOver: !!isOver,
    winnerId: winnerId ?? null,
  };
}

/**
 * idベースの配列を比較し、新しく増えた要素・無くなった要素を求める
 * (bomb/itemの3Dメッシュ追加・削除にそのまま使う)。
 */
export function diffById(prevList, nextList) {
  const prevIds = new Set(prevList.map((e) => e.id));
  const nextIds = new Set(nextList.map((e) => e.id));
  return {
    added: nextList.filter((e) => !prevIds.has(e.id)),
    removed: prevList.filter((e) => !nextIds.has(e.id)),
  };
}

// ---- 単発イベント(ホスト→全員) ---------------------------------------------

export function buildExplosionEvent(bomb, tiles, broken, mirrorBroken = [], isChainReaction = false) {
  return {
    type: 'event',
    kind: 'explosion',
    bombId: bomb.id,
    face: bomb.face,
    tiles,
    broken,
    mirrorBroken,
    isChainReaction,
  };
}

export function buildItemPickupEvent(item, playerId) {
  return { type: 'event', kind: 'item_pickup', itemId: item.id, playerId };
}

export function buildResultEvent(winnerId, players, finalRanks) {
  return { type: 'event', kind: 'result', winnerId, players, finalRanks };
}

// ---- ゲスト→ホストの入力 ---------------------------------------------------

/** 現在押されている方向キーの状態から、Player.tryMove用の単一方向を1つ選ぶ(上>下>左>右の優先順位) */
export function pickDirectionFromKeys(keys) {
  if (keys?.up) return 'up';
  if (keys?.down) return 'down';
  if (keys?.left) return 'left';
  if (keys?.right) return 'right';
  return null;
}

export function buildMoveInputMessage(playerId, keys) {
  return {
    type: 'input',
    mode: 'move',
    playerId,
    up: !!keys?.up,
    down: !!keys?.down,
    left: !!keys?.left,
    right: !!keys?.right,
  };
}

export function buildBombInputMessage(playerId) {
  return { type: 'input', mode: 'bomb', playerId };
}

// ---- ホスト→全員: 対戦開始の合図(OnlineLobbyScene→GameScene) -----------------

/**
 * ホストが「対戦開始」を押した際、全員(自分含む)に送る合図。
 * @param {object} matchConfig - { humanCount, aiCount, aiDifficulty, timeLimitMs, clientToPlayerId }
 */
export function buildStartGameMessage(matchConfig) {
  return { type: 'start_game', ...matchConfig };
}

/** presenceState()の生データから、参加者一覧を参加順(joinedAt昇順)の配列にする */
export function presenceStateToParticipants(presenceState) {
  const participants = Object.values(presenceState ?? {})
    .map((entries) => entries?.[0])
    .filter(Boolean);
  participants.sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));
  return participants;
}

// ---- オートマッチング(OnlineLobbyScene.js) ---------------------------------
// 部屋コードのやり取りなしに他プレイヤーと自動的に組み合わせる機能。
// 固定の合言葉チャンネル(待合ロビー)にpresenceで参加した全員のうち、
// 参加が一番早い人(joinedAt昇順の先頭)が「リーダー」となって実際の対戦
// 部屋を作成し、matched対象のclientIdをbroadcastで伝える設計。

/**
 * 待合ロビーの参加者一覧(参加順)から、今回マッチさせるグループを決める。
 * 参加順の先頭からmaxPlayers人までを1グループとする(それ以降は次回に持ち越し)。
 * @param {Array<{clientId:string, joinedAt:number}>} participants - presenceStateToParticipants()の戻り値
 * @param {number} maxPlayers
 */
export function pickAutoMatchGroup(participants, maxPlayers) {
  return (participants ?? []).slice(0, Math.max(1, maxPlayers));
}

/**
 * 待合ロビーの参加者一覧の中で、自分(selfClientId)が今回のグループの
 * リーダー(実際の対戦部屋を作成する役)かどうかを判定する。
 * リーダーは常にグループの先頭(参加が一番早い人)。
 */
export function isAutoMatchLeader(participants, selfClientId, maxPlayers) {
  const group = pickAutoMatchGroup(participants, maxPlayers);
  return group.length > 0 && group[0]?.clientId === selfClientId;
}

/**
 * オートマッチングのリーダーが実際の対戦部屋を作成した後、待合ロビーの
 * 全員に「マッチが成立した」ことを伝えるメッセージ。matchedClientIdsに
 * 含まれるクライアントだけがこのroomCodeへ参加する(含まれない場合は
 * 次回のマッチングを待ち続ける)。
 * @param {string} roomCode - リーダーが新規作成した対戦部屋のコード
 * @param {Array<string>} matchedClientIds - 今回マッチしたクライアントのID一覧(先頭がホスト=リーダー自身)
 * @param {object} matchConfig - { humanCount, aiCount, aiDifficulty, timeLimitMs }
 */
export function buildAutoMatchFoundMessage(roomCode, matchedClientIds, matchConfig) {
  return { type: 'auto_match_found', roomCode, matchedClientIds: [...matchedClientIds], config: { ...matchConfig } };
}

/**
 * 参加者一覧(ホストが先頭に来るよう並べ替え済み)から、
 * clientId -> playerId(1始まり、参加順)のマッピングを作る。
 * GameScene._createPlayers()のplayerId割り当て(i+1、人間が先頭)と対応させる。
 */
export function buildClientToPlayerId(participants) {
  const ordered = [...participants].sort((a, b) => {
    if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
    return (a.joinedAt ?? 0) - (b.joinedAt ?? 0);
  });
  const map = {};
  ordered.forEach((p, index) => {
    map[p.clientId] = index + 1;
  });
  return map;
}
