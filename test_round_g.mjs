/**
 * test_round_g.mjs
 * ------------------------------------------------------------
 * 「オートマッチングで探してる相手に入る方の項目も作って。スマホでも
 * プレイできるようにスマホ用の画面調整してほしい。」への対応を検証する
 * 回帰テスト。
 *
 * 【背景1: オートマッチングの「参加する」項目】
 * 従来、オンライン対戦ロビーの「オートマッチング」ボタンを押すと、必ず
 * 希望人数・AI難易度・制限時間を選ぶ設定画面(_showAutoMatchSettings)に
 * 進んでいた。既に誰かが探している対戦にそのまま参加したいだけの人に
 * とってはこの設定入力は不要な手間であり、「探してる相手に入る方の
 * 項目」が無かった。オートマッチング配下に「検索する(条件を設定して
 * 探す)」と「参加する(そのまま入る)」を分けたサブメニュー
 * (_showAutoMatchEntry)を追加した。実際の待合ロビーの仕組み
 * (_startAutoMatch以降)は両者で全く同じで、「参加する」は単に設定画面を
 * 経由せず即座に待合ロビーへ加わるだけの違いになる。
 *
 * 【背景2: スマホ対応】
 * このゲームは矢印キー+Spaceのキーボード操作専用で、タッチ操作の手段が
 * 一切無かったため、スマホでは事実上プレイ不可能だった。加えて、メニュー
 * 画面群(Title/Lobby/OnlineLobby/Result/Ranking)はデスクトップの横長
 * 画面を前提にした固定ピクセルオフセット(centerX±220px等)でボタン・
 * 設定行を配置しており、スマホの狭い画面(360〜430px前後)ではラベルや
 * +/-ボタン・テーブルの列が画面外に切れてしまっていた。
 * 対応として、(a) GameSceneに画面左下の仮想十字キー+右下の爆弾ボタン+
 * 右上の一時停止ボタンを追加し(タッチ対応デバイスでのみ表示)、(b) 各
 * メニュー画面の座標・フォントサイズに画面サイズから算出した縮小率
 * (ResponsiveUI.computeUIScale)を一律で乗算するようにした。
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
  constructor() {
    this._handlers = {};
  }
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
  on(event, cb) {
    this._handlers[event] = cb;
    return this;
  }
  emit(event) {
    this._handlers[event]?.();
  }
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

const { computeUIScale, scaledFontPx } = await import('./src/utils/ResponsiveUI.js');
const { computeTouchControlLayout, isTouchCapable } = await import('./src/utils/TouchControlLayout.js');
const { GameScene } = await import('./src/scenes/GameScene.js');
const { OnlineLobbyScene } = await import('./src/scenes/OnlineLobbyScene.js');

function makeGameScene() {
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

console.log('== 1. ResponsiveUI.computeUIScale (メニュー画面のスマホ向け縮小率算出) ==');
{
  check('デスクトップの標準的な画面サイズでは縮小率が1になる(従来の座標と完全一致)', computeUIScale(1280, 800) === 1);
  check('幅760x高さ560ちょうどでも縮小率は1', computeUIScale(760, 560) === 1);
  const phonePortrait = computeUIScale(390, 844); // iPhone等の典型的な縦持ちサイズ
  check('スマホ縦持ち(390x844)では縮小率が1未満になる', phonePortrait < 1);
  check('スマホ縦持ち(390x844)でも縮小率は最低ラインを下回らない', phonePortrait >= 0.6);
  const tinyLandscape = computeUIScale(320, 320); // 非常に狭い正方形に近い画面
  check('非常に狭い画面でも縮小率は0.6を下回らない(可読性の下限)', tinyLandscape >= 0.6);
  check('scaledFontPxは基準pxに縮小率を乗算したpx文字列を返す', scaledFontPx(20, 0.5) === '10px');
  check('scaledFontPxは極端に小さくなりすぎないよう9px未満にはならない', scaledFontPx(10, 0.6) === '9px');
}

console.log('\n== 2. TouchControlLayout (スマホ向け仮想十字キー・爆弾ボタンの配置計算) ==');
{
  const desktop = computeTouchControlLayout(1000, 800);
  check('十字キーの上下ボタンは左右中心座標が一致する', desktop.up.x === desktop.down.x);
  check('十字キーの左右ボタンは上下中心座標が一致する', desktop.left.y === desktop.right.y);
  check('爆弾ボタンは十字キーより右側にある(重ならない)', desktop.bomb.x > desktop.right.x + 30);
  check('一時停止ボタンはステージ右上に配置される(y座標が小さい)', desktop.pause.y < 50);

  const narrowStage = computeTouchControlLayout(260, 700); // 非常に狭いステージ幅でも
  check('ステージ幅が非常に狭くても爆弾ボタンが十字キーと衝突しない最低限の間隔を保つ', narrowStage.bomb.x >= narrowStage.right.x + 50);
  check('ステージ幅が非常に狭くても各ボタン座標が有限の数値になる', Number.isFinite(narrowStage.bomb.x) && Number.isFinite(narrowStage.pause.x));

  check('window/navigatorが無ければisTouchCapableは常にfalse', isTouchCapable(null, null) === false);
  check('ontouchstartが存在する擬似windowならisTouchCapableはtrue', isTouchCapable({ ontouchstart: null }, null) === true);
  check('maxTouchPoints>0のnavigatorならisTouchCapableはtrue', isTouchCapable({}, { maxTouchPoints: 5 }) === true);
  check('maxTouchPoints===0のnavigatorならisTouchCapableはfalse', isTouchCapable({}, { maxTouchPoints: 0 }) === false);
}

console.log('\n== 3. GameScene: タッチ対応デバイスでのみ仮想操作ボタンが作られる ==');
{
  // タッチ非対応(通常のデスクトップブラウザ相当): navigatorを一切定義しない
  const scene = makeGameScene();
  scene.init({ mode: 'ai', playerCount: 1, aiCount: 1, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  scene.create();
  check('タッチ非対応デバイスではthis._touchControlsがnullのまま(邪魔な仮想ボタンを表示しない)', scene._touchControls === null);
  check('タッチ非対応デバイスでもthis._touchMoveStateは用意される(すべてfalse)', scene._touchMoveState && Object.values(scene._touchMoveState).every((v) => v === false));
}

console.log('\n== 4. GameScene: タッチ対応デバイスでは仮想操作ボタンが例外を投げずに作られる ==');
{
  // Node 21+はグローバルのnavigatorがgetterのみで直接代入できないため、
  // Object.definePropertyで上書きする(タッチ対応デバイスを装う)。
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 5 }, configurable: true });
  let threw = false;
  let scene;
  try {
    scene = makeGameScene();
    scene.init({ mode: 'ai', playerCount: 1, aiCount: 2, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
    scene.create();
  } catch (e) {
    threw = true;
    console.log(`      例外: ${e?.stack ?? e}`);
  }
  check('タッチ対応デバイスでもcreate()が例外を投げずに完了する', !threw);
  check('タッチ対応デバイスでは仮想十字キー・爆弾ボタン・一時停止ボタンが作られる', !!scene?._touchControls?.upBtn && !!scene?._touchControls?.bombBtn && !!scene?._touchControls?.pauseBtn);
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
}

console.log('\n== 5. GameScene: タッチ入力が既存のキーボード入力とOR条件でマージされる(ローカル/ホスト側) ==');
{
  const scene = makeGameScene();
  scene.init({ mode: 'ai', playerCount: 1, aiCount: 1, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  scene.create();

  const moveCalls = [];
  scene._moveOrKick = (player, dir) => moveCalls.push(dir);

  // キーボードは何も押されていない状態で、タッチの右ボタンだけをtrueにする
  scene._touchMoveState.right = true;
  scene._handleMovementInput();
  check('タッチ十字キー(右)だけが押されていてもプレイヤーが移動する(キーボードとのOR条件)', moveCalls.includes('right'));

  moveCalls.length = 0;
  scene._touchMoveState.right = false;
  scene._handleMovementInput();
  check('タッチ入力を離せば移動しなくなる', moveCalls.length === 0);
}

console.log('\n== 6. GameScene: ゲスト側でもタッチ入力が移動メッセージにマージされる ==');
{
  const scene = makeGameScene();
  const sentMessages = [];
  const fakeNetwork = {
    onMessage: () => () => {},
    send: (msg) => sentMessages.push(msg),
    clientId: 'c2',
  };
  scene.init({
    mode: 'online',
    playerCount: 2,
    aiCount: 0,
    humanCount: 2,
    timeLimitMs: 180000,
    aiDifficulty: 'normal',
    online: { network: fakeNetwork, role: 'guest', roomCode: 'ABCDE' },
  });
  scene.create();
  scene.myPlayerId = 2;
  scene._touchMoveState.up = true;
  scene._sendGuestMoveInputIfDue(10000);
  const lastMsg = sentMessages[sentMessages.length - 1];
  check('ゲスト側でもタッチ十字キー(上)の入力がホストへの移動メッセージに反映される', lastMsg?.up === true);
}

console.log('\n== 7. GameScene: タッチの爆弾ボタンは_tryPlaceBomb/bomb入力送信を正しく呼び分ける ==');
{
  // ローカル/ホスト側: 最初の人間プレイヤーに対してdirectly _tryPlaceBombを呼ぶ
  const localScene = makeGameScene();
  localScene.init({ mode: 'ai', playerCount: 1, aiCount: 1, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  localScene.create();
  localScene.countdownActive = false; // 通常はカウントダウン終了後に爆弾設置可能になる(fake環境ではtime.delayedCallが発火しないため手動で終了させる)
  const bombCalls = [];
  localScene._tryPlaceBomb = (player) => bombCalls.push(player.playerId);
  localScene._handleTouchBombPress();
  check('ローカル/ホスト側では最初の人間プレイヤーに対して_tryPlaceBombが呼ばれる', bombCalls.length === 1 && bombCalls[0] === localScene._humanInputs[0].player.playerId);

  // ゲスト側: ネットワーク経由でbomb入力メッセージを送るだけ(ローカルでは移動しない)
  const guestScene = makeGameScene();
  const sentMessages = [];
  const fakeNetwork = { onMessage: () => () => {}, send: (msg) => sentMessages.push(msg), clientId: 'c2' };
  guestScene.init({
    mode: 'online',
    playerCount: 2,
    aiCount: 0,
    humanCount: 2,
    timeLimitMs: 180000,
    aiDifficulty: 'normal',
    online: { network: fakeNetwork, role: 'guest', roomCode: 'ABCDE' },
  });
  guestScene.create();
  guestScene.myPlayerId = 2;
  guestScene._handleTouchBombPress();
  check('ゲスト側ではbomb入力メッセージがホストへ送信される', sentMessages.some((m) => m.type === 'bomb_input' || m.playerId === 2 || m.mode === 'bomb'));
}

console.log('\n== 8. ViewportLayout: コンパクトパネル時にプレイヤーカードが縦積みレイアウトになる ==');
{
  const scene = makeGameScene();
  scene.scale = { width: 390, height: 844, on: () => {}, off: () => {} }; // スマホ縦持ちの典型的なサイズ
  scene.init({ mode: 'ai', playerCount: 2, aiCount: 2, humanCount: 1, timeLimitMs: 180000, aiDifficulty: 'normal' });
  scene.create();
  check('スマホ幅ではcompactPanelがtrueになる', scene._layout.compactPanel === true);
  check('スマホ幅でもパネルが完全に0幅にならない(プレイヤー情報が表示され続ける)', scene._layout.panelWidth > 0);
  const firstCard = [...scene._playerCards.values()][0];
  check('コンパクト時もプレイヤーカードは例外なく生成される', !!firstCard);
  check(
    'コンパクト時、プレイヤーカードのアイコンはパネル中央に配置される(横並びではなく縦積みレイアウト)',
    !!firstCard && Math.abs(firstCard.iconCenterX - scene._layout.panelWidth / 2) < 0.001
  );
}

console.log('\n== 9. OnlineLobbyScene: オートマッチングに「検索する/参加する」のサブメニューが追加されている ==');
{
  const scene = new OnlineLobbyScene();
  scene.scale = { width: 800, height: 600 };
  scene.add = {
    text: () => new FakeTextObj(),
    container: () => new FakeContainer(),
    rectangle: () => new FakeTextObj(),
  };
  scene.init();
  scene._uiScale = 1;
  scene.bodyContainer = new FakeContainer();

  let modeSelectShown = false;
  let settingsShown = false;
  let startAutoMatchCalled = false;
  scene._showModeSelect2 = scene._showModeSelect; // 参照保持(未使用、意図の明示用)
  scene._showAutoMatchSettings = () => { settingsShown = true; };
  scene._startAutoMatch = () => { startAutoMatchCalled = true; };
  scene._showModeSelect = () => { modeSelectShown = true; };

  scene._showModeSelect = OnlineLobbyScene.prototype._showModeSelect.bind(scene);
  scene._showModeSelect();
  // _showModeSelect内で作られたボタン群の中から「オートマッチング」ボタンを取得し、
  // pointerdownハンドラが_showAutoMatchEntry()を呼ぶことを確認する。
  const modeSelectButtons = scene.bodyContainer.children;
  check('_showModeSelect()が4つのボタンを表示する(オートマッチング/部屋を作る/参加する/戻る)', modeSelectButtons.length === 4);

  let autoMatchEntryShown = false;
  scene._showAutoMatchEntry = () => { autoMatchEntryShown = true; };
  modeSelectButtons[0].emit('pointerdown');
  check('「オートマッチング」ボタンは_showAutoMatchEntry()(検索する/参加するのサブメニュー)を呼ぶ', autoMatchEntryShown);

  // _showAutoMatchEntry自体の中身(検索する/参加する/戻るの3ボタン)を検証する
  scene._showAutoMatchEntry = OnlineLobbyScene.prototype._showAutoMatchEntry.bind(scene);
  scene.bodyContainer = new FakeContainer();
  scene._showAutoMatchSettings = () => { settingsShown = true; };
  scene._startAutoMatch = () => { startAutoMatchCalled = true; };
  scene._showModeSelect = () => { modeSelectShown = true; };
  scene._showAutoMatchEntry();
  const entryButtons = scene.bodyContainer.children.filter((c) => typeof c?.emit === 'function' && c._handlers?.pointerdown);
  check('_showAutoMatchEntry()は検索する/参加する/戻るの3つの操作可能な要素を表示する', entryButtons.length === 3);

  entryButtons[0].emit('pointerdown');
  check('「検索する」ボタンは_showAutoMatchSettings()(条件設定画面)を呼ぶ', settingsShown === true);

  entryButtons[1].emit('pointerdown');
  check('「参加する」ボタンは_startAutoMatch()を直接呼ぶ(設定画面を経由せず即座に待合ロビーへ参加)', startAutoMatchCalled === true);

  entryButtons[2].emit('pointerdown');
  check('「戻る」ボタンは_showModeSelect()に戻る', modeSelectShown === true);
}

console.log('\n== 10. ソースコード上の静的確認(スマホ対応・オートマッチング参加項目の主要な仕組みが揃っているか) ==');
{
  const gameSceneSrc = fs.readFileSync('src/scenes/GameScene.js', 'utf8');
  check('GameScene.jsがTouchControlLayoutをimportしている', /from ['"]\.\.\/utils\/TouchControlLayout\.js['"]/.test(gameSceneSrc));
  check('GameScene.jsに_createTouchControlsメソッドがある', /_createTouchControls\s*\(/.test(gameSceneSrc));
  check('GameScene.jsに_handleTouchBombPressメソッドがある', /_handleTouchBombPress\s*\(/.test(gameSceneSrc));

  const onlineLobbySrc = fs.readFileSync('src/scenes/OnlineLobbyScene.js', 'utf8');
  check('OnlineLobbyScene.jsに_showAutoMatchEntryメソッドがある', /_showAutoMatchEntry\s*\(/.test(onlineLobbySrc));
  check('OnlineLobbyScene.jsがResponsiveUIをimportしている', /from ['"]\.\.\/utils\/ResponsiveUI\.js['"]/.test(onlineLobbySrc));

  const lobbySrc = fs.readFileSync('src/scenes/LobbyScene.js', 'utf8');
  check('LobbyScene.jsがResponsiveUIをimportしている', /from ['"]\.\.\/utils\/ResponsiveUI\.js['"]/.test(lobbySrc));

  const titleSrc = fs.readFileSync('src/scenes/TitleScene.js', 'utf8');
  check('TitleScene.jsがResponsiveUIをimportしている', /from ['"]\.\.\/utils\/ResponsiveUI\.js['"]/.test(titleSrc));

  const resultSrc = fs.readFileSync('src/scenes/ResultScene.js', 'utf8');
  check('ResultScene.jsがResponsiveUIをimportしている', /from ['"]\.\.\/utils\/ResponsiveUI\.js['"]/.test(resultSrc));

  for (const file of ['src/scenes/GameScene.js', 'src/scenes/OnlineLobbyScene.js', 'src/scenes/LobbyScene.js', 'src/scenes/TitleScene.js', 'src/scenes/ResultScene.js', 'src/scenes/RankingScene.js']) {
    const { execSync } = await import('child_process');
    let syntaxOk = true;
    try {
      execSync(`node --check ${file}`, { stdio: 'pipe' });
    } catch {
      syntaxOk = false;
    }
    check(`${file}が構文エラー無くパースできる`, syntaxOk);
  }
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
