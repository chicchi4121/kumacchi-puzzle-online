/**
 * main.js
 * ------------------------------------------------------------
 * ゲームのエントリーポイント。Phaser 3のGameインスタンスを生成し、
 * 各シーンを登録する。
 *
 * 【2026-07更新: 画面レイアウトをブラウザの実サイズに追従させる】
 * 「画面の上下はブラウザの大きさに合わせて、右側の空いている部分に
 * 各プレイヤーの情報を表示してほしい」という要望に対応するため、
 * Phaser.Scale.FIT(固定解像度をアスペクト比維持のまま余白付きで
 * 縮小表示する方式)から、Phaser.Scale.RESIZE(ゲームの論理サイズを
 * 常にブラウザ/親要素の実サイズそのものに合わせる方式)へ変更した。
 * これにより画面上下が常にブラウザいっぱいになる。
 *
 * 対戦画面(GameScene)では、この実サイズのうち右側HUD_PANEL_WIDTH分を
 * プレイヤー情報パネル用に確保し、残り(左側)を3Dバトルステージ
 * (#cube-canvas)の表示領域にする(計算式はViewportLayout.js、GameScene.js
 * と共有)。タイトル/ロビー/リザルト等の他のメニュー画面は、各シーンが
 * 自身の生成時にthis.scale.width/heightを見て中央揃えし直す作りに
 * なっている(各シーンファイル参照。固定解像度前提のレイアウトコードを
 * 全面的に書き換えずに済むよう、中央位置の計算箇所だけを動的にした)。
 * ------------------------------------------------------------
 */
import { SCREEN_WIDTH, SCREEN_HEIGHT, TARGET_FPS } from './constants/GameConstants.js';
import { computeBattleLayout } from './utils/ViewportLayout.js';
import { TitleScene } from './scenes/TitleScene.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { OnlineLobbyScene } from './scenes/OnlineLobbyScene.js';
import { RankingScene } from './scenes/RankingScene.js';
import { GameScene } from './scenes/GameScene.js';
import { ResultScene } from './scenes/ResultScene.js';
import { PauseScene } from './scenes/PauseScene.js';

/** @type {Phaser.Types.Core.GameConfig} */
const config = {
  type: Phaser.AUTO,
  width: SCREEN_WIDTH,
  height: SCREEN_HEIGHT,
  parent: 'game-container',
  // サイコロ6面ステージ(Phase3)のバトル画面はThree.js(#cube-canvas)で3D描画し、
  // Phaser側はHUD/UI/カウントダウン等のテキスト・オーバーレイのみを担当する。
  // その3D映像を透過して見せるため、Phaserのcanvas自体は透明にしておく。
  transparent: true,
  fps: {
    target: TARGET_FPS,
  },
  scale: {
    // RESIZE: ゲームの論理サイズ(=Scene内のthis.scale.width/height)を
    // 常に親要素(#game-container、CSSでwidth:100vw;height:100vhにしてある)
    // の実サイズそのものに合わせる。letterbox(余白)が発生しないため、
    // 画面の上下がブラウザの高さに常に一致する。
    mode: Phaser.Scale.RESIZE,
  },
  // Phase1は見下ろし型のグリッド移動のみのため物理エンジンは未使用。
  // Phase3以降で必要になった場合にArcade Physics等を追加する。
  scene: [TitleScene, LobbyScene, OnlineLobbyScene, RankingScene, GameScene, ResultScene, PauseScene],
};

window.addEventListener('load', () => {
  const game = new Phaser.Game(config);
  // #cube-canvas(Three.js)の上にPhaserのcanvas(HUD/UI用)を重ねて表示するため、
  // CSSで積み重ね順を制御できるようクラスを付与する(index.html参照)。
  game.canvas?.classList.add('phaser-canvas');

  // #cube-canvasは、画面全体ではなく「右側のプレイヤー情報パネル分を除いた
  // 左側の領域」だけに表示する(computeBattleLayout、ViewportLayout.js参照。
  // GameScene.js側も同じ計算式でパネル・HUDの位置を決めている)。
  const cubeCanvas = document.getElementById('cube-canvas');
  const syncCubeCanvasSize = () => {
    if (!cubeCanvas) return;
    const { stageWidth, totalHeight } = computeBattleLayout(window.innerWidth, window.innerHeight);
    cubeCanvas.style.width = `${stageWidth}px`;
    cubeCanvas.style.height = `${totalHeight}px`;
  };
  syncCubeCanvasSize();
  // Phaser.Scale.RESIZEが親要素のサイズ変化を検知して発火する'resize'
  // イベントに加え、念のためwindowのresizeにも直接反応させておく(両者は
  // 通常ほぼ同時に発火するが、タイミングのズレによる一瞬のサイズ不一致を
  // 避けるための保険)。
  game.scale.on('resize', syncCubeCanvasSize);
  window.addEventListener('resize', syncCubeCanvasSize);
});
