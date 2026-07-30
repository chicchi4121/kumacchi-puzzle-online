/**
 * TouchControlLayout.js
 * ------------------------------------------------------------
 * 対戦画面(GameScene)に表示するスマホ向け仮想操作ボタン
 * (十字キー風の4方向ボタン+爆弾ボタン+一時停止ボタン)の配置計算を
 * 1箇所にまとめた純粋関数モジュール。
 *
 * 「スマホでもプレイできるようにしてほしい」への対応。従来この
 * ゲームはキーボード操作(矢印キー+Space)専用で、タッチ操作の手段が
 * 一切無かったため、スマホでは事実上プレイ不可能だった。
 *
 * GameScene._createTouchControls()(作成時)と_onGameResize()
 * (リサイズ追従時)の両方から同じ配置計算を使う必要があるため、ここに
 * 切り出してある(ViewportLayout.jsと同じ考え方。開発ルール9)。
 * ------------------------------------------------------------
 */

/**
 * @param {number} stageWidth - 3Dバトルステージ表示領域の幅(ViewportLayout.computeBattleLayout参照)
 * @param {number} totalHeight - 画面全体の高さ
 * @returns {{
 *   up: {x:number,y:number}, down: {x:number,y:number},
 *   left: {x:number,y:number}, right: {x:number,y:number},
 *   bomb: {x:number,y:number}, pause: {x:number,y:number}
 * }}
 */
export function computeTouchControlLayout(stageWidth, totalHeight) {
  const safeStageWidth = Math.max(1, stageWidth || 0);
  const safeTotalHeight = Math.max(1, totalHeight || 0);

  // 十字キー(4方向ボタン)は画面左下に配置する。
  const dpadCenterX = 95;
  const dpadCenterY = safeTotalHeight - 95;
  const dpadGap = 52;

  // 爆弾ボタンは画面右下(ステージ領域内)に配置する。十字キーと重ならない
  // よう、ステージがどれだけ狭くても十字キーの右端から最低70pxは離す。
  const bombX = Math.max(safeStageWidth - 66, dpadCenterX + dpadGap + 70);

  return {
    up: { x: dpadCenterX, y: dpadCenterY - dpadGap },
    down: { x: dpadCenterX, y: dpadCenterY + dpadGap },
    left: { x: dpadCenterX - dpadGap, y: dpadCenterY },
    right: { x: dpadCenterX + dpadGap, y: dpadCenterY },
    bomb: { x: bombX, y: safeTotalHeight - 80 },
    pause: { x: safeStageWidth - 22, y: 22 },
  };
}

/**
 * 現在のブラウザ/デバイスがタッチ操作に対応しているかどうかを判定する。
 * デスクトップ(マウス/キーボードのみ)では仮想ボタンを表示すると画面が
 * 手狭になり邪魔なだけなので、タッチ対応デバイスでのみ表示する。
 * window/navigatorが存在しない環境(Node上のテスト等)では常にfalseを返す。
 * @param {*} win - 通常はグローバルのwindow(テスト時は差し替え可能)
 * @param {*} nav - 通常はグローバルのnavigator(テスト時は差し替え可能)
 */
export function isTouchCapable(win, nav) {
  if (!win) return false;
  if ('ontouchstart' in win) return true;
  return !!nav && (nav.maxTouchPoints ?? 0) > 0;
}
