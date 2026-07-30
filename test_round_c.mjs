/**
 * test_round_c.mjs
 * ------------------------------------------------------------
 * 2026-07ラウンド(右側HUDパネル/爆弾猶予1回/アイテムの死亡ドロップ/
 * アイテムの爆風破壊/歩いただけでの取得/👻半減/💥爆弾キック)で追加した
 * ロジックに対する簡易ユニットテスト。
 *
 * GameScene.js自体はPhaser Sceneのライフサイクル(add.text/tweens/camera/
 * input.keyboard等)に強く依存しており、ブラウザ/CDNアクセスの無い
 * このNode環境では実インスタンス化が現実的でないため、これまでの
 * ラウンドと同様に「Phaserに依存しない純粋ロジック部分」を直接検証する。
 * 加えて、GameScene内の一部メソッド(_tryKickBomb/_findNearbyEmptyTiles)は
 * アルゴリズムそのものをここに再実装し、実際のCubeStage/Stageインスタンス
 * に対して同じ性質(壁で止まる・占有マスは除外する等)が成り立つことを確認する
 * (このプロジェクトで確立された「Node上での純粋再実装による検証」方針を踏襲)。
 * ------------------------------------------------------------
 */
class FakeScene {
  constructor() {
    this.render3D = true;
    this.time = {
      now: 0,
      delayedCall: (_ms, _cb) => ({ remove: () => {} }),
    };
  }
}
globalThis.Phaser = {
  Scene: FakeScene,
  AUTO: 'AUTO',
  Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH', RESIZE: 'RESIZE' },
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

const { computeBattleLayout } = await import('./src/utils/ViewportLayout.js');
const {
  ITEM_SPAWN_WEIGHTS,
  ITEM_TYPES,
  HUD_PANEL_WIDTH,
  STAGE_VIEWPORT_MIN_WIDTH,
  MIN_HUD_PANEL_WIDTH,
  CUBE_FACE_NAMES,
} = await import('./src/constants/GameConstants.js');
const { Stage } = await import('./src/objects/Stage.js');
const { CubeStage } = await import('./src/objects/CubeStage.js');
const { Player } = await import('./src/objects/Player.js');
const { Bomb } = await import('./src/objects/Bomb.js');
const { Item } = await import('./src/objects/Item.js');

console.log('== 1. ViewportLayout.computeBattleLayout(画面上下をブラウザに合わせる+右側パネル) ==');
{
  const wide = computeBattleLayout(1600, 900);
  check('十分広い画面ではステージ幅がパネル分だけ狭くなる', wide.stageWidth === 1600 - HUD_PANEL_WIDTH);
  check('パネル幅は既定値と一致する', wide.panelWidth === HUD_PANEL_WIDTH);
  check('パネルはステージの右側(panelX===stageWidth)に配置される', wide.panelX === wide.stageWidth);
  check('画面の高さはそのままブラウザの高さになる(letterboxしない)', wide.totalHeight === 900);

  // 【2026-07追記】「スマホでもプレイできるように」への対応で、
  // computeBattleLayoutの優先順位を一部変更した。従来は「ステージの
  // 最低限の遊びやすさ(STAGE_VIEWPORT_MIN_WIDTH) > パネルの理想幅」
  // だったが、この優先順位を無条件に適用すると、スマホ等の非常に狭い
  // 画面(幅400px前後)ではパネル幅が実質0になり、プレイヤー情報が一切
  // 表示されなくなってしまう不具合があった。そのため、パネル幅は画面が
  // どれだけ狭くてもMIN_HUD_PANEL_WIDTH分だけは必ず確保するよう変更し、
  // 非常に狭い画面ではステージ幅がSTAGE_VIEWPORT_MIN_WIDTHを下回ることを
  // 許容するようにした(詳細はViewportLayout.computeBattleLayoutのコメント
  // 参照)。以下のテストはこの新しい優先順位を検証する。
  const narrow = computeBattleLayout(500, 700);
  check(
    '幅500pxのようなやや狭い画面では、パネルの最低幅は確保しつつステージ幅がSTAGE_VIEWPORT_MIN_WIDTHを下回ることがある',
    narrow.stageWidth < STAGE_VIEWPORT_MIN_WIDTH && narrow.stageWidth > 0
  );
  check('狭い画面ではパネル幅がHUD_PANEL_WIDTHより狭くなる', narrow.panelWidth < HUD_PANEL_WIDTH);
  check('stageWidth+panelWidthは常にtotalWidthに一致する', narrow.stageWidth + narrow.panelWidth === narrow.totalWidth);

  const phone = computeBattleLayout(390, 844); // スマホ縦持ちの典型的な幅
  check('スマホの典型的な幅(390px)でもパネル幅が0にならず、最低限プレイヤー情報を表示できる', phone.panelWidth >= MIN_HUD_PANEL_WIDTH);
  check('スマホの典型的な幅(390px)ではコンパクトパネル表示に切り替わる', phone.compactPanel === true);
  check('スマホの典型的な幅(390px)でもステージ幅は0や負数にならない', phone.stageWidth > 0);

  const wideCompact = computeBattleLayout(1600, 900);
  check('十分広い画面ではコンパクトパネル表示にならない', wideCompact.compactPanel === false);

  const zero = computeBattleLayout(0, 0);
  check('0x0のような不正サイズでも例外を投げず安全な最小値を返す', zero.totalWidth >= 1 && zero.totalHeight >= 1);
}

console.log('\n== 2. アイテム出現の重み付け(壁抜け👻の出現量を半分に) ==');
{
  // 「時限装置(⏱/TIMER)も強力な効果のため、GHOSTと同様に他の半分の重みに
  // した」(2026-07)ため、「半減されている特別枠」はGHOST/TIMERの2種類に
  // なった。他の"通常"タイプ(重み2)と比較する。
  const pool = Object.entries(ITEM_SPAWN_WEIGHTS).flatMap(([type, weight]) => Array(weight).fill(type));
  const halvedTypes = [ITEM_TYPES.GHOST, ITEM_TYPES.TIMER];
  const ghostWeight = ITEM_SPAWN_WEIGHTS[ITEM_TYPES.GHOST];
  const timerWeight = ITEM_SPAWN_WEIGHTS[ITEM_TYPES.TIMER];
  const otherWeights = Object.entries(ITEM_SPAWN_WEIGHTS)
    .filter(([type]) => !halvedTypes.includes(type))
    .map(([, w]) => w);
  check('👻(GHOST)の重みは他の"通常"タイプより小さい(半減)', otherWeights.every((w) => ghostWeight < w));
  check('👻(GHOST)の重みはちょうど他の"通常"タイプの半分', otherWeights.every((w) => ghostWeight === w / 2));
  check('⏱(TIMER)の重みも他の"通常"タイプより小さい(半減)', otherWeights.every((w) => timerWeight < w));
  check('⏱(TIMER)の重みもちょうど他の"通常"タイプの半分', otherWeights.every((w) => timerWeight === w / 2));

  // Stage.generate()を何度も回し、実際にITEMブロックとして出現した種別の頻度が
  // 重みの比率にだいたい従うことを統計的に確認する(乱数のため厳密一致はしない)。
  const counts = {};
  for (const type of Object.keys(ITEM_SPAWN_WEIGHTS)) counts[type] = 0;
  let totalItemBlocks = 0;
  for (let trial = 0; trial < 60; trial++) {
    const stage = new Stage(15, 11);
    stage.generate(2);
    for (const type of stage.itemTypeByTile.values()) {
      counts[type] = (counts[type] ?? 0) + 1;
      totalItemBlocks++;
    }
  }
  check('60回の試行で十分な数のアイテムブロックが生成された(統計に足る量)', totalItemBlocks > 100);
  const ghostRatio = counts[ITEM_TYPES.GHOST] / totalItemBlocks;
  const expectedRatio = ghostWeight / pool.length;
  check(
    `👻の実出現比率(${ghostRatio.toFixed(3)})が期待比率(${expectedRatio.toFixed(3)})の近く(±0.05)`,
    Math.abs(ghostRatio - expectedRatio) < 0.05
  );
}

console.log('\n== 3. 爆弾への1回だけの猶予(hasBombGrace)で即死しない ==');
{
  const cubeStage = new CubeStage();
  cubeStage.generate(1, 1);
  const scene = new FakeScene();
  const player = new Player(scene, cubeStage, CUBE_FACE_NAMES[0], 1, 1, { playerId: 1 });

  check('生成直後はhasBombGrace=true', player.hasBombGrace === true);
  const firstHitReducedLives = player.takeDamage();
  check('1回目の被弾は猶予で無効化され、ライフは減らない(戻り値false)', firstHitReducedLives === false);
  check('1回目の被弾後、猶予は消費されてfalseになる', player.hasBombGrace === false);
  check('1回目の被弾ではライフは変化しない', player.lives === 3);

  // 猶予消費時に付与される短時間無敵(1500ms)が終わるまで待ってから2発目を当てる
  scene.time.now += 2000;
  const secondHitReducedLives = player.takeDamage();
  check('2回目の被弾では通常通りライフが減る(戻り値true)', secondHitReducedLives === true);
  check('2回目の被弾でライフが実際に1減る', player.lives === 2);
}

console.log('\n== 4. 死亡時のアイテムドロップ用の所持履歴(collectedItemTypes) ==');
{
  const cubeStage = new CubeStage();
  cubeStage.generate(1, 1);
  const scene = new FakeScene();
  const player = new Player(scene, cubeStage, CUBE_FACE_NAMES[0], 1, 1, { playerId: 2 });
  check('初期状態はcollectedItemTypesが空配列', Array.isArray(player.collectedItemTypes) && player.collectedItemTypes.length === 0);
  player.collectedItemTypes.push(ITEM_TYPES.BOMB_UP, ITEM_TYPES.GHOST);
  check('取得したアイテム種別が履歴に積み上がる', player.collectedItemTypes.length === 2);
}

console.log('\n== 5. Bomb.slideTo/getMoveProgress(💥キックのスライド演出用) ==');
{
  const scene = new FakeScene();
  const face = CUBE_FACE_NAMES[0];
  let detonated = false;
  const bomb = new Bomb(scene, face, 2, 2, { onDetonate: () => { detonated = true; } });
  check('生成直後はスライド中ではない(getMoveProgress===1)', bomb.getMoveProgress(0) === 1);

  scene.time.now = 1000;
  bomb.slideTo(4, 2, scene.time.now, 2);
  check('slideTo直後、論理位置(col/row)は即座に移動先になる', bomb.col === 4 && bomb.row === 2);
  check('slideTo直後、見た目補間の起点(_prevCol/_prevRow)は元の位置のまま', bomb._prevCol === 2 && bomb._prevRow === 2);
  check('スライド開始直後はgetMoveProgressが0に近い', bomb.getMoveProgress(scene.time.now) === 0);
  const midProgress = bomb.getMoveProgress(scene.time.now + bomb._moveDurationMs / 2);
  check('スライド中間地点ではgetMoveProgressが0と1の間', midProgress > 0 && midProgress < 1);
  check('スライド完了後はgetMoveProgressが1で頭打ちになる', bomb.getMoveProgress(scene.time.now + 99999) === 1);
  check('まだ自動起爆(detonate)はしていない', detonated === false);
}

console.log('\n== 6. 爆弾キックのタイル送り(壁・他の爆弾・プレイヤーで止まる) ==');
{
  // GameScene._tryKickBombと同じアルゴリズムをここで再実装し、実際の
  // CubeStage(Stage)インスタンスに対して壁/占有マスで正しく停止することを
  // 確認する(GameScene自体はPhaser Scene依存が重くNode単体では組み立てにくいため)。
  const DIRECTION_VECTORS = { up: { dCol: 0, dRow: -1 }, down: { dCol: 0, dRow: 1 }, left: { dCol: -1, dRow: 0 }, right: { dCol: 1, dRow: 0 } };
  function tryKickBomb(stage, bomb, direction, occupiedTiles) {
    const vec = DIRECTION_VECTORS[direction];
    let col = bomb.col;
    let row = bomb.row;
    let moved = 0;
    let guard = 0;
    while (guard < 64) {
      guard++;
      const nCol = col + vec.dCol;
      const nRow = row + vec.dRow;
      if (!stage.canPlaceBombAt(bomb.face, nCol, nRow)) break;
      if (occupiedTiles.has(`${nCol},${nRow}`)) break;
      col = nCol;
      row = nRow;
      moved++;
    }
    return { col, row, moved };
  }

  const cubeStage = new CubeStage();
  cubeStage.generate(1, 1);
  const face = CUBE_FACE_NAMES[0];
  // 面の内側を意図的にすべて空にして検証しやすくする(生成マップの偶然性を排除)。
  const faceStage = cubeStage.getFaceStage(face);
  for (let row = 1; row < faceStage.rows - 1; row++) {
    for (let col = 1; col < faceStage.cols - 1; col++) {
      faceStage.setBlockType(col, row, 0); // BLOCK_TYPES.EMPTY === 0 を想定(下でimportして確認)
    }
  }
  const { BLOCK_TYPES } = await import('./src/constants/GameConstants.js');
  for (let row = 1; row < faceStage.rows - 1; row++) {
    for (let col = 1; col < faceStage.cols - 1; col++) {
      faceStage.setBlockType(col, row, BLOCK_TYPES.EMPTY);
    }
  }

  const bomb = { face, col: 2, row: 2 };
  const resultNoObstacle = tryKickBomb(cubeStage, bomb, 'right', new Set());
  check('障害物が無ければ複数マス滑る', resultNoObstacle.moved > 1);
  check('壁(外周HARD)の手前で止まる(面の右端を超えない)', resultNoObstacle.col <= faceStage.cols - 2);

  const resultBlockedByBomb = tryKickBomb(cubeStage, bomb, 'right', new Set([`${bomb.col + 1},${bomb.row}`]));
  check('隣がすでに爆弾で塞がっていれば1マスも動かせない', resultBlockedByBomb.moved === 0);

  const resultBlockedByPlayer = tryKickBomb(cubeStage, bomb, 'right', new Set([`${bomb.col + 2},${bomb.row}`]));
  check('2マス先がプレイヤーで塞がっていれば1マスだけ動く', resultBlockedByPlayer.moved === 1);
}

console.log('\n== 7. 死亡地点付近の空きマス探索(_findNearbyEmptyTilesと同じアルゴリズム) ==');
{
  const DIRECTION_VECTORS = { up: { dCol: 0, dRow: -1 }, down: { dCol: 0, dRow: 1 }, left: { dCol: -1, dRow: 0 }, right: { dCol: 1, dRow: 0 } };
  function findNearbyEmptyTiles(stage, face, originCol, originRow, count, isOccupied) {
    const results = [];
    if (count <= 0) return results;
    const visited = new Set([`${originCol},${originRow}`]);
    if (stage.canPlaceBombAt(face, originCol, originRow) && !isOccupied(originCol, originRow)) {
      results.push({ col: originCol, row: originRow });
    }
    let frontier = [{ col: originCol, row: originRow }];
    let guard = 0;
    while (frontier.length > 0 && results.length < count && guard < 2000) {
      const nextFrontier = [];
      for (const { col, row } of frontier) {
        for (const dir of Object.values(DIRECTION_VECTORS)) {
          const nCol = col + dir.dCol;
          const nRow = row + dir.dRow;
          const key = `${nCol},${nRow}`;
          if (visited.has(key)) continue;
          visited.add(key);
          guard++;
          if (!stage.canPlaceBombAt(face, nCol, nRow)) continue;
          if (results.length < count && !isOccupied(nCol, nRow)) results.push({ col: nCol, row: nRow });
          nextFrontier.push({ col: nCol, row: nRow });
        }
      }
      frontier = nextFrontier;
    }
    return results;
  }

  const cubeStage = new CubeStage();
  cubeStage.generate(1, 1);
  const face = CUBE_FACE_NAMES[0];
  const faceStage = cubeStage.getFaceStage(face);
  const { BLOCK_TYPES } = await import('./src/constants/GameConstants.js');
  for (let row = 1; row < faceStage.rows - 1; row++) {
    for (let col = 1; col < faceStage.cols - 1; col++) {
      faceStage.setBlockType(col, row, BLOCK_TYPES.EMPTY);
    }
  }

  const found = findNearbyEmptyTiles(cubeStage, face, 3, 3, 3, () => false);
  check('十分な空きマスがあれば要求数ぶん見つかる', found.length === 3);
  check('起点自体が空いていれば最優先で含まれる', found.some((t) => t.col === 3 && t.row === 3));

  const foundWithOccupied = findNearbyEmptyTiles(cubeStage, face, 3, 3, 2, (col, row) => col === 3 && row === 3);
  check('起点が占有されていれば起点以外から2つ見つかる', foundWithOccupied.length === 2 && !foundWithOccupied.some((t) => t.col === 3 && t.row === 3));

  faceStage.setBlockType(3, 3, BLOCK_TYPES.HARD);
  const foundBlockedOrigin = findNearbyEmptyTiles(cubeStage, face, 3, 3, 1, () => false);
  check('起点自体が壁になっていても周辺から見つかる', foundBlockedOrigin.length === 1 && !(foundBlockedOrigin[0].col === 3 && foundBlockedOrigin[0].row === 3));
}

console.log('\n== 8. アイテムは爆風の当たり判定と同じcol/row一致方式で破壊できる(Item生成の確認) ==');
{
  const scene = new FakeScene();
  const face = CUBE_FACE_NAMES[0];
  const item = new Item(scene, face, 5, 5, ITEM_TYPES.BOMB_UP);
  const tiles = [{ col: 5, row: 5 }, { col: 6, row: 5 }];
  const hit = tiles.some((t) => t.col === item.col && t.row === item.row);
  check('爆風タイル一覧に含まれるマスのアイテムは破壊対象と判定される', hit === true);
  check('render3Dモードではスプライトを生成しない(描画とロジックの分離)', item.sprite === undefined);
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
