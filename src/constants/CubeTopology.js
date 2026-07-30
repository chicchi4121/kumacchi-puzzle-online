/**
 * CubeTopology.js
 * ------------------------------------------------------------
 * サイコロ状(立方体)の6面ステージの「面と面のつながり」を定義する
 * 純粋データ・純粋ロジックのモジュール。Three.js/Phaserいずれにも
 * 依存しないため、Node上でも安全にimport・検証できる。
 *
 * 各面はローカルな2次元座標(u,v ∈ [-1,1])を持ち、以下の式で
 * 立方体表面上の3D位置に対応する:
 *   position = N + R*u + D*v
 * ここで N=面の法線(中心方向)、R=面内で「右」方向、D=面内で「下」方向。
 * uが増えると画面上で右、vが増えると画面上で下（グリッドのcol/rowに対応）。
 *
 * 6面の呼び方はFRONT/BACK/RIGHT/LEFT/TOP/BOTTOM（立方体の各面）。
 *
 * 面の端(エッジ)を越えて移動した場合にどの面のどの位置へ着地するかを
 * 表す CROSSING_TABLE は、上記の軸定義から幾何学的に導出し、
 * 双方向の整合性（Aの右端→Bの左端 なら Bの左端→Aの右端 になっている等）
 * を検証済みの値をハードコードしている（導出スクリプトはコメント末尾参照）。
 *
 * newFacing（面をまたいだ後にプレイヤーが向く方向）は、
 * 「入ってきた辺と反対方向へ進み続ける」という単純な規則
 * （立方体を展開図として広げたときにまっすぐ歩き続けるのと同じ）から
 * 一意に決まる: newFacing = OPPOSITE_EDGE[viaEdge]
 * ------------------------------------------------------------
 */

export const FACE_AXES = Object.freeze({
  FRONT: { N: [0, 0, 1], R: [1, 0, 0], D: [0, -1, 0] },
  BACK: { N: [0, 0, -1], R: [-1, 0, 0], D: [0, -1, 0] },
  RIGHT: { N: [1, 0, 0], R: [0, 0, -1], D: [0, -1, 0] },
  LEFT: { N: [-1, 0, 0], R: [0, 0, 1], D: [0, -1, 0] },
  TOP: { N: [0, 1, 0], R: [1, 0, 0], D: [0, 0, 1] },
  BOTTOM: { N: [0, -1, 0], R: [1, 0, 0], D: [0, 0, -1] },
});

export const OPPOSITE_EDGE = Object.freeze({ right: 'left', left: 'right', up: 'down', down: 'up' });

// direction名(グリッド移動方向) <-> edge名(面の端) は同じ4方向なのでそのまま対応する。
// { toFace, viaEdge, newFacing, varReversed }
//   toFace: 進入先の面
//   viaEdge: 進入先の面で、どちらの辺から入るか
//   newFacing: 面をまたいだ直後にプレイヤーが向く方向
//   varReversed: 辺に沿った座標(row或いはcol)を反転させる必要があるか
export const CROSSING_TABLE = Object.freeze({
  FRONT: {
    right: { toFace: 'RIGHT', viaEdge: 'left', newFacing: 'right', varReversed: false },
    left: { toFace: 'LEFT', viaEdge: 'right', newFacing: 'left', varReversed: false },
    up: { toFace: 'TOP', viaEdge: 'down', newFacing: 'up', varReversed: false },
    down: { toFace: 'BOTTOM', viaEdge: 'up', newFacing: 'down', varReversed: false },
  },
  BACK: {
    right: { toFace: 'LEFT', viaEdge: 'left', newFacing: 'right', varReversed: false },
    left: { toFace: 'RIGHT', viaEdge: 'right', newFacing: 'left', varReversed: false },
    up: { toFace: 'TOP', viaEdge: 'up', newFacing: 'down', varReversed: true },
    down: { toFace: 'BOTTOM', viaEdge: 'down', newFacing: 'up', varReversed: true },
  },
  RIGHT: {
    right: { toFace: 'BACK', viaEdge: 'left', newFacing: 'right', varReversed: false },
    left: { toFace: 'FRONT', viaEdge: 'right', newFacing: 'left', varReversed: false },
    up: { toFace: 'TOP', viaEdge: 'right', newFacing: 'left', varReversed: true },
    down: { toFace: 'BOTTOM', viaEdge: 'right', newFacing: 'left', varReversed: false },
  },
  LEFT: {
    right: { toFace: 'FRONT', viaEdge: 'left', newFacing: 'right', varReversed: false },
    left: { toFace: 'BACK', viaEdge: 'right', newFacing: 'left', varReversed: false },
    up: { toFace: 'TOP', viaEdge: 'left', newFacing: 'right', varReversed: false },
    down: { toFace: 'BOTTOM', viaEdge: 'left', newFacing: 'right', varReversed: true },
  },
  TOP: {
    right: { toFace: 'RIGHT', viaEdge: 'up', newFacing: 'down', varReversed: true },
    left: { toFace: 'LEFT', viaEdge: 'up', newFacing: 'down', varReversed: false },
    up: { toFace: 'BACK', viaEdge: 'up', newFacing: 'down', varReversed: true },
    down: { toFace: 'FRONT', viaEdge: 'up', newFacing: 'down', varReversed: false },
  },
  BOTTOM: {
    right: { toFace: 'RIGHT', viaEdge: 'down', newFacing: 'up', varReversed: false },
    left: { toFace: 'LEFT', viaEdge: 'down', newFacing: 'up', varReversed: true },
    up: { toFace: 'FRONT', viaEdge: 'down', newFacing: 'up', varReversed: false },
    down: { toFace: 'BACK', viaEdge: 'down', newFacing: 'up', varReversed: true },
  },
});

/**
 * 面のローカル座標(u,v いずれも-1〜1)を、立方体表面上の3D位置に変換する。
 * レンダラー(Three.js)側で、各面のグリッドセルを3D空間内の正しい位置・
 * 向きに配置するために使う。
 */
export function faceLocalToWorld(face, u, v) {
  const { N, R, D } = FACE_AXES[face];
  return [N[0] + R[0] * u + D[0] * v, N[1] + R[1] * u + D[1] * v, N[2] + R[2] * u + D[2] * v];
}

/*
 * ------------------------------------------------------------
 * 導出スクリプトについて（検証済み・再現用メモ）:
 * FACE_AXESの6面それぞれについて、4つの辺(up/down/left/right)の3D端点座標
 * を計算し、他の面の辺と端点が一致するものを総当たりで探すことで
 * toFace/viaEdge/varReversedを機械的に導出し、newFacingは
 * 「OPPOSITE_EDGE[viaEdge]」という単純な規則（辺を挟んで反対側へ進み
 * 続ける＝展開図のまま直進する、という物理的に正しいモデル）から算出した。
 * 全24通り(6面×4辺)について、A→Bの変換とB→Aの変換が矛盾しない
 * （辺と反転フラグが一致する）ことをNode上のスクリプトで検証済み。
 * ------------------------------------------------------------
 */
