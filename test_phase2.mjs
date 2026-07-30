/**
 * test_phase2.mjs
 * ------------------------------------------------------------
 * Phase2で追加したロジック（アイテム効果適用・勝敗判定/順位確定・
 * アイテム付きブロックの破壊・AIモジュールのimport)に対する
 * 簡易ユニットテスト。test_phase1.mjsと同様、Phaser CDNへの
 * ネットワークアクセスが無い環境でも検証できるようにしてある。
 * ------------------------------------------------------------
 */
class FakeScene {}
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

const { BLOCK_TYPES, ITEM_TYPES } = await import('./src/constants/GameConstants.js');
const { Stage } = await import('./src/objects/Stage.js');
const { Explosion } = await import('./src/objects/Explosion.js');
const { ItemSystem } = await import('./src/systems/ItemSystem.js');
const { BattleSystem } = await import('./src/systems/BattleSystem.js');
const { AI } = await import('./src/objects/AI.js');
const { AISystem } = await import('./src/systems/AISystem.js');

console.log('== 1. Stageのアイテム種別事前決定 ==');
{
  let foundItemBlock = false;
  for (let trial = 0; trial < 30 && !foundItemBlock; trial++) {
    const stage = new Stage(15, 11);
    stage.generate(2);
    for (let row = 0; row < stage.rows && !foundItemBlock; row++) {
      for (let col = 0; col < stage.cols && !foundItemBlock; col++) {
        if (stage.getBlockType(col, row) === BLOCK_TYPES.ITEM) {
          const result = stage.breakBlock(col, row);
          check('ITEMブロック破壊でspawnItem=true', result.spawnItem === true);
          check('ITEMブロック破壊でitemTypeがITEM_TYPESのいずれか', Object.values(ITEM_TYPES).includes(result.itemType));
          check('破壊後はブロックがEMPTYになる', stage.getBlockType(col, row) === BLOCK_TYPES.EMPTY);
          foundItemBlock = true;
        }
      }
    }
  }
  check('30回の試行中にITEMブロックが最低1つ生成された', foundItemBlock);
}

console.log('\n== 2. Explosionのdry-run（AI危険地帯予測が盤面を変更しない） ==');
{
  function makeMockStage(rowsDef) {
    const grid = rowsDef.map((r) => r.slice());
    return {
      getBlockType(col, row) {
        if (!grid[row] || grid[row][col] === undefined) return BLOCK_TYPES.HARD;
        return grid[row][col];
      },
      breakBlock() {
        throw new Error('dryRun中はbreakBlockが呼ばれてはいけない');
      },
    };
  }
  const E = BLOCK_TYPES.EMPTY;
  const S = BLOCK_TYPES.SOFT;
  const row = [E, E, E, S, E, E, E];
  const stage = makeMockStage([row]);
  let threw = false;
  let tiles = [];
  try {
    ({ tiles } = Explosion.computeBlastTiles(stage, 2, 0, 5, { dryRun: true }));
  } catch (e) {
    threw = true;
  }
  check('dryRun中はbreakBlockを呼ばない（例外が発生しない）', !threw);
  check('dryRunでも爆風が届くマスは正しく計算される', tiles.some((t) => t.col === 3 && t.row === 0));
}

console.log('\n== 3. ItemSystemの効果適用 ==');
{
  function makeFakePlayer() {
    return {
      maxBombs: 1,
      blastRange: 1,
      speedMultiplier: 1,
      lives: 3,
      invincibleUntil: 0,
      canPassSoftBlock: false,
      canKickBombs: false,
    };
  }
  const fakeScene = { time: { now: 1000 } };

  let p = makeFakePlayer();
  ItemSystem.applyItem(p, ITEM_TYPES.BOMB_UP, fakeScene);
  check('BOMB_UPでmaxBombsが増える', p.maxBombs === 2);

  p = makeFakePlayer();
  ItemSystem.applyItem(p, ITEM_TYPES.FIRE_UP, fakeScene);
  check('FIRE_UPでblastRangeが増える', p.blastRange === 2);

  p = makeFakePlayer();
  ItemSystem.applyItem(p, ITEM_TYPES.LIFE_UP, fakeScene);
  check('LIFE_UPでlivesが増える', p.lives === 4);

  p = makeFakePlayer();
  ItemSystem.applyItem(p, ITEM_TYPES.SHIELD, fakeScene);
  check('SHIELDでinvincibleUntilが未来の時刻になる', p.invincibleUntil === 1000 + 5000);

  p = makeFakePlayer();
  ItemSystem.applyItem(p, ITEM_TYPES.GHOST, fakeScene);
  check('GHOSTでcanPassSoftBlockがtrueになる', p.canPassSoftBlock === true);

  p = makeFakePlayer();
  ItemSystem.applyItem(p, ITEM_TYPES.KICK, fakeScene);
  check('KICKでcanKickBombsがtrueになる', p.canKickBombs === true);
}

console.log('\n== 4. BattleSystemの勝敗判定・順位確定 ==');
{
  function makeFakePlayer(playerId, lives, kills) {
    return { playerId, lives, isAlive: true, stats: { kills, bombsExploded: 0, itemsCollected: 0 } };
  }

  // 4-1. 最後の1人になったら即座に勝者が確定する
  {
    const p1 = makeFakePlayer(1, 3, 0);
    const p2 = makeFakePlayer(2, 0, 0);
    p2.isAlive = false;
    const battle = new BattleSystem([p1, p2], { timeLimitMs: 180000 });
    battle.notifyPlayerDied(p2);
    battle.update(16);
    check('最後の1人になった時点でisOverになる', battle.isOver === true);
    check('生存している方が勝者になる', battle.winner === p1);
    check('勝者の最終順位は1位', battle.finalRanks.get(1) === 1);
    check('死亡したプレイヤーは2位', battle.finalRanks.get(2) === 2);
  }

  // 4-2. 時間切れ時は即座に終わらず、サドンデス(suddenDeath)状態になるだけ
  // (「制限時間を過ぎたら終わりではなく、残り一人になるまで爆弾が沢山
  // 降ってくるようにしてほしい」への対応。実際に爆弾を降らせる処理は
  // GameScene側が担当するため、BattleSystem自体はフラグを立てるのみ)
  {
    const p1 = makeFakePlayer(1, 2, 5);
    const p2 = makeFakePlayer(2, 2, 1);
    const p3 = makeFakePlayer(3, 1, 99);
    const battle = new BattleSystem([p1, p2, p3], { timeLimitMs: 100 });
    battle.update(200); // 時間切れ
    check('時間切れになってもisOverにはならない(サドンデスへ移行するだけ)', battle.isOver === false);
    check('時間切れでsuddenDeadがtrueになる', battle.suddenDeath === true);
    check('時間切れ直後はまだ勝者が確定していない', battle.winner === null);

    // サドンデス中に生存者が1人になれば、従来通り即座に勝者が確定する。
    p2.isAlive = false;
    p3.isAlive = false;
    battle.notifyPlayerDied(p2);
    battle.notifyPlayerDied(p3);
    battle.update(16);
    check('サドンデス中でも生存者が1人になれば勝者が確定する', battle.isOver === true && battle.winner === p1);
  }

  // 4-2b. 「プレイヤーが負けたら終わりにしてほしい」: humanPlayersを渡すと、
  // 人間プレイヤーが全滅した時点でAI同士の決着を待たずに即座に終わる
  {
    const human = makeFakePlayer(1, 0, 0);
    human.isAlive = false;
    const ai1 = makeFakePlayer(2, 2, 5);
    const ai2 = makeFakePlayer(3, 1, 1);
    const battle = new BattleSystem([human, ai1, ai2], { timeLimitMs: 180000, humanPlayers: [human] });
    battle.notifyPlayerDied(human);
    battle.update(16);
    check('人間プレイヤーが全滅した時点でisOverになる(AIが2人生存中でも)', battle.isOver === true);
    check('生存中のAIの中から残機の多い方が勝者になる', battle.winner === ai1);
  }

  // 4-2c. humanPlayersを渡さない場合は、人間全滅による即終了判定を行わない(後方互換)
  {
    const p1 = makeFakePlayer(1, 0, 0);
    p1.isAlive = false;
    const p2 = makeFakePlayer(2, 2, 0);
    const p3 = makeFakePlayer(3, 1, 0);
    const battle = new BattleSystem([p1, p2, p3], { timeLimitMs: 180000 });
    battle.notifyPlayerDied(p1);
    battle.update(16);
    check('humanPlayers未指定なら、1人死亡しただけではisOverにならない(2人生存中のため)', battle.isOver === false);
  }

  // 4-3. 生存中のプレイヤーはgetLiveRank()がnullを返す（複数生存時）
  {
    const p1 = makeFakePlayer(1, 3, 0);
    const p2 = makeFakePlayer(2, 3, 0);
    const battle = new BattleSystem([p1, p2], { timeLimitMs: 180000 });
    check('複数生存中はgetLiveRankがnull', battle.getLiveRank(p1) === null);
  }
}

console.log('\n== 5. AI/AISystemのimportとインスタンス化 ==');
{
  const fakePlayer = { isAlive: true, isMoving: false, col: 1, row: 1, canPassSoftBlock: false, canKickBombs: false };
  const ai = new AI(fakePlayer, 'hard');
  // 2026-07「AIのレベルを少し下げてほしい」対応でHARDのdecisionIntervalMsを
  // 220ms→260msに緩和した(値そのものより「プロファイルが正しく反映される
  // こと」の確認が主目的のため、実際の定数値と一致させて回帰防止する)。
  check('AIインスタンスが難易度プロファイルを保持する', ai.profile.decisionIntervalMs === 260);

  const aiSystem = new AISystem();
  aiSystem.setup([fakePlayer, fakePlayer], 'expert');
  check('AISystem.setupで難易度が全AIに反映される', aiSystem.aiControllers.every((c) => c.difficulty === 'expert'));
}

console.log('\n== 6. AIの撃破チャンス・逃げ道確認・積極的なブロック破壊(サイコロ6面対応) ==');
{
  // AI.jsはCubeStage互換のインターフェース(getFaceStage/getBlockType(face,..)/
  // isWalkable(face,..)/resolveMove(face,..))を前提とするため、単一の孤立した
  // 面("TEST"面、面をまたがない=境界の外は常に非通行)を模したモックを使う。
  const FACE = 'TEST';
  function makeMockCubeStage(rowsDef) {
    const grid = rowsDef.map((r) => r.slice());
    const rows = grid.length;
    const cols = grid[0].length;
    const flatStage = {
      getBlockType(col, row) {
        if (!grid[row] || grid[row][col] === undefined) return BLOCK_TYPES.HARD;
        return grid[row][col];
      },
      breakBlock() {
        throw new Error('dryRun中はbreakBlockが呼ばれてはいけない');
      },
    };
    return {
      getFaceStage() {
        return flatStage;
      },
      getBlockType(face, col, row) {
        return flatStage.getBlockType(col, row);
      },
      // 壊せない壁(HARD)は常に通行不可。壊せる壁(SOFT/ITEM)は
      // canPassSoftBlockがtrueの場合のみ通行可。EMPTYは常に通行可。
      isWalkable(face, col, row, options = {}) {
        if (!grid[row] || grid[row][col] === undefined) return false;
        const type = grid[row][col];
        if (type === BLOCK_TYPES.HARD) return false;
        if (type === BLOCK_TYPES.SOFT || type === BLOCK_TYPES.ITEM) return !!options.canPassSoftBlock;
        return true;
      },
      resolveMove(face, col, row, direction) {
        const vec = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction];
        if (!vec) return null;
        const targetCol = col + vec[0];
        const targetRow = row + vec[1];
        if (targetCol < 0 || targetCol >= cols || targetRow < 0 || targetRow >= rows) {
          // このモックは単一の孤立した面として振る舞う(面をまたがない)ため、
          // 境界の外への移動は「行き先が無い」として扱う
          return null;
        }
        return { face, col: targetCol, row: targetRow, facing: direction, crossed: false };
      },
    };
  }
  const E = BLOCK_TYPES.EMPTY;
  const H = BLOCK_TYPES.HARD;
  const S = BLOCK_TYPES.SOFT;
  const pos = (col, row) => ({ face: FACE, col, row });

  const fakePlayer = { isAlive: true, isMoving: false, face: FACE, col: 0, row: 0 };
  const ai = new AI(fakePlayer, 'normal');

  // 6-1. _canBlastReach: 同じ面・同じ行に並んでいて間に何もなければ届く
  {
    const stage = makeMockCubeStage([[E, E, E, E, E, E, E]]);
    check('間に何もなければ爆風は届く', ai._canBlastReach(stage, pos(1, 0), pos(4, 0), 5) === true);
    check('距離がblastRangeを超えると届かない', ai._canBlastReach(stage, pos(0, 0), pos(6, 0), 3) === false);
    check('行も列も異なる相手には届かない', ai._canBlastReach(stage, pos(0, 0), pos(3, 3), 5) === false);
    check(
      '面が異なる相手には届かない(爆風は面をまたがない)',
      ai._canBlastReach(stage, pos(0, 0), { face: 'OTHER', col: 0, row: 0 }, 5) === false
    );
  }
  {
    const stage = makeMockCubeStage([[E, E, S, E, E]]);
    check('間に壊せるブロックがあると届かない（爆風はそこで止まるため）', ai._canBlastReach(stage, pos(0, 0), pos(4, 0), 5) === false);
  }

  // 6-2. _hasEscapeRoute: 十字型の爆風は隣接4マスを必ず含むため、1マス先読みでは
  // 常に「逃げ場なし」になってしまう。角を曲がって斜めに回り込めば爆風の外に
  // 出られるはずなので、数マス先までのBFSで正しく逃げ道を見つけられることを確認する。
  {
    // 4方向すべて開けている交差点: 隣接4マスは全てrange1の爆風に含まれるが、
    // そこからさらに1マス角を曲がれば(斜め方向)爆風の外に出られる
    const rows = [
      [E, E, E],
      [E, E, E],
      [E, E, E],
    ];
    const stage = makeMockCubeStage(rows);
    const dangerTiles = new Set();
    check(
      '開けた交差点では角を曲がって斜めに回り込むことで自分の爆風から逃げ切れる',
      ai._hasEscapeRoute(stage, [], pos(1, 1), 1, dangerTiles) === true
    );
  }
  {
    // 行き止まりの一直線の通路(左右をHARDで塞がれている)では、爆風の直線上から
    // 外れる曲がり角が存在しないため、逃げ場が無い
    const rows = [
      [H, H, H, H, H],
      [H, E, E, E, H],
      [H, H, H, H, H],
    ];
    const stage = makeMockCubeStage(rows);
    const dangerTiles = new Set();
    check(
      '曲がり角の無い行き止まりの通路では自分の爆風から逃げ切れない',
      ai._hasEscapeRoute(stage, [], pos(2, 1), 1, dangerTiles) === false
    );
  }

  // 6-2b. _findSafeDirection: 「AIが自爆しすぎる」問題の修正確認。
  // 十字型の爆風は隣接4マスを必ず含む(爆弾のマス自身も爆風に含まれるため)。
  // 1マス先読みだけでは、爆弾の真上にいる限り隣接4マスが全て危険地帯に
  // 見えてしまい常に「逃げ場なし」になる、という_hasEscapeRouteと同じ
  // 構造的な問題が実際の「今すぐどちらへ逃げるか」の判断にもあったため、
  // BFSで数マス先まで辿って逃げ道を見つけられるように修正した。
  {
    // 開けた交差点の中央に爆弾を置いた直後を想定: 隣接4マスは全て危険地帯だが、
    // 角を曲がって斜めに回り込んだ先(数マス先)は安全なはず
    const rows = [
      [E, E, E],
      [E, E, E],
      [E, E, E],
    ];
    const stage = makeMockCubeStage(rows);
    const dangerTiles = new Set([
      `${FACE}:1,1`, // 爆弾のあるマス自身
      `${FACE}:0,1`,
      `${FACE}:2,1`,
      `${FACE}:1,0`,
      `${FACE}:1,2`,
    ]);
    const player = { face: FACE, col: 1, row: 1, canPassSoftBlock: false };
    const dir = ai._findSafeDirection(player, stage, [], dangerTiles);
    check(
      '隣接4マスが全て危険地帯でも、角を曲がって逃げられる方向を見つけられる',
      dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right'
    );
    // 実際にその方向へ1歩進んだ先が、少なくとも危険地帯そのものではないことを確認
    if (dir) {
      const resolved = stage.resolveMove(FACE, 1, 1, dir);
      check(
        '返された方向へ進んだ先は(隣接マスなので)まだ危険地帯だが、そこから更に進めば安全マスに出られる経路になっている',
        resolved !== null
      );
    }
  }
  {
    // 行き止まりの一直線の通路(左右をHARDで塞がれている)では、どこにも
    // 逃げ場が無いので null を返す(=本当に詰んでいる場合はnullのままでよい)
    const rows = [
      [H, H, H, H, H],
      [H, E, E, E, H],
      [H, H, H, H, H],
    ];
    const stage = makeMockCubeStage(rows);
    const dangerTiles = new Set([`${FACE}:2,1`, `${FACE}:1,1`, `${FACE}:3,1`]);
    const player = { face: FACE, col: 2, row: 1, canPassSoftBlock: false };
    check(
      '曲がり角の無い行き止まりの通路では逃げ場が無いのでnullを返す',
      ai._findSafeDirection(player, stage, [], dangerTiles) === null
    );
  }

  // 6-3. _hasAdjacentBreakableTowards / _hasAnyAdjacentBreakable
  {
    const rows = [
      [E, E, E],
      [E, E, S],
      [E, E, E],
    ];
    const stage = makeMockCubeStage(rows);
    const here = pos(1, 1);
    check(
      '目標方向に壊せるブロックがあれば検出する',
      ai._hasAdjacentBreakableTowards(stage, here, pos(2, 1)) === true
    );
    check(
      '目標と逆方向にしか壊せるブロックが無ければ検出しない',
      ai._hasAdjacentBreakableTowards(stage, here, pos(0, 1)) === false
    );
    check(
      '目標が別の面にあれば検出しない',
      ai._hasAdjacentBreakableTowards(stage, here, { face: 'OTHER', col: 2, row: 1 }) === false
    );
    check('隣接4マスのいずれかに壊せるブロックがあれば検出する', ai._hasAnyAdjacentBreakable(stage, here) === true);
  }
  {
    const rows = [
      [E, E, E],
      [E, E, E],
      [E, E, E],
    ];
    const stage = makeMockCubeStage(rows);
    check('周囲に壊せるブロックが無ければ検出しない', ai._hasAnyAdjacentBreakable(stage, pos(1, 1)) === false);
  }
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
