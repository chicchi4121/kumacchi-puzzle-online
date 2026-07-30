/**
 * test_round_f.mjs
 * ------------------------------------------------------------
 * 「アイテムが全然でなくなった。もっとでるようにしてほしい。」への対応を
 * 検証する回帰テスト。
 *
 * 【原因】GameScene._onBombDetonate()内で、「爆風が届いたマスに既に
 * 置かれていたアイテムを破壊する」処理(itemsDestroyedByBlast)が、
 * 「破壊されたブロックからアイテムを出現させる」処理(forループ)より
 * *後*に実行されていた。そのため、ITEMブロックを壊して新しくアイテムが
 * 出現しても、そのアイテムは同じ爆風の範囲内(tiles)に存在するため、
 * 直後のitemsDestroyedByBlastの判定に引っかかって即座に破壊されてしまい、
 * プレイヤーの目には「アイテムがほとんど出現しない」ように見えていた
 * (同じ面の爆風で直接壊したITEMブロックのアイテムは実質必ず消えており、
 * 隣接面へのミラー破壊で出現したアイテムだけがまれに残っていた)。
 *
 * 該当コード上部のコメントには「新しく出現したアイテムを巻き込んで壊さない
 * よう、ブロック破壊ループの前にスナップショットを取る必要がある」と
 * 明記されていたにも関わらず、実際のコードはループの後に置かれており、
 * コメントと実装が矛盾した状態になっていた(実装忘れの回帰不具合)。
 *
 * 【修正】itemsDestroyedByBlastのスナップショット・破壊処理を、
 * ブロック破壊ループ(新規アイテム出現処理を含む)より前に移動した。
 *
 * 本テストは、実際のStage/CubeStage/Explosion/Itemクラスを使い、
 * GameScene._onBombDetonate相当のロジックをブラウザ非依存の最小限の
 * 偽Phaser環境上で直接実行して検証する(test_round_eで確立した「実際に
 * 実行して確認する」方針を踏襲)。
 * ------------------------------------------------------------
 */
import fs from 'fs';

globalThis.window = globalThis;
globalThis.document = { getElementById: () => null };
globalThis.fetch = async () => ({ ok: false, status: 0 });

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

class FakeTextObj {
  setOrigin() { return this; }
  setDepth() { return this; }
  setText() { return this; }
  setColor() { return this; }
  setPosition() { return this; }
  setStyle() { return this; }
  setAlpha() { return this; }
  setStrokeStyle() { return this; }
  setFillStyle() { return this; }
  setSize() { return this; }
  setDisplaySize() { return this; }
  setInteractive() { return this; }
  on() { return this; }
  destroy() {}
  get fillColor() { return 0; }
}
class FakeContainer extends FakeTextObj {
  constructor() { super(); this.children = []; }
  add(items) { this.children.push(...(Array.isArray(items) ? items : [items])); return this; }
  removeAll() { this.children = []; }
}
class FakeScene {}
globalThis.Phaser = {
  Scene: FakeScene,
  AUTO: 'AUTO',
  Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH', RESIZE: 'RESIZE' },
  Input: { Keyboard: { KeyCodes: new Proxy({}, { get: (_t, p) => String(p) }) } },
};

const { GameScene } = await import('./src/scenes/GameScene.js');
const { CubeStage } = await import('./src/objects/CubeStage.js');
const { Bomb } = await import('./src/objects/Bomb.js');
const { BLOCK_TYPES, ITEM_TYPES } = await import('./src/constants/GameConstants.js');

function makeScene() {
  const scene = new GameScene();
  scene.scale = { width: 1280, height: 800, on: () => {}, off: () => {} };
  scene.add = {
    text: () => new FakeTextObj(),
    container: (x, y) => {
      const c = new FakeContainer();
      c._x = x;
      c._y = y;
      return c;
    },
    rectangle: () => new FakeTextObj(),
    circle: () => new FakeTextObj(),
    image: () => new FakeTextObj(),
  };
  scene.time = {
    now: 0,
    delayedCall: () => ({ remove() {} }),
    addEvent: () => ({ remove() {} }),
  };
  scene.input = { keyboard: { addKey: () => ({ on() {}, isDown: false }) } };
  scene.textures = { exists: () => false, remove() {}, addCanvas() {} };
  scene.events = { once() {} };
  scene.tweens = { add() {} };
  return scene;
}

console.log('== 1. _onBombDetonate(): 同じ爆風で壊したITEMブロックから出現したアイテムが即座に破壊されない ==');
{
  const scene = makeScene();
  scene.init({ mode: 'ai', playerCount: 1, aiCount: 1, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  scene.create();

  // create()が生成したcubeStage/players等をそのまま使いつつ、盤面だけ
  // このテスト用に確定的に作り直す(爆弾の起点=(5,5)、右隣(6,5)にITEM
  // ブロックを配置し、爆風range=3で確実に届くようにする)。
  const face = 'FRONT';
  const stage = scene.stage.getFaceStage(face);
  // 爆風が届く範囲を全てEMPTYにリセットしてから、狙った位置だけITEMにする
  for (let r = 3; r <= 7; r++) {
    for (let c = 3; c <= 7; c++) {
      stage.setBlockType(c, r, BLOCK_TYPES.EMPTY);
    }
  }
  stage.setBlockType(6, 5, BLOCK_TYPES.ITEM);
  stage.itemTypeByTile.set('6,5', ITEM_TYPES.BOMB_UP);

  scene.items = [];
  scene.bombs = [];
  scene.cubeRenderer = null; // ?.呼び出しなので無視される

  const bomb = new Bomb(scene, face, 5, 5, { ownerId: scene.players[0]?.playerId ?? 1, blastRange: 3 });
  scene._onBombDetonate(bomb);

  const spawnedItem = scene.items.find((it) => it.face === face && it.col === 6 && it.row === 5);
  check('ITEMブロックを壊した位置に新しいItemインスタンスが生成されている', !!spawnedItem);
  check('新しく出現したアイテムがthis.itemsに残っている(即座に破壊されていない)', scene.items.includes(spawnedItem));
}

console.log('\n== 2. _onBombDetonate(): 爆風発生前から既に置かれていたアイテムは従来通り破壊される ==');
{
  const scene = makeScene();
  scene.init({ mode: 'ai', playerCount: 1, aiCount: 1, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  scene.create();

  const face = 'FRONT';
  const stage = scene.stage.getFaceStage(face);
  for (let r = 3; r <= 7; r++) {
    for (let c = 3; c <= 7; c++) {
      stage.setBlockType(c, r, BLOCK_TYPES.EMPTY);
    }
  }

  const { Item } = await import('./src/objects/Item.js');
  const preExistingItem = new Item(scene, face, 6, 5, ITEM_TYPES.GHOST); // 起点(5,5)から爆風range3内
  scene.items = [preExistingItem];
  scene.bombs = [];
  scene.cubeRenderer = null;

  const bomb = new Bomb(scene, face, 5, 5, { ownerId: scene.players[0]?.playerId ?? 1, blastRange: 3 });
  scene._onBombDetonate(bomb);

  check('爆発前から存在したアイテムは爆風で破壊されthis.itemsから消える', !scene.items.includes(preExistingItem));
}

console.log('\n== 3. ソースコード上の静的確認(itemsDestroyedByBlastがブロック破壊ループより前にあること) ==');
{
  const src = fs.readFileSync('src/scenes/GameScene.js', 'utf8');
  const idxSnapshot = src.indexOf('const itemsDestroyedByBlast');
  const idxBrokenLoop = src.indexOf('for (const b of broken)');
  check('itemsDestroyedByBlastのスナップショット処理が存在する', idxSnapshot !== -1);
  check('for (const b of broken)ループが存在する', idxBrokenLoop !== -1);
  check('itemsDestroyedByBlastの処理がブロック破壊ループより前に書かれている(順序の回帰防止)', idxSnapshot !== -1 && idxBrokenLoop !== -1 && idxSnapshot < idxBrokenLoop);
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
