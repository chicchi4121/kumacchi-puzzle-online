/**
 * verify_cube_rotation.mjs
 * ------------------------------------------------------------
 * CubeRenderer.jsを「カメラ固定 + サイコロ全体を回転させる」方式に
 * 書き換える前に、その回転(クォータニオン)の導出式が数学的に正しいか
 * をNode上で検証するための使い捨てスクリプト(threeパッケージ不使用、
 * 最小限の行列/クォータニオン演算を手書きで再実装して確認する)。
 * サンドボックスがCDN(three.js等)に接続できないため、既存の
 * 「カメラ仰角バグ修正」の検証手法(標準ライブラリなしで手計算)を踏襲する。
 *
 * 検証すること:
 *  ある面Fを表示する際、立方体ルート(cube root)に適用する回転Qを
 *    Q = Mdst * Msrc(F)^-1
 *  としたとき、Q を面Fの法線N_Fおよび面内の上方向(-D_F)に適用すると、
 *  固定カメラ用に定めた目標軸(targetOutward, targetUp)に一致すること。
 * ------------------------------------------------------------
 */
import { FACE_AXES, CROSSING_TABLE } from './src/constants/CubeTopology.js';

// ---- 最小限のベクトル/行列/クォータニオン演算(three.jsのMatrix4/Quaternionと同じ規約) ----
function normalize([x, y, z]) {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}
function cross([ax, ay, az], [bx, by, bz]) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}
function dot([ax, ay, az], [bx, by, bz]) {
  return ax * bx + ay * by + az * bz;
}
function sub([ax, ay, az], [bx, by, bz]) {
  return [ax - bx, ay - by, az - bz];
}
function scale([x, y, z], s) {
  return [x * s, y * s, z * s];
}

/** THREE.Matrix4.makeBasis(xAxis,yAxis,zAxis)相当(列ベクトルとして並べた3x3回転行列、9要素の配列で表現) */
function makeBasis(xAxis, yAxis, zAxis) {
  // 行優先(row-major)3x3として [m00,m01,m02, m10,m11,m12, m20,m21,m22]
  return [
    xAxis[0], yAxis[0], zAxis[0],
    xAxis[1], yAxis[1], zAxis[1],
    xAxis[2], yAxis[2], zAxis[2],
  ];
}

/** THREE.Quaternion.setFromRotationMatrix(m)相当(標準的なアルゴリズム、m11/m22等はrow-major添字) */
function quatFromMatrix(m) {
  const [m11, m12, m13, m21, m22, m23, m31, m32, m33] = m;
  const trace = m11 + m22 + m33;
  let x, y, z, w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m32 - m23) * s;
    y = (m13 - m31) * s;
    z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}

/** クォータニオン積 a*b (three.jsのQuaternion.multiplyQuaternions(a,b)と同じ規約) */
function quatMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatInvert([x, y, z, w]) {
  // 単位クォータニオン前提の共役(=逆回転)
  return [-x, -y, -z, w];
}

/** ベクトルvにクォータニオンqを適用する(three.jsのVector3.applyQuaternionと同じ式) */
function applyQuat([x, y, z], [qx, qy, qz, qw]) {
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}
function vecApproxEqual(a, b, eps = 1e-6) {
  return approxEqual(a[0], b[0], eps) && approxEqual(a[1], b[1], eps) && approxEqual(a[2], b[2], eps);
}

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

// ---- 面ごとのMsrc(既存の_getFaceQuaternionと同じ式) ----
function faceQuaternion(face) {
  const { N, R, D } = FACE_AXES[face];
  const upLocal = [-D[0], -D[1], -D[2]];
  const m = makeBasis(R, upLocal, N);
  return quatFromMatrix(m);
}

// ---- 固定カメラの目標軸(Mdst)を導出する ----
const CAMERA_ELEVATION_RAD = (50 * Math.PI) / 180;
const targetOutward = [0, Math.sin(CAMERA_ELEVATION_RAD), Math.cos(CAMERA_ELEVATION_RAD)]; // c
const worldUpHint = [0, 1, 0];
const targetRight = normalize(cross(worldUpHint, targetOutward)); // a
const targetUp = cross(targetOutward, targetRight); // b (c,a単位かつ直交なのですでに単位ベクトル)

console.log('== 固定カメラ目標軸の直交性チェック ==');
check('targetOutwardは単位ベクトル', approxEqual(Math.hypot(...targetOutward), 1));
check('targetRightは単位ベクトル', approxEqual(Math.hypot(...targetRight), 1));
check('targetUpは単位ベクトル', approxEqual(Math.hypot(...targetUp), 1));
check('targetRight・targetOutwardは直交', approxEqual(dot(targetRight, targetOutward), 0));
check('targetUp・targetOutwardは直交', approxEqual(dot(targetUp, targetOutward), 0));
check('targetRight・targetUpは直交', approxEqual(dot(targetRight, targetUp), 0));
check('右手系(targetRight×targetUp=targetOutward)', vecApproxEqual(cross(targetRight, targetUp), targetOutward));

const Mdst = quatFromMatrix(makeBasis(targetRight, targetUp, targetOutward));

console.log('\n== 各面: Q = Mdst * Msrc(F)^-1 が面の法線・上方向を目標軸に一致させるか ==');
const FACE_NAMES = Object.keys(FACE_AXES);
for (const face of FACE_NAMES) {
  const { N, D } = FACE_AXES[face];
  const upLocal = [-D[0], -D[1], -D[2]];
  const Msrc = faceQuaternion(face);
  const Q = quatMultiply(Mdst, quatInvert(Msrc));

  const rotatedN = applyQuat(N, Q);
  const rotatedUp = applyQuat(upLocal, Q);

  check(`${face}: Q*N_F ≈ targetOutward`, vecApproxEqual(rotatedN, targetOutward, 1e-5));
  check(`${face}: Q*(-D_F) ≈ targetUp`, vecApproxEqual(rotatedUp, targetUp, 1e-5));

  // Qが正しい回転(直交変換)であることの追加確認: 長さを保存するか
  check(`${face}: Qはベクトルの長さを保存する(単位クォータニオン)`, approxEqual(Math.hypot(...rotatedN), 1, 1e-5));
}

console.log('\n== 隣接面へまたぐ際、Qが滑らかにアニメーションできる回転量になっているか(参考確認) ==');
// FRONT -> RIGHT (rightキー移動)のような典型的な隣接遷移で、Q_FRONTとQ_RIGHTの間の
// 「最短回転」を取るために、three.js側でスラープ前にquaternion.dot()<0ならnegateする
// 処理が必要になることがある(このスクリプトでは式の存在だけ確認し、実装時にCubeRenderer.js側で対応する)。
for (const [face, table] of Object.entries(CROSSING_TABLE)) {
  for (const [dir, entry] of Object.entries(table)) {
    const Msrc1 = faceQuaternion(face);
    const Msrc2 = faceQuaternion(entry.toFace);
    const Q1 = quatMultiply(Mdst, quatInvert(Msrc1));
    const Q2 = quatMultiply(Mdst, quatInvert(Msrc2));
    const d = dot(Q1, Q2);
    if (d < 0) {
      console.log(`  情報 ${face}--${dir}-->${entry.toFace}: dot(Q1,Q2)=${d.toFixed(3)} < 0 (slerp前にnegateが必要)`);
    }
  }
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
