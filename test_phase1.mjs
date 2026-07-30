/**
 * test_phase1.mjs
 * ------------------------------------------------------------
 * Phase1のコアロジックに対する簡易ユニットテスト。
 * サンドボックス環境からPhaser CDN(cdnjs)へのネットワークアクセスが
 * 遮断されているため実ブラウザでの起動確認ができない代わりに、
 * ・全モジュールが構文/参照エラーなくimportできること
 * ・Phaser非依存の純粋ロジック(Stage生成・爆風伝播・乱数)が
 *   仕様通りに動作すること
 * をNode上で検証する。ユーザー環境（通常のインターネット接続がある
 * ブラウザ）ではindex.htmlからCDN経由でPhaserを読み込んで動作する。
 * ------------------------------------------------------------
 */

// ---- Phaser未実行環境でもシーンクラスをimportできるよう最小限のスタブを用意 ----
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

console.log('== 1. 全モジュールのimport確認 ==');
const modules = [
  './src/constants/GameConstants.js',
  './src/utils/Random.js',
  './src/utils/Collision.js',
  './src/utils/Save.js',
  './src/objects/Stage.js',
  './src/objects/Block.js',
  './src/objects/Player.js',
  './src/objects/Bomb.js',
  './src/objects/Explosion.js',
  './src/objects/Item.js',
  './src/objects/AI.js',
  './src/systems/BattleSystem.js',
  './src/systems/ItemSystem.js',
  './src/systems/AISystem.js',
  './src/systems/RankingSystem.js',
  './src/systems/VRMSystem.js',
  './src/systems/SkillSystem.js',
  './src/systems/NetworkSystem.js',
  './src/systems/NetworkProtocol.js',
  './src/systems/SupabaseClient.js',
  './src/config/supabaseConfig.js',
  './src/scenes/TitleScene.js',
  './src/scenes/LobbyScene.js',
  './src/scenes/OnlineLobbyScene.js',
  './src/scenes/RankingScene.js',
  './src/scenes/GameScene.js',
  './src/scenes/ResultScene.js',
  './src/scenes/PauseScene.js',
];

for (const path of modules) {
  try {
    await import(path);
    check(`import成功: ${path}`, true);
  } catch (e) {
    check(`import成功: ${path} -> ${e.message}`, false);
  }
}

console.log('\n== 2. Stage生成ロジック ==');
const { Stage } = await import('./src/objects/Stage.js');
const { BLOCK_TYPES } = await import('./src/constants/GameConstants.js');

for (let trial = 0; trial < 20; trial++) {
  const stage = new Stage(15, 11);
  stage.generate(4);
  const grid = stage.grid;

  // 「端も全て他のマスと一緒にして」への対応の検証: 外周を特別扱いせず、
  // 柱(col・rowが共に偶数のマスのみ)だけがHARDになり、それ以外(外周も
  // 含め)は柱にならない。
  let pillarRuleOk = true;
  for (let r = 0; r < 11; r++) {
    for (let c = 0; c < 15; c++) {
      const shouldBePillar = c % 2 === 0 && r % 2 === 0;
      const isHard = grid[r][c] === BLOCK_TYPES.HARD;
      if (shouldBePillar !== isHard) pillarRuleOk = false;
    }
  }
  if (trial === 0) check('柱(col・rowが共に偶数のマスのみ)だけがHARDになる(外周も同じルールに従う)', pillarRuleOk);

  // 「壊せないブロックは前後左右斜めも1マス空けないと移動できない」への
  // 対応の検証: どの柱も、隣接する8マス(前後左右斜め)のいずれにも別の柱が
  // 存在しない(=必ず1マス以上の隙間がある)。
  let gapOk = true;
  for (let r = 0; r < 11; r++) {
    for (let c = 0; c < 15; c++) {
      if (!(c % 2 === 0 && r % 2 === 0)) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= 11 || nc < 0 || nc >= 15) continue;
          if (nc % 2 === 0 && nr % 2 === 0) gapOk = false;
        }
      }
    }
  }
  if (trial === 0) check('柱同士は前後左右斜め(8方向)いずれにも隣接しない(必ず1マス以上の隙間がある)', gapOk);

  // 各プレイヤー開始地点は必ず通行可能（安全地帯）
  let startOk = true;
  for (const pos of stage.getStartPositions()) {
    if (!stage.isWalkable(pos.col, pos.row)) startOk = false;
  }
  if (trial === 0) check('プレイヤー開始地点は通行可能', startOk);
  if (!startOk) fail++, console.log('  NG  (試行', trial, ')開始地点が塞がれています');
}

console.log('\n== 2b. 壊せない壁は通行不可・壊せる壁は通り抜けアイテム取得後のみ通行可 ==');
{
  const stage = new Stage(15, 11);
  stage.generate(2);

  // 内部の柱(偶数列・偶数行、境界を除く)は必ずHARDのはず
  const pillarCol = 2;
  const pillarRow = 2;
  check('内部の柱はHARDブロックである', stage.getBlockType(pillarCol, pillarRow) === BLOCK_TYPES.HARD);
  check('HARDブロックは通行不可(通り抜けアイテムがあっても不可)', stage.isWalkable(pillarCol, pillarRow, { canPassSoftBlock: true }) === false);
  check('HARDブロックの上には爆弾を設置できない', stage.canPlaceBombAt(pillarCol, pillarRow) === false);

  // SOFT/ITEMブロックを探して同様に検証する
  let foundBreakable = false;
  for (let row = 0; row < stage.rows && !foundBreakable; row++) {
    for (let col = 0; col < stage.cols && !foundBreakable; col++) {
      const type = stage.getBlockType(col, row);
      if (type === BLOCK_TYPES.SOFT || type === BLOCK_TYPES.ITEM) {
        check('壊せるブロックは通り抜けアイテム未取得だと通行不可', stage.isWalkable(col, row) === false);
        check('壊せるブロックは通り抜けアイテム未取得だと通行不可(明示的にfalse指定)', stage.isWalkable(col, row, { canPassSoftBlock: false }) === false);
        check('壊せるブロックは通り抜けアイテム取得済みなら通行可', stage.isWalkable(col, row, { canPassSoftBlock: true }) === true);
        check('壊せるブロックの上には爆弾を設置できない(取得済みでも)', stage.canPlaceBombAt(col, row) === false);
        foundBreakable = true;
      }
    }
  }
  check('検証用の壊せるブロックが見つかった', foundBreakable);

  // EMPTYマスには通常通り爆弾を設置できる
  const [startPos] = stage.getStartPositions();
  check('EMPTYマス(開始地点)には爆弾を設置できる', stage.canPlaceBombAt(startPos.col, startPos.row) === true);
  check('EMPTYマスは誰でも通行可能', stage.isWalkable(startPos.col, startPos.row) === true);

  // マップ範囲外は通行不可
  check('マップ範囲外は通行不可', stage.isWalkable(-1, 0) === false);
}

console.log('\n== 3. 爆風伝播ロジック(Explosion) ==');
const { Explosion } = await import('./src/objects/Explosion.js');

// テスト用の疑似Stage（getBlockType/breakBlockのみ実装）
function makeMockStage(rowsDef) {
  const grid = rowsDef.map((row) => row.slice());
  return {
    grid,
    getBlockType(col, row) {
      if (!grid[row] || grid[row][col] === undefined) return BLOCK_TYPES.HARD;
      return grid[row][col];
    },
    breakBlock(col, row) {
      const type = grid[row][col];
      if (type !== BLOCK_TYPES.SOFT && type !== BLOCK_TYPES.ITEM) {
        return { destroyed: false, spawnItem: false };
      }
      const spawnItem = type === BLOCK_TYPES.ITEM;
      grid[row][col] = BLOCK_TYPES.EMPTY;
      return { destroyed: true, spawnItem };
    },
  };
}

{
  // 横一列: 中央から右へHARDブロックがあるパターン -> 壁で停止することを確認
  const E = BLOCK_TYPES.EMPTY;
  const H = BLOCK_TYPES.HARD;
  const S = BLOCK_TYPES.SOFT;
  const row = [E, E, E, H, E, E, E];
  const { tiles } = Explosion.computeBlastTiles(makeMockStage([row]), 2, 0, 5);
  const rightTiles = tiles.filter((t) => t.row === 0 && t.col > 2).map((t) => t.col);
  check('爆風は壁(HARD)の手前で停止する', JSON.stringify(rightTiles.sort()) === JSON.stringify([]));
}

{
  // 壊せるブロックにぶつかったら、そのマスまで届いて破壊され、そこで止まる
  const E = BLOCK_TYPES.EMPTY;
  const S = BLOCK_TYPES.SOFT;
  const row = [E, E, E, S, E, E, E];
  const stage = makeMockStage([row]);
  const { tiles, broken } = Explosion.computeBlastTiles(stage, 2, 0, 5);
  const rightTiles = tiles.filter((t) => t.row === 0 && t.col > 2).map((t) => t.col);
  check('爆風は壊せるブロックのマスまで届く', rightTiles.includes(3));
  check('壊せるブロックの先へは伝播しない', !rightTiles.includes(4));
  check('壊せるブロックがbrokenリストに含まれる', broken.some((b) => b.col === 3 && b.row === 0));
  check('破壊後はEMPTYになる', stage.getBlockType(3, 0) === BLOCK_TYPES.EMPTY);
}

{
  // 爆風範囲(range)を超えた先には届かない
  const E = BLOCK_TYPES.EMPTY;
  const row = [E, E, E, E, E, E, E];
  const { tiles } = Explosion.computeBlastTiles(makeMockStage([row]), 3, 0, 2);
  const rightTiles = tiles.filter((t) => t.row === 0 && t.col > 3).map((t) => t.col).sort();
  check('爆風範囲(range)を超えては届かない', JSON.stringify(rightTiles) === JSON.stringify([4, 5]));
}

console.log('\n== 4. Random ==');
const { Random } = await import('./src/utils/Random.js');
{
  const r = new Random(12345);
  let allInRange = true;
  for (let i = 0; i < 1000; i++) {
    const v = r.nextInt(0, 10);
    if (v < 0 || v >= 10) allInRange = false;
  }
  check('nextInt(0,10)は常に0〜9の範囲', allInRange);

  const r1 = new Random(999);
  const r2 = new Random(999);
  const seq1 = Array.from({ length: 5 }, () => r1.nextInt(0, 100));
  const seq2 = Array.from({ length: 5 }, () => r2.nextInt(0, 100));
  check('同じシードなら再現可能な乱数列になる', JSON.stringify(seq1) === JSON.stringify(seq2));
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
