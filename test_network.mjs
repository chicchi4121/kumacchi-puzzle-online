/**
 * test_network.mjs
 * ------------------------------------------------------------
 * オンライン対戦(Supabase Realtime)のうち、Phaser/Three.js/実際の
 * Supabase接続に依存しない「純粋ロジック」部分(NetworkProtocol.js)を
 * 検証する。
 *
 * このサンドボックス環境ではSupabase(CDN)への実接続を確認できないため、
 * 「何を・どんな形式で送るか」「受け取った内容をどう状態に反映するか」
 * だけを、実際のCubeStage/Player/Bombクラスを使ってNode上で検証する。
 * ------------------------------------------------------------
 */
class FakeScene {
  constructor() {
    this.time = { now: 0, delayedCall: () => {} };
  }
}
globalThis.Phaser = {
  Scene: FakeScene,
  AUTO: 'AUTO',
  Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
  Input: { Keyboard: { KeyCodes: { SPACE: 'SPACE', ESC: 'ESC' } } },
};

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) {
    pass++;
    console.log(`  OK  ${label}`);
  } else {
    fail++;
    console.log(`  NG  ${label}`);
  }
}

const { CubeStage } = await import('./src/objects/CubeStage.js');
const { Player } = await import('./src/objects/Player.js');
const { Random } = await import('./src/utils/Random.js');
const { CUBE_FACE_NAMES, BLOCK_TYPES, ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET } = await import(
  './src/constants/GameConstants.js'
);
const {
  generateRoomCode,
  normalizeRoomCode,
  encodeFaceGrid,
  encodeCubeStage,
  createMirrorStage,
  buildMatchInitMessage,
  serializePlayerState,
  applyPlayerState,
  buildStateMessage,
  diffById,
  buildExplosionEvent,
  buildItemPickupEvent,
  buildResultEvent,
  pickDirectionFromKeys,
  buildMoveInputMessage,
  buildBombInputMessage,
  presenceStateToParticipants,
  buildClientToPlayerId,
  pickAutoMatchGroup,
  isAutoMatchLeader,
  buildAutoMatchFoundMessage,
} = await import('./src/systems/NetworkProtocol.js');

console.log('== 1. 部屋コード生成 ==');
{
  const seeded = new Random(12345);
  const code = generateRoomCode(seeded);
  check('指定した長さで生成される', code.length === ROOM_CODE_LENGTH);
  check('許可された文字だけで構成される', [...code].every((c) => ROOM_CODE_ALPHABET.includes(c)));

  const codes = new Set();
  for (let i = 0; i < 200; i++) codes.add(generateRoomCode());
  check('大量生成してもほぼ衝突しない(200回で190種類以上)', codes.size >= 190);

  check('小文字・全角・前後空白を正規化できる', normalizeRoomCode('  ａb3ｄｅ ') === 'AB3DE');
}

console.log('\n== 2. マップ(CubeStage)のエンコード/ミラーステージ ==');
{
  const cubeStage = new CubeStage();
  cubeStage.generate(4, 1);

  const encoded = encodeCubeStage(cubeStage);
  check('6面すべてがエンコードされる', Object.keys(encoded.faces).length === CUBE_FACE_NAMES.length);

  let allMatch = true;
  for (const face of CUBE_FACE_NAMES) {
    const original = cubeStage.getFaceStage(face);
    const faceData = encoded.faces[face];
    check(`${face}: grid長がcols*rowsと一致する`, faceData.grid.length === faceData.cols * faceData.rows);
    for (let row = 0; row < original.rows && allMatch; row++) {
      for (let col = 0; col < original.cols && allMatch; col++) {
        if (original.getBlockType(col, row) !== undefined) {
          // (次のミラーステージ再現テストでまとめて突き合わせる)
        }
      }
    }
  }

  const mirror = createMirrorStage(encoded);
  let mirrorMatches = true;
  for (const face of CUBE_FACE_NAMES) {
    const original = cubeStage.getFaceStage(face);
    const mirrorFace = mirror.getFaceStage(face);
    for (let row = 0; row < original.rows; row++) {
      for (let col = 0; col < original.cols; col++) {
        if (original.getBlockType(col, row) !== mirrorFace.getBlockType(col, row)) mirrorMatches = false;
      }
    }
  }
  check('ミラーステージが元のCubeStageと全マス一致する(6面)', mirrorMatches);

  check(
    '範囲外はHARD扱いになる(境界チェック)',
    mirror.getFaceStage('FRONT').getBlockType(-1, 0) === BLOCK_TYPES.HARD &&
      mirror.getFaceStage('FRONT').getBlockType(999, 0) === BLOCK_TYPES.HARD
  );

  // 破壊イベント適用(setBlockEmpty)の検証: 元がSOFT/ITEMだったマスを壊すとEMPTYになる
  let softCell = null;
  const frontOriginal = cubeStage.getFaceStage('FRONT');
  outer: for (let row = 0; row < frontOriginal.rows; row++) {
    for (let col = 0; col < frontOriginal.cols; col++) {
      const t = frontOriginal.getBlockType(col, row);
      if (t === BLOCK_TYPES.SOFT || t === BLOCK_TYPES.ITEM) {
        softCell = { col, row };
        break outer;
      }
    }
  }
  if (softCell) {
    mirror.setBlockEmpty('FRONT', softCell.col, softCell.row);
    check(
      'setBlockEmptyで指定マスがEMPTY扱いになる',
      mirror.getFaceStage('FRONT').getBlockType(softCell.col, softCell.row) === BLOCK_TYPES.EMPTY
    );
  }

  const matchInit = buildMatchInitMessage(cubeStage, [], { aiDifficulty: 'normal', timeLimitMs: 180000 });
  check('match_initメッセージのtypeが正しい', matchInit.type === 'match_init');
  check('match_initにstartPositionsが含まれる', Array.isArray(matchInit.stage.startPositions));
}

console.log('\n== 3. Playerの状態シリアライズ/適用 ==');
{
  const scene = new FakeScene();
  const cubeStage = new CubeStage();
  cubeStage.generate(2, 1);

  const hostPlayer = new Player(scene, cubeStage, 'FRONT', 5, 5, { colorIndex: 0, isAI: false, playerId: 1 });
  hostPlayer.lives = 2;
  hostPlayer.stats.kills = 3;

  const state = serializePlayerState(hostPlayer);
  check('シリアライズ結果にidが含まれる(playerId)', state.id === 1);
  check('livesが正しくシリアライズされる', state.lives === 2);
  check('statsが正しくシリアライズされる', state.stats.kills === 3);

  // ゲスト側のミラーPlayer(実際にはtryMove等を呼ばない、状態を反映されるだけの側)
  const mirrorPlayer = new Player(scene, cubeStage, 'FRONT', 5, 5, { colorIndex: 0, isAI: false, playerId: 1 });
  const movedState = { ...state, face: 'FRONT', col: 6, row: 5, facing: 'right' };
  applyPlayerState(mirrorPlayer, movedState, 1000);

  check('位置が更新される', mirrorPlayer.col === 6 && mirrorPlayer.row === 5);
  check('移動検知でisMoving=trueになる', mirrorPlayer.isMoving === true);
  check('移動元(_prevCol)が更新前の位置になる', mirrorPlayer._prevCol === 5);
  check('ゲスト側の時計(nowMs)がmoveStartAtに使われる(ホストの時計に依存しない)', mirrorPlayer._moveStartAt === 1000);
  check('進捗計算(getMoveProgress)が0〜1の範囲で機能する', mirrorPlayer.getMoveProgress(1050) > 0 && mirrorPlayer.getMoveProgress(1050) < 1);
  check('十分時間が経てば進捗1(移動完了)になる', mirrorPlayer.getMoveProgress(999999) === 1);

  // 位置が変わらないstate適用では移動扱いにならない(isMovingがfalseに戻る想定)
  mirrorPlayer.isMoving = false;
  applyPlayerState(mirrorPlayer, movedState, 2000);
  check('位置が変化しない適用では新たな移動が始まらない', mirrorPlayer.isMoving === false);
}

console.log('\n== 4. state/eventメッセージの組み立てとidベース差分検出 ==');
{
  const scene = new FakeScene();
  const cubeStage = new CubeStage();
  cubeStage.generate(1, 1);
  const player = new Player(scene, cubeStage, 'FRONT', 5, 5, { colorIndex: 0, isAI: false, playerId: 1 });

  const bombs = [{ id: 1, detonated: false, face: 'FRONT', col: 5, row: 5 }];
  const items = [{ id: 10, face: 'FRONT', col: 3, row: 3, type: 'bomb_up' }];

  const msg = buildStateMessage(1, 1234, [player], bombs, items, false, null);
  check('stateメッセージのtypeが正しい', msg.type === 'state');
  check('検知済み爆弾(detonated=false)のみ含まれる', msg.bombs.length === 1 && msg.bombs[0].id === 1);
  check('アイテムがそのまま含まれる', msg.items.length === 1 && msg.items[0].type === 'bomb_up');

  const detonatedBombs = [{ id: 1, detonated: true, face: 'FRONT', col: 5, row: 5 }];
  const msg2 = buildStateMessage(2, 1300, [player], detonatedBombs, items, false, null);
  check('爆発済み(detonated=true)の爆弾はstateから除外される', msg2.bombs.length === 0);

  const prev = [{ id: 1 }, { id: 2 }];
  const next = [{ id: 2 }, { id: 3 }];
  const { added, removed } = diffById(prev, next);
  check('新規追加されたidを検出できる', added.length === 1 && added[0].id === 3);
  check('無くなったidを検出できる', removed.length === 1 && removed[0].id === 1);

  const explosionEvent = buildExplosionEvent({ id: 1, face: 'FRONT' }, [{ col: 5, row: 5 }], [], [], true);
  check('explosionイベントの種別が正しい', explosionEvent.type === 'event' && explosionEvent.kind === 'explosion');
  check('誘爆フラグが伝わる', explosionEvent.isChainReaction === true);

  const pickupEvent = buildItemPickupEvent({ id: 10 }, 1);
  check('item_pickupイベントの種別が正しい', pickupEvent.kind === 'item_pickup' && pickupEvent.playerId === 1);

  const resultEvent = buildResultEvent(1, [{ playerId: 1 }], { 1: 1 });
  check('resultイベントの種別が正しい', resultEvent.kind === 'result' && resultEvent.winnerId === 1);
}

console.log('\n== 5. ゲスト→ホストの入力メッセージ ==');
{
  check('上優先で方向を1つ選ぶ', pickDirectionFromKeys({ up: true, down: true, left: true, right: true }) === 'up');
  check('上が無ければ下を選ぶ', pickDirectionFromKeys({ up: false, down: true, left: true }) === 'down');
  check('何も押されていなければnull', pickDirectionFromKeys({ up: false, down: false, left: false, right: false }) === null);
  check('未定義のkeysでも例外を投げない', pickDirectionFromKeys(undefined) === null);

  const moveMsg = buildMoveInputMessage(3, { up: true, down: false, left: false, right: false });
  check('move入力メッセージの形式が正しい', moveMsg.type === 'input' && moveMsg.mode === 'move' && moveMsg.playerId === 3 && moveMsg.up === true);

  const bombMsg = buildBombInputMessage(3);
  check('bomb入力メッセージの形式が正しい', bombMsg.type === 'input' && bombMsg.mode === 'bomb' && bombMsg.playerId === 3);
}

console.log('\n== 6. オートマッチング ==');
{
  const participants = [
    { clientId: 'c_first', isHost: false, joinedAt: 100 },
    { clientId: 'c_second', isHost: false, joinedAt: 200 },
    { clientId: 'c_third', isHost: false, joinedAt: 300 },
  ];

  check('pickAutoMatchGroup: 定員内なら全員がグループに入る', pickAutoMatchGroup(participants, 6).length === 3);
  check(
    'pickAutoMatchGroup: 定員を超える分は次回に持ち越される(参加が早い順に切り詰め)',
    pickAutoMatchGroup(participants, 2).map((p) => p.clientId).join(',') === 'c_first,c_second'
  );
  check('pickAutoMatchGroup: 空配列を渡しても例外を投げない', pickAutoMatchGroup([], 6).length === 0);

  check('isAutoMatchLeader: 参加が一番早い人がリーダー', isAutoMatchLeader(participants, 'c_first', 6) === true);
  check('isAutoMatchLeader: リーダー以外はfalse', isAutoMatchLeader(participants, 'c_second', 6) === false);
  check(
    'isAutoMatchLeader: 定員2人グループでは3人目はリーダーになれない(次回のグループの先頭でも今回は対象外)',
    isAutoMatchLeader(participants, 'c_third', 2) === false
  );
  check('isAutoMatchLeader: 参加者0人ならfalse', isAutoMatchLeader([], 'c_first', 6) === false);

  const matchConfig = { humanCount: 3, aiCount: 1, aiDifficulty: 'normal', timeLimitMs: 180000 };
  const found = buildAutoMatchFoundMessage('ABCDE', ['c_first', 'c_second', 'c_third'], matchConfig);
  check('auto_match_foundメッセージの種別が正しい', found.type === 'auto_match_found');
  check('auto_match_foundに部屋コードが含まれる', found.roomCode === 'ABCDE');
  check(
    'auto_match_foundにマッチしたクライアントID一覧が含まれる',
    found.matchedClientIds.length === 3 && found.matchedClientIds[0] === 'c_first'
  );
  check('auto_match_foundにマッチ設定が含まれる', found.config.humanCount === 3 && found.config.aiCount === 1);

  // buildClientToPlayerId(既存関数)がオートマッチングのグループにもそのまま使えることを確認
  const group = pickAutoMatchGroup(participants, 6).map((p, i) => ({ ...p, isHost: i === 0 }));
  const clientToPlayerId = buildClientToPlayerId(group);
  check(
    'オートマッチングのグループでもリーダー(先頭)がplayerId=1になる',
    clientToPlayerId.c_first === 1 && clientToPlayerId.c_second === 2 && clientToPlayerId.c_third === 3
  );

  // presenceStateToParticipants(既存関数): Supabaseのpresence生データ形式からの変換も確認しておく
  const rawPresenceState = {
    keyA: [{ clientId: 'c_b', isHost: false, joinedAt: 500 }],
    keyB: [{ clientId: 'c_a', isHost: true, joinedAt: 100 }],
  };
  const converted = presenceStateToParticipants(rawPresenceState);
  check(
    'presenceStateToParticipants: joinedAt昇順に並ぶ',
    converted.length === 2 && converted[0].clientId === 'c_a' && converted[1].clientId === 'c_b'
  );
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
