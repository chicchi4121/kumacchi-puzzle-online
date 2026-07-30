/**
 * test_round_i.mjs
 * ------------------------------------------------------------
 * 今回(2026-07)の3件の要望対応を検証する簡易ユニットテスト。
 *
 * 1. 「スマホ用の画面に面がおさまるようにして」→ CubeRenderer.jsの固定
 *    カメラを、canvasのアスペクト比(縦長のスマホ画面等)に応じて調整する
 *    純粋関数CameraFit.computeCameraFitの検証。
 * 2. 「AIのレベルを少し下げて」→ AI_PROFILES(AI.js)の4難易度すべてが
 *    以前より弱く調整され、かつ相対的な強さの順序は保たれていることの検証。
 * 3. 「各面の4つ角からほかの面に移動できるようにじゃなく、横壁に壊せる
 *    ブロックを設置」→ CubeStage.jsの外周(perimeter)全体が壊せるブロック
 *    になったことの詳細はtest_cube.mjs(3b/3c)で検証済みのため、ここでは
 *    関連する静的コード確認のみ行う。
 * ------------------------------------------------------------
 */
import fs from 'fs';

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

console.log('== 1. CameraFit.computeCameraFit: アスペクト比に応じたカメラ調整 ==');
{
  const { computeCameraFit, BASE_VFOV_DEG, MAX_VFOV_DEG } = await import('./src/utils/CameraFit.js');

  check('aspect>=1(横長・正方形)では従来通りvFovDeg=BASE_VFOV_DEG、distanceScale=1', (() => {
    const wide = computeCameraFit(1.5);
    const square = computeCameraFit(1);
    return (
      wide.vFovDeg === BASE_VFOV_DEG &&
      wide.distanceScale === 1 &&
      square.vFovDeg === BASE_VFOV_DEG &&
      square.distanceScale === 1
    );
  })());

  check('aspect<1(縦長)ではvFovDegがBASE_VFOV_DEGより大きくなる(横方向の視野を確保するため)', (() => {
    const r = computeCameraFit(0.7);
    return r.vFovDeg > BASE_VFOV_DEG;
  })());

  check('aspectが小さくなるほどvFovDegは単調に(MAX_VFOV_DEGまで)増加する', (() => {
    const aspects = [0.9, 0.7, 0.5, 0.35];
    const fovs = aspects.map((a) => computeCameraFit(a).vFovDeg);
    return fovs.every((v, i) => i === 0 || v >= fovs[i - 1]);
  })());

  check('vFovDegはどのaspectでもMAX_VFOV_DEGを超えない', (() => {
    const aspects = [0.9, 0.7, 0.5, 0.35, 0.2, 0.05, 0.001];
    return aspects.every((a) => computeCameraFit(a).vFovDeg <= MAX_VFOV_DEG + 1e-9);
  })());

  check('vFovDegがMAX_VFOV_DEGに達する程度まで縦長になるとdistanceScaleが1より大きくなる(カメラを後ろに下げて補う)', (() => {
    const r = computeCameraFit(0.05);
    return r.vFovDeg === MAX_VFOV_DEG && r.distanceScale > 1;
  })());

  check('distanceScaleは常に1以上(カメラが基準位置より手前に寄ることはない)', (() => {
    const aspects = [2, 1, 0.8, 0.5, 0.2, 0.01];
    return aspects.every((a) => computeCameraFit(a).distanceScale >= 1);
  })());

  check('aspectが小さくなるほどdistanceScaleは単調に増加する(1未満の領域)', (() => {
    const aspects = [0.3, 0.2, 0.1, 0.05, 0.01];
    const scales = aspects.map((a) => computeCameraFit(a).distanceScale);
    return scales.every((v, i) => i === 0 || v >= scales[i - 1]);
  })());

  check('不正な値(0、負数、NaN)を渡してもaspect=1相当として安全にフォールバックする', (() => {
    const zero = computeCameraFit(0);
    const negative = computeCameraFit(-1);
    const nan = computeCameraFit(NaN);
    return (
      zero.vFovDeg === BASE_VFOV_DEG &&
      negative.vFovDeg === BASE_VFOV_DEG &&
      nan.vFovDeg === BASE_VFOV_DEG
    );
  })());

  // 実際にスマホでよく起きる値(右側HUDパネル96px分を差し引いた縦長の
  // 3D描画領域、例: 294x844)で、横方向に見える絶対範囲(ワールド単位)が
  // 極端に狭くならないことを幾何学的に検証する。カメラが原点からdistanceだけ
  // 離れているとき、横方向に見える範囲の半分 = distance × tan(vFov/2) ×
  // aspect となる(distanceScaleが1より大きい=カメラを後ろに下げている分は、
  // 角度(視野角)としては変わらなくても、実際に見える絶対範囲は距離に比例
  // して広がるため、CAM_DISTANCEに対する比較ではdistanceScaleも掛ける必要が
  // ある)。aspect=1・distanceScale=1のときの基準値と同等以上になっている
  // ことを確認する。
  check(
    'スマホでよくある極端に縦長のaspect(294/844)でも、横方向に見える絶対範囲がaspect=1の基準と同等以上に確保される',
    (() => {
      const baseVFovRad = (BASE_VFOV_DEG * Math.PI) / 180;
      const baselineHalfWidth = Math.tan(baseVFovRad / 2); // CAM_DISTANCE=1相当での基準(横方向=縦方向)
      const aspect = 294 / 844;
      const { vFovDeg, distanceScale } = computeCameraFit(aspect);
      const vFovRad = (vFovDeg * Math.PI) / 180;
      const actualHalfWidth = distanceScale * Math.tan(vFovRad / 2) * aspect;
      return actualHalfWidth >= baselineHalfWidth - 1e-9;
    })()
  );
}

console.log();
console.log('== 2. CubeRenderer.js: resize()がCameraFitを使ってカメラを調整している(静的確認) ==');
{
  const src = fs.readFileSync('src/systems/CubeRenderer.js', 'utf8');
  check('CameraFit.jsをimportしている', /import\s*\{\s*computeCameraFit\s*\}\s*from\s*['"]\.\.\/utils\/CameraFit\.js['"]/.test(src));
  check('resize()内でcomputeCameraFitを呼んでいる', /computeCameraFit\(this\.camera\.aspect\)/.test(src));
  check('resize()内でcamera.fovを更新している', /this\.camera\.fov\s*=\s*vFovDeg/.test(src));
  check(
    '_setupFixedCamera()でカメラの向き(_camDirUnit)を保持し、resize()側で距離をその向きに沿って変えている',
    /this\._camDirUnit\s*=\s*c\.clone\(\)/.test(src) &&
      /this\.camera\.position\.copy\(this\._camDirUnit\)\.multiplyScalar\(CAM_DISTANCE \* distanceScale\)/.test(src)
  );
  {
    const { execSync } = await import('child_process');
    let syntaxOk = true;
    try {
      execSync('node --check src/systems/CubeRenderer.js', { stdio: 'pipe' });
    } catch {
      syntaxOk = false;
    }
    check('src/systems/CubeRenderer.jsが構文エラー無くパースできる', syntaxOk);
  }
}

console.log();
console.log('== 3. AI.js: AIのレベルが少し下がっている(全難易度)==');
{
  const { AI } = await import('./src/objects/AI.js');
  const { AI_DIFFICULTY } = await import('./src/constants/GameConstants.js');
  const fakePlayer = { isAlive: true, isMoving: false, col: 1, row: 1, canPassSoftBlock: false, canKickBombs: false };

  // 旧(修正前)のプロファイル値。今回、全難易度でAIを少し弱める方向に
  // 調整したため、新しい値は「反応が少し遅く(decisionIntervalMsが増加)、
  // ミスが少し増え(mistakeChanceが増加)、積極性が少し下がる
  // (bombChance/killShotChance/chaseChanceが減少)」という関係になって
  // いるはず。
  const OLD_PROFILES = {
    [AI_DIFFICULTY.EASY]: { decisionIntervalMs: 500, mistakeChance: 0.2, bombChance: 0.35, killShotChance: 0.5, chaseChance: 0.3 },
    [AI_DIFFICULTY.NORMAL]: { decisionIntervalMs: 350, mistakeChance: 0.1, bombChance: 0.55, killShotChance: 0.7, chaseChance: 0.55 },
    [AI_DIFFICULTY.HARD]: { decisionIntervalMs: 220, mistakeChance: 0.04, bombChance: 0.7, killShotChance: 0.85, chaseChance: 0.75 },
    [AI_DIFFICULTY.EXPERT]: { decisionIntervalMs: 120, mistakeChance: 0.01, bombChance: 0.85, killShotChance: 0.97, chaseChance: 0.9 },
  };

  for (const difficulty of Object.values(AI_DIFFICULTY)) {
    const ai = new AI(fakePlayer, difficulty);
    const oldP = OLD_PROFILES[difficulty];
    const newP = ai.profile;

    check(`${difficulty}: 判断間隔(decisionIntervalMs)が以前より延びている(反応が少し遅く)`, newP.decisionIntervalMs > oldP.decisionIntervalMs);
    check(`${difficulty}: mistakeChanceが以前より増えている(ミスが少し増える)`, newP.mistakeChance > oldP.mistakeChance);
    check(`${difficulty}: bombChanceが以前より減っている(積極性が少し下がる)`, newP.bombChance < oldP.bombChance);
    check(`${difficulty}: killShotChanceが以前より減っている`, newP.killShotChance < oldP.killShotChance);
    check(`${difficulty}: chaseChanceが以前より減っている`, newP.chaseChance < oldP.chaseChance);
  }

  // 難易度間の相対的な強さの順序(EASY<NORMAL<HARD<EXPERT)が調整後も
  // 保たれていることを確認する(順序が崩れると「難易度選択」自体の意味が
  // 無くなってしまうため)。
  const order = [AI_DIFFICULTY.EASY, AI_DIFFICULTY.NORMAL, AI_DIFFICULTY.HARD, AI_DIFFICULTY.EXPERT];
  const profiles = order.map((d) => new AI(fakePlayer, d).profile);
  check(
    '調整後もdecisionIntervalMsはEASY>NORMAL>HARD>EXPERTの順で短くなる(難易度が上がるほど反応が速い)',
    profiles.every((p, i) => i === 0 || p.decisionIntervalMs < profiles[i - 1].decisionIntervalMs)
  );
  check(
    '調整後もbombChanceはEASY<NORMAL<HARD<EXPERTの順で高くなる(難易度が上がるほど積極的)',
    profiles.every((p, i) => i === 0 || p.bombChance > profiles[i - 1].bombChance)
  );
  check(
    '調整後もkillShotChanceはEASY<NORMAL<HARD<EXPERTの順で高くなる',
    profiles.every((p, i) => i === 0 || p.killShotChance > profiles[i - 1].killShotChance)
  );
  check(
    '調整後もchaseChanceはEASY<NORMAL<HARD<EXPERTの順で高くなる',
    profiles.every((p, i) => i === 0 || p.chaseChance > profiles[i - 1].chaseChance)
  );
  check(
    '調整後もmistakeChanceはEASY>NORMAL>HARD>EXPERTの順で低くなる(難易度が上がるほどミスが減る)',
    profiles.every((p, i) => i === 0 || p.mistakeChance < profiles[i - 1].mistakeChance)
  );
}

console.log();
console.log('== 4. CubeStage.js: 横壁への対応が静的にも確認できる ==');
{
  // 詳細な挙動検証(外周全体がSOFTになっている・辺の途中からも面をまた
  // げる・連動破壊が働く等)はtest_cube.mjsの3b/3cで実施済み。ここでは
  // 「4つ角限定」だった古いハードコードの一覧(_notchList)が完全に
  // 置き換えられ、汎用的な外周判定ロジックに変わったことのみ静的に確認する。
  const src = fs.readFileSync('src/objects/CubeStage.js', 'utf8');
  // 古い識別子名は「以前は_notchListを使っていたが〜」のような説明コメント内
  // には残しているため、実際のフィールド代入(`this._notchList =`等)や
  // メソッド定義(`_openFaceCorners(`)が無くなっていることだけを確認する。
  check('古いthis._notchList代入は残っていない(四隅+approachマスのハードコード一覧を撤廃済み)', !/this\._notchList\s*=/.test(src));
  check('古いthis._notchByKey代入は残っていない', !/this\._notchByKey\s*=/.test(src));
  check('古い_openFaceCornersメソッド定義は残っていない(_openFaceWallsに置き換え済み)', !/_openFaceCorners\(stage\)\s*\{/.test(src));
  check('外周全体を判定する_isPerimeterCellが存在する', /_isPerimeterCell\(col, row\)/.test(src));
  check('外周セルの面またぎ方向を判定する_crossDirsForCellが存在する', /_crossDirsForCell\(col, row\)/.test(src));
  // 【2026-07再修正】「端も全て他のマスと一緒にしてほしい」への対応で
  // _openFaceWalls(外周を強制的に壊せるブロックへ上書きする処理)自体を
  // 撤廃したため、その存在確認は「無くなっていること」の確認に変わった。
  // 詳細はtest_cube.mjsの3b/3cを参照。
  check('_openFaceWallsは撤廃され、外周も通常のstage.generate()だけで生成される', !/_openFaceWalls\(/.test(src));
}

console.log();
console.log(`合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
