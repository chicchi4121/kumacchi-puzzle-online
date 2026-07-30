/**
 * test_round_e.mjs
 * ------------------------------------------------------------
 * 「対戦開始押すとフリーズする」不具合の修正を検証する回帰テスト。
 *
 * 【原因】GameScene.create()(ローカル対戦・AI戦・オンライン対戦ホスト)と
 * GameScene._applyMatchInit()(オンライン対戦ゲスト)のいずれも、
 * this.battleSystemを生成するより前に_buildPlayerCards()を呼んでいた。
 * _buildPlayerCards()は内部で_updateHud() → _formatRemainingTime()を呼び、
 * this.battleSystem.timeLimitMsを参照するため、まだ存在しないthis.
 * battleSystemのプロパティを読もうとして対戦開始のたびに必ず例外
 * (TypeError: Cannot read properties of undefined)が発生し、GameScene.
 * create()が完了しないまま止まる(=操作不能になり「フリーズする」ように
 * 見える)不具合になっていた。
 *
 * 前回(test_round_d.mjs)の静的チェックはimportの消し忘れという別の
 * クラスの不具合を検知するものだったが、今回のような「メソッドの呼び出し
 * 順序」に起因する不具合は静的な走査だけでは検知できない。そこで本テストは
 * 実際にGameScene.create()/_applyMatchInit()を、ブラウザ/CDNに依存しない
 * 最小限の偽Phaser環境(fetch/documentも含めスタブ化)上で本当に実行し、
 * 例外を投げずに完了することを確認する、より実行時に近い検証にした。
 * ------------------------------------------------------------
 */
globalThis.window = globalThis;
globalThis.document = { getElementById: () => null }; // #cube-canvas無し環境として扱う(_initCubeRendererは早期return)
globalThis.fetch = async () => ({ ok: false, status: 0 }); // VRM読込は常に失敗させる(_loadAllVrmAppearances内でcatch済み)

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

function run(label, fn) {
  try {
    fn();
    check(label, true);
  } catch (e) {
    console.log(`      例外: ${e?.stack ?? e}`);
    check(label, false);
  }
}

console.log('== GameScene.create()/_applyMatchInit()が例外を投げずに完了すること ==');

run('mode: ai (ソロ+AI)でcreate()が完了し、this.battleSystemが用意される', () => {
  const scene = makeScene();
  scene.init({ mode: 'ai', playerCount: 1, aiCount: 2, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  scene.create();
  if (!scene.battleSystem) throw new Error('battleSystemが用意されていない');
});

run('mode: pvp (ローカル2人)でcreate()が完了する', () => {
  const scene = makeScene();
  scene.init({ mode: 'pvp', playerCount: 2, aiCount: 1, humanCount: 2, timeLimitMs: 120000, aiDifficulty: 'hard' });
  scene.create();
  if (!scene.battleSystem) throw new Error('battleSystemが用意されていない');
});

run('mode: online(ホスト)でcreate()が完了する', () => {
  const scene = makeScene();
  const fakeNetwork = { onMessage: () => () => {}, send: () => {}, clientId: 'c1' };
  scene.init({
    mode: 'online',
    playerCount: 2,
    aiCount: 1,
    humanCount: 2,
    timeLimitMs: 180000,
    aiDifficulty: 'normal',
    online: { network: fakeNetwork, role: 'host', roomCode: 'ABCDE', clientToPlayerId: { c1: 1, c2: 2 } },
  });
  scene.create();
  if (!scene.battleSystem) throw new Error('battleSystemが用意されていない');
});

run('mode: online(ゲスト)で_applyMatchInit()が完了する', () => {
  const scene = makeScene();
  const fakeNetwork = { onMessage: () => () => {}, send: () => {}, clientId: 'c2' };
  scene.init({
    mode: 'online',
    playerCount: 2,
    aiCount: 0,
    humanCount: 2,
    timeLimitMs: 180000,
    aiDifficulty: 'normal',
    online: { network: fakeNetwork, role: 'guest', roomCode: 'ABCDE' },
  });
  scene.create(); // _createGuestScene()経由(まだplayers等は未確定)
  scene._applyMatchInit({
    type: 'match_init',
    stage: { faces: {} }, // このテストではcreateMirrorStageの中身までは検証しない
    config: { aiDifficulty: 'normal', timeLimitMs: 180000, clientToPlayerId: { c1: 1, c2: 2 } },
    roster: [
      { playerId: 1, face: 'front', col: 1, row: 1, colorIndex: 0, isAI: false },
      { playerId: 2, face: 'front', col: 2, row: 1, colorIndex: 1, isAI: false },
    ],
  });
  if (!scene.battleSystem) throw new Error('battleSystemが用意されていない');
});

console.log('\n== _formatRemainingTime()がbattleSystem未生成時にも例外を投げない(念のための防御的ガード) ==');
{
  const scene = makeScene();
  scene.init({ mode: 'ai', playerCount: 1, aiCount: 1, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  // battleSystemを意図的に用意しない状態でHUD更新系メソッドを直接呼ぶ
  scene.players = [];
  let threw = false;
  let label = null;
  try {
    label = scene._formatRemainingTime();
  } catch {
    threw = true;
  }
  check('battleSystem未生成でも_formatRemainingTime()は例外を投げない', !threw);
  check('battleSystem未生成時は"-"を返す', label === '-');
}

console.log('\n== シーン終了時にthis.scale.onで登録したresizeリスナーが解除されること(リーク防止) ==');
{
  // 対戦を何度もリプレイした場合にリスナーが蓄積する軽微なリークが
  // あったため、shutdown時にscale.offで解除するよう修正した。on/offの
  // 呼び出しを記録する偽scaleで、登録数と解除数が一致することを確認する。
  const scene = makeScene();
  const registered = [];
  let shutdownCallback = null;
  scene.scale = {
    width: 1280,
    height: 800,
    on: (event, handler) => {
      if (event === 'resize') registered.push(handler);
    },
    off: (event, handler) => {
      if (event === 'resize') {
        const idx = registered.indexOf(handler);
        if (idx !== -1) registered.splice(idx, 1);
      }
    },
  };
  scene.events = {
    once: (event, cb) => {
      if (event === 'shutdown') shutdownCallback = cb;
    },
  };
  scene.init({ mode: 'ai', playerCount: 1, aiCount: 1, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  scene.create();
  check('create()完了時点でresizeリスナーが登録されている', registered.length > 0);
  shutdownCallback?.();
  check('shutdownイベント発火後、登録したresizeリスナーが全て解除されている', registered.length === 0);
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
