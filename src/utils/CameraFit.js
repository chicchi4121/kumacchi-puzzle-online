/**
 * CameraFit.js
 * ------------------------------------------------------------
 * サイコロ6面ステージ(CubeRenderer)の固定カメラを、canvasのアスペクト比
 * (幅/高さ)に応じて調整するための純粋関数。
 *
 * 「スマホ用の画面に面がおさまるようにしてほしい」への対応。
 *
 * Three.jsのPerspectiveCamera.fovは「縦方向の視野角」を表す。そのため、
 * fov・カメラ距離を固定したままアスペクト比だけが変わると、横方向の
 * 視野 = 縦方向の視野 × aspect という関係上、横長画面(aspect>=1、従来の
 * デスクトップ想定)では横方向の視野が十分に確保される一方、スマホの
 * 縦長画面(aspect<1、幅<高さ。特に右側HUDパネル分を差し引いた3D描画
 * 領域は非常に縦長になりやすい)では横方向の視野が大幅に狭くなり、
 * サイコロの面の左右がキャンバス(=スマホの画面)からはみ出て見切れて
 * しまっていた。
 *
 * このモジュールは、aspect<1のときに縦方向のFOVを広げることで横方向の
 * 視野(=面の見える範囲)を、aspect>=1のときと同じ絶対量だけ確保する。
 * ただしFOVを際限なく広げると魚眼レンズのような強い歪みが出てしまう
 * ため、上限(MAX_VFOV_DEG)を設け、それでも横方向の視野が足りない
 * (=aspectが極端に縦長な)場合は、残りをカメラを少し後ろに下げる
 * (距離を伸ばす)ことで補う。
 * ------------------------------------------------------------
 */

// aspect>=1(横長・正方形)のときの縦方向FOV(度)。従来からの値をそのまま維持する。
export const BASE_VFOV_DEG = 55;
// 縦方向FOVの上限(度)。これを超えて広げると魚眼レンズのような強い歪みが
// 目立ち始めるため、ここで頭打ちにし、残りはカメラ距離側で補う。
export const MAX_VFOV_DEG = 85;

/**
 * @param {number} aspect - canvas(3Dステージ表示領域)の幅/高さ
 * @returns {{ vFovDeg: number, distanceScale: number }}
 *   vFovDeg: カメラに設定すべき縦方向FOV(度)。
 *   distanceScale: 基準のカメラ距離に掛ける倍率(常に1以上)。aspectが
 *     極端に縦長で、FOVの上限だけでは横方向の視野を確保しきれない場合に
 *     1より大きくなる(カメラを後ろに下げて視野を広げる)。
 */
export function computeCameraFit(aspect) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;

  // 横長・正方形(aspect>=1)では、従来通り横方向の視野が縦方向以上に
  // 確保されるため調整不要。
  if (safeAspect >= 1) {
    return { vFovDeg: BASE_VFOV_DEG, distanceScale: 1 };
  }

  const baseVFovRad = (BASE_VFOV_DEG * Math.PI) / 180;
  const maxVFovRad = (MAX_VFOV_DEG * Math.PI) / 180;

  // aspect=1のとき基準となる横方向の視野角(の半分のtan値)を、aspectで
  // 割ることで「aspect<1でも横方向の視野角(半分のtan値)を基準と同じ
  // 絶対量に保つ」ために必要な縦方向FOVを逆算する
  // (横方向の視野の半分のtan値 = tan(縦方向FOV/2) × aspect という関係の逆算)。
  const desiredHalfTan = Math.tan(baseVFovRad / 2) / safeAspect;
  const desiredVFovRad = 2 * Math.atan(desiredHalfTan);

  if (desiredVFovRad <= maxVFovRad) {
    return { vFovDeg: (desiredVFovRad * 180) / Math.PI, distanceScale: 1 };
  }

  // FOV上限だけでは横方向の視野を確保しきれない分を、カメラの距離を
  // 伸ばすことで補う(同じFOVでも距離を伸ばすほど見える範囲が広がるため)。
  const maxHalfTan = Math.tan(maxVFovRad / 2);
  const distanceScale = desiredHalfTan / maxHalfTan; // 必ず1より大きい
  return { vFovDeg: MAX_VFOV_DEG, distanceScale };
}
