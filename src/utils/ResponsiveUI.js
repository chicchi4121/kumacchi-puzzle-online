/**
 * ResponsiveUI.js
 * ------------------------------------------------------------
 * メニュー画面(TitleScene/LobbyScene/OnlineLobbyScene/ResultScene/
 * RankingScene)は、従来デスクトップの横長画面を前提にした固定ピクセル
 * オフセット(centerX±220px等)でボタン・設定行を配置していた。スマホ
 * (特に縦持ち、幅360〜430px前後)ではこの固定オフセットが画面幅から
 * はみ出し、ラベルや+/-ボタン・テーブルの列が画面外に切れてしまう。
 *
 * 「スマホでもプレイできるように画面調整してほしい」への対応として、
 * 画面の実際の幅・高さから縮小率(MIN_UI_SCALE〜1.0)を算出する共通関数を
 * 用意した。各メニュー画面はcenterXからのオフセット・y座標・フォント
 * サイズにこの縮小率を一律で乗算することで、画面が狭い/低い場合は
 * レイアウト全体が自動的に縮小されて画面内に収まる。
 *
 * デスクトップの標準的な画面サイズ(REF_WIDTH×REF_HEIGHT以上)では縮小率が
 * ちょうど1になり、従来の座標・見た目と完全に一致する(回帰なし)。
 * Phaser/DOMいずれにも依存しない純粋関数なのでNode上でも検証できる
 * (開発ルール9と同じ考え方)。
 * ------------------------------------------------------------
 */

// これ以上の幅なら縮小しない(デスクトップの標準的な横幅の目安)
const REF_WIDTH = 760;
// これ以上の高さなら縮小しない(現状のメニュー画面が到達する最大y座標+余白の目安)
const REF_HEIGHT = 560;
// これ以上は縮小しない(文字が小さすぎて読めなくなる可読性の下限)
const MIN_UI_SCALE = 0.6;

/**
 * @param {number} scaleWidth - this.scale.width相当
 * @param {number} scaleHeight - this.scale.height相当
 * @returns {number} 0.6〜1.0の縮小率
 */
export function computeUIScale(scaleWidth, scaleHeight) {
  const safeWidth = Math.max(1, scaleWidth || 0);
  const safeHeight = Math.max(1, scaleHeight || 0);
  const widthScale = Math.min(1, safeWidth / REF_WIDTH);
  const heightScale = Math.min(1, safeHeight / REF_HEIGHT);
  return Math.max(MIN_UI_SCALE, Math.min(widthScale, heightScale));
}

/** 基準フォントサイズ(px数値)にuiScaleを乗算し、PhaserのfontSizeスタイル文字列("18px"等)を返す */
export function scaledFontPx(basePx, uiScale) {
  return `${Math.max(9, Math.round(basePx * uiScale))}px`;
}
