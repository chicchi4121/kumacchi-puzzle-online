/**
 * ViewportLayout.js
 * ------------------------------------------------------------
 * 対戦画面(GameScene)のレイアウト計算を1箇所にまとめた純粋関数モジュール。
 *
 * 「画面の上下はブラウザの大きさに合わせて、右側の空いている部分に
 * 各プレイヤーの情報を表示してほしい」という要望に対応するため、
 * GameSceneはPhaser.Scale.RESIZEモードでブラウザの実サイズいっぱいに
 * 表示する(main.js参照)。画面の右側にHUD_PANEL_WIDTH分の固定幅を確保して
 * プレイヤー情報パネルを表示し、残りの(左側)領域を3Dバトルステージ
 * (#cube-canvas)の表示領域にする。
 *
 * main.js(#cube-canvasのCSSサイズ調整)とGameScene.js(HUD/パネルの配置)の
 * 両方から同じ計算式を参照する必要があるため、ここに切り出してある
 * (計算式が2箇所でズレる事故を防ぐ)。Phaser/Three.jsいずれにも依存しない
 * 純粋関数なのでNode上でも検証できる。
 * ------------------------------------------------------------
 */
import {
  HUD_PANEL_WIDTH,
  STAGE_VIEWPORT_MIN_WIDTH,
  MIN_HUD_PANEL_WIDTH,
  COMPACT_HUD_PANEL_THRESHOLD,
} from '../constants/GameConstants.js';

/**
 * ブラウザ(またはゲームcanvasの親要素)の実サイズから、対戦画面の
 * レイアウトを計算する。
 * @param {number} totalWidth
 * @param {number} totalHeight
 * @returns {{ totalWidth: number, totalHeight: number, stageWidth: number, panelWidth: number, panelX: number, compactPanel: boolean }}
 */
export function computeBattleLayout(totalWidth, totalHeight) {
  const safeWidth = Math.max(1, totalWidth || 0);
  const safeHeight = Math.max(1, totalHeight || 0);
  // ステージ幅はSTAGE_VIEWPORT_MIN_WIDTHを下回らないようにするのが本来の
  // 優先順位(ステージの最低限の遊びやすさ > パネルの理想幅)だが、これを
  // 無条件に適用すると、スマホ等の狭い画面(幅400px前後)では右側パネルの
  // 幅が実質0になり、プレイヤー情報が一切表示されなくなってしまう
  // (「スマホでもプレイできるように」への対応で判明した不具合)。
  // そのため、パネル幅は画面がどれだけ狭くてもMIN_HUD_PANEL_WIDTH分だけは
  // 必ず確保し、ステージ幅はその残り(ただし通常時はSTAGE_VIEWPORT_MIN_WIDTH
  // を優先)とする。非常に狭い画面ではステージ幅がSTAGE_VIEWPORT_MIN_WIDTHを
  // 下回ることを許容する(パネルが完全に消えるよりはましという判断)。
  const desiredStageWidth = Math.max(STAGE_VIEWPORT_MIN_WIDTH, safeWidth - HUD_PANEL_WIDTH);
  const maxStageWidthKeepingMinPanel = Math.max(0, safeWidth - MIN_HUD_PANEL_WIDTH);
  const stageWidth = Math.min(
    safeWidth,
    desiredStageWidth,
    maxStageWidthKeepingMinPanel > 0 ? maxStageWidthKeepingMinPanel : safeWidth
  );
  const panelWidth = Math.max(0, safeWidth - stageWidth);
  return {
    totalWidth: safeWidth,
    totalHeight: safeHeight,
    stageWidth,
    panelWidth,
    panelX: stageWidth,
    // パネル幅が狭い場合、GameScene側でプレイヤーカードをアイコン中心の
    // コンパクト表示に切り替えるための目印(_createPlayerCard参照)。
    compactPanel: panelWidth < COMPACT_HUD_PANEL_THRESHOLD,
  };
}
