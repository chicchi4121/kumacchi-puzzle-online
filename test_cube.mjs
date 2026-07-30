/**
 * test_cube.mjs
 * ------------------------------------------------------------
 * サイコロ状(立方体)6面ステージのトポロジー(CubeTopology.js)と
 * CubeStage.jsに対する簡易ユニットテスト。
 * 面と面のつながり・座標変換は純粋なロジックなので、Three.js/Phaser
 * いずれにも依存せずNode上で完全に検証できる。
 * ------------------------------------------------------------
 */
class FakeScene {}
globalThis.Phaser = {
  Scene: FakeScene,
  AUTO: 'AUTO',
  Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
  Input: { Keyboard: { KeyCodes: { SPACE: 'SPACE', ESC: 'ESC' } } },
};

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

const { CROSSING_TABLE, OPPOSITE_EDGE, FACE_AXES, faceLocalToWorld } = await import('./src/constants/CubeTopology.js');
const { CubeStage } = await import('./src/objects/CubeStage.js');
const { CUBE_FACE_NAMES } = await import('./src/constants/GameConstants.js');

console.log('== 1. CROSSING_TABLEの整合性(双方向性) ==');
{
  let ok = true;
  for (const f of CUBE_FACE_NAMES) {
    for (const e of ['up', 'down', 'left', 'right']) {
      const t = CROSSING_TABLE[f][e];
      const back = CROSSING_TABLE[t.toFace][t.viaEdge];
      if (back.toFace !== f || back.viaEdge !== e || back.varReversed !== t.varReversed) ok = false;
      if (t.newFacing !== OPPOSITE_EDGE[t.viaEdge]) ok = false;
    }
  }
  check('全24通りの辺で行き来が矛盾なく対応している', ok);
}

console.log('\n== 2. FACE_AXESの直交性(各面のN/R/Dが単位直交ベクトルになっている) ==');
{
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.sqrt(dot(a, a));
  let ok = true;
  for (const f of CUBE_FACE_NAMES) {
    const { N, R, D } = FACE_AXES[f];
    if (Math.abs(len(N) - 1) > 1e-9 || Math.abs(len(R) - 1) > 1e-9 || Math.abs(len(D) - 1) > 1e-9) ok = false;
    if (Math.abs(dot(N, R)) > 1e-9 || Math.abs(dot(N, D)) > 1e-9 || Math.abs(dot(R, D)) > 1e-9) ok = false;
  }
  check('6面すべてでN・R・Dが単位直交ベクトルになっている', ok);
}

console.log('\n== 3. CubeStage.generate() ==');
{
  const cube = new CubeStage(11, 11);
  cube.generate(6);
  check('6面すべてが生成される', CUBE_FACE_NAMES.every((f) => cube.getFaceStage(f)));
  check('開始地点が参加人数ぶん(6)生成される', cube.getStartPositions().length === 6);
  const centerCol = Math.floor(11 / 2);
  const centerRow = Math.floor(11 / 2);
  check(
    '各面の中央が通行可能(安全地帯)になっている',
    CUBE_FACE_NAMES.every((f) => cube.isWalkable(f, centerCol, centerRow))
  );
  check(
    '開始地点は各面の中央に1つずつ設定されている',
    cube.getStartPositions().every((p) => p.col === centerCol && p.row === centerRow)
  );
}

console.log('\n== 3b. CubeStage.generate(): 面の外周(横壁含む)も内側と同じ柱判定・ランダム配置ルールに従う ==');
{
  // 【2026-07再修正】「壊せないブロックは前後左右斜めも1マス空けないと
  // 移動できない。端も全て他のマスと一緒にしてほしい」という要望への
  // 対応で、以前は外周(perimeter)全体を強制的にSOFT(壊せるブロック)へ
  // 上書きしていたが、その特別扱いを撤廃し、外周も内側と全く同じ柱判定
  // (col・rowが共に偶数のマスのみHARD)・ランダム配置ロジックに従う
  // ようにした。
  const { BLOCK_TYPES } = await import('./src/constants/GameConstants.js');
  const cube = new CubeStage(11, 11);
  cube.generate(6);

  function isPerimeter(stage, col, row) {
    return col === 0 || row === 0 || col === stage.cols - 1 || row === stage.rows - 1;
  }

  let perimeterFollowsPillarRule = true;
  for (const f of CUBE_FACE_NAMES) {
    const stage = cube.getFaceStage(f);
    for (let row = 0; row < stage.rows; row++) {
      for (let col = 0; col < stage.cols; col++) {
        if (!isPerimeter(stage, col, row)) continue;
        const shouldBePillar = col % 2 === 0 && row % 2 === 0;
        const isHard = stage.getBlockType(col, row) === BLOCK_TYPES.HARD;
        if (shouldBePillar !== isHard) perimeterFollowsPillarRule = false;
      }
    }
  }
  check(
    '6面すべての外周(四隅+横壁)が柱判定ルール通りになっている(柱(col・rowが共に偶数)以外はHARDにならない)',
    perimeterFollowsPillarRule
  );

  // 辺の途中(隅ではない横壁のマス)を実際に壊すと、その場に立てるように
  // なり、面の外へ移動すると隣接面へ渡れることを確認する。生成時の
  // ランダム性を排除するため、対象マス(柱にならない奇数座標)を
  // setBlockTypeで確定的にSOFTへ設定してから検証する。
  const midStage = cube.getFaceStage('FRONT');
  const midCol = Math.floor(midStage.cols / 2); // 奇数(=柱にはならない座標)
  midStage.setBlockType(midCol, 0, BLOCK_TYPES.SOFT);
  check('辺の途中(横壁)のマスは壊す前は通行不可', !midStage.isWalkable(midCol, 0));
  midStage.breakBlock(midCol, 0);
  check('辺の途中(横壁)のマスを壊すと歩いて立てるようになる', midStage.isWalkable(midCol, 0));
  const viaMidWall = cube.resolveMove('FRONT', midCol, 0, 'up');
  check(
    '辺の途中(横壁)のマスに立った状態から面の外へ移動すると隣接面へ渡れる',
    viaMidWall && viaMidWall.crossed === true && viaMidWall.face !== 'FRONT'
  );

  // 【重要】四隅(0,0)等はcol・rowが共に偶数のため柱の条件に一致し、今回の
  // 対応により常にHARD(壊せない)になった。これは「端も他のマスと一緒に
  // してほしい」という要望どおりの挙動であり、不具合ではない
  // (実際のプレイでは四隅そのものではなく、その付近の柱でないマスを
  // 壊して面をまたぐことになる)。resolveMove()自体は座標変換のみを行う
  // 純粋関数で壁の種類を見ないため、「四隅は2方向にまたげる」という
  // 座標変換ロジック自体が正しいことは、下のgetMirrorCellsの検証で
  // (実際に壊せるかどうかとは切り離して)確認する。
}

console.log('\n== 3c. getMirrorCells: 外周マス(四隅・横壁とも)を壊すと隣接面の対応マスも連動して壊せる ==');
{
  // 不具合修正の確認: 外周マスを開放しただけでは、面をまたいだ先
  // (隣接面)の対応マスがSOFTのまま残り、爆風が面をまたがない設計上そちら
  // は絶対に壊せず、👻無しでは足を踏み入れることもできず、結果的に
  // 「その面から一切移動できない」デッドロックになってしまっていた。
  // getMirrorCellsが返す隣接面の対応マスも連動して破壊することで解消する。
  // なお、getMirrorCells自体は座標のみに基づく純粋な幾何学判定であり、
  // 実際にそのマスが壊せるか(柱/HARDかどうか)には依存しないため、四隅
  // (0,0)が今回の対応で常にHARD(壊せない)になったこととは無関係に検証できる。
  const { BLOCK_TYPES } = await import('./src/constants/GameConstants.js');
  const cube = new CubeStage(11, 11);
  cube.generate(6);

  // 内側のマス(外周以外)ではミラーは無い
  check('内側のマスにはミラーが無い', cube.getMirrorCells('FRONT', 5, 5).length === 0);

  // 隅マス(0,0)は2方向(up/left)にまたぐため、ミラーが2つ返る
  const cornerMirrors = cube.getMirrorCells('FRONT', 0, 0);
  check('隅マスのミラーは2つ(up方向・left方向それぞれの隣接面)', cornerMirrors.length === 2);
  check(
    '隅マスのミラーは2つとも異なる面である',
    cornerMirrors.length === 2 && cornerMirrors[0].face !== cornerMirrors[1].face
  );
  check(
    '隅マスのミラー先も、その面自身の外周(四隅・横壁いずれか)に含まれる(対称性)',
    cornerMirrors.every((m) => {
      const mStage = cube.getFaceStage(m.face);
      const isBorder = m.col === 0 || m.row === 0 || m.col === mStage.cols - 1 || m.row === mStage.rows - 1;
      return isBorder;
    })
  );

  // approachマス(1,0、隅の隣)は1方向(up)のみなので、ミラーは1つ
  const approachMirrors = cube.getMirrorCells('FRONT', 1, 0);
  check('approachマスのミラーは1つ', approachMirrors.length === 1);

  // 辺の途中(隅から離れた横壁のマス)も1方向のみなので、ミラーは1つ
  const midStageForMirror = cube.getFaceStage('FRONT');
  const midColForMirror = Math.floor(midStageForMirror.cols / 2); // 奇数(=柱にはならない座標)
  const midWallMirrors = cube.getMirrorCells('FRONT', midColForMirror, 0);
  check('辺の途中(横壁)のマスのミラーは1つ', midWallMirrors.length === 1);
  check(
    '辺の途中(横壁)のミラー先も隣接面の外周上にある',
    midWallMirrors.every((m) => {
      const mStage = cube.getFaceStage(m.face);
      return m.col === 0 || m.row === 0 || m.col === mStage.cols - 1 || m.row === mStage.rows - 1;
    })
  );

  // 実際に爆弾で面の横壁を壊すシミュレーション: GameSceneの
  // _onBombDetonateと同じ処理(breakBlock + getMirrorCellsで連動破壊)を
  // 模して、隣接面側が本当にSOFTのままだと通行不可 → 連動破壊後は
  // 通行可能になることを確認する。破壊対象は柱にならない座標(横壁の
  // 中間)を選び、生成時のランダム性を排除するためsetBlockTypeで
  // 確定的にSOFTへ設定しておく(四隅(0,0)は柱の条件に一致し常にHARDに
  // なったため、このシミュレーションの対象には使わない)。
  const frontStage2 = cube.getFaceStage('FRONT');
  const midColForBreak = Math.floor(frontStage2.cols / 2);
  frontStage2.setBlockType(midColForBreak, 0, BLOCK_TYPES.SOFT);
  const beforeMirrors = cube.getMirrorCells('FRONT', midColForBreak, 0);
  check('横壁の破壊対象マスのミラーは1つ', beforeMirrors.length === 1);
  for (const m of beforeMirrors) {
    const mStage = cube.getFaceStage(m.face);
    mStage.setBlockType(m.col, m.row, BLOCK_TYPES.SOFT); // 生成時のランダム性を排除し確定的にSOFTにしておく
    check(
      `連動破壊前: 隣接面(${m.face})の対応マスはまだSOFTで通行不可`,
      mStage.getBlockType(m.col, m.row) === BLOCK_TYPES.SOFT && !mStage.isWalkable(m.col, m.row)
    );
  }
  frontStage2.breakBlock(midColForBreak, 0); // FRONTの横壁マスを破壊
  for (const m of beforeMirrors) {
    const mResult = cube.breakBlock(m.face, m.col, m.row); // GameSceneが呼ぶのと同じ連動破壊
    check(`連動破壊: 隣接面(${m.face})の対応マスも破壊できる`, mResult.destroyed === true);
    const mStage = cube.getFaceStage(m.face);
    check(`連動破壊後: 隣接面(${m.face})の対応マスは通行可能になる`, mStage.isWalkable(m.col, m.row));
  }
}

console.log('\n== 3d. CubeStage.generate(): PVP(人間2人以上)は同じ面に集まってスタートする ==');
{
  // humanCount<=1(従来のAI対戦モード)は完全に元の挙動のまま(1人1面)であること、
  // humanCount>=2(PVP)は人間プレイヤー全員が同じ面(先頭の面)の別々の安全地帯から
  // スタートし、残りのAIが別の面に1人ずつ配置されることを確認する。
  const centerCol = Math.floor(11 / 2);
  const centerRow = Math.floor(11 / 2);

  // humanCount=1(デフォルト): 従来通り1人1面
  {
    const cube = new CubeStage(11, 11);
    cube.generate(4, 1);
    check(
      'humanCount=1なら従来通り参加者ごとに別々の面(4面)に配置される',
      new Set(cube.getStartPositions().map((p) => p.face)).size === 4
    );
    check(
      'humanCount=1なら開始地点は各面の中央のまま',
      cube.getStartPositions().every((p) => p.col === centerCol && p.row === centerRow)
    );
  }

  // humanCount=3, playerCount=5: 人間3人が同じ面に、AI2人が残りの面に
  {
    const cube = new CubeStage(11, 11);
    cube.generate(5, 3);
    const positions = cube.getStartPositions();
    check('開始地点の総数は参加人数ぶん(5)', positions.length === 5);

    const homeFace = CUBE_FACE_NAMES[0];
    const humanPositions = positions.slice(0, 3);
    const aiPositions = positions.slice(3);

    check(
      '人間プレイヤー3人は全員同じ面(先頭の面)からスタートする',
      humanPositions.every((p) => p.face === homeFace)
    );
    check(
      '人間プレイヤー3人はそれぞれ別々のマスからスタートする(重ならない)',
      new Set(humanPositions.map((p) => `${p.col},${p.row}`)).size === 3
    );
    check(
      '人間プレイヤーの開始マスはすべて通行可能(安全地帯)',
      humanPositions.every((p) => cube.isWalkable(p.face, p.col, p.row))
    );
    check(
      'AI2人は人間と同じ面(先頭の面)には配置されず、それぞれ別の面に配置される',
      aiPositions.every((p) => p.face !== homeFace) && new Set(aiPositions.map((p) => p.face)).size === 2
    );
    check(
      'AIの開始マスは各面の中央で、通行可能(安全地帯)',
      aiPositions.every((p) => p.col === centerCol && p.row === centerRow && cube.isWalkable(p.face, p.col, p.row))
    );
  }

  // humanCount=6, playerCount=6: 全員人間(AI無し)でも同じ面に収まる
  {
    const cube = new CubeStage(11, 11);
    cube.generate(6, 6);
    const positions = cube.getStartPositions();
    check('全員人間(6人)でも6箇所の開始地点が生成される', positions.length === 6);
    check(
      '全員人間なら全員同じ面からスタートする',
      positions.every((p) => p.face === CUBE_FACE_NAMES[0])
    );
    check(
      '全員人間の6箇所はそれぞれ別々のマスである(重ならない)',
      new Set(positions.map((p) => `${p.col},${p.row}`)).size === 6
    );
  }
}

console.log('\n== 4. resolveMove: 面内の通常移動 ==');
{
  const cube = new CubeStage(11, 11);
  cube.generate(1);
  const result = cube.resolveMove('FRONT', 5, 5, 'right');
  check('面の内部にとどまる移動は同じ面のまま', result.face === 'FRONT' && result.col === 6 && result.row === 5);
  check('crossedはfalse', result.crossed === false);
  check('facingは移動方向のまま', result.facing === 'right');
}

console.log('\n== 5. resolveMove: 面をまたぐ移動(1回) ==');
{
  const cube = new CubeStage(11, 11);
  cube.generate(1);
  // FRONT面の右端(col=10)から右へ出る -> RIGHT面へ
  const result = cube.resolveMove('FRONT', 10, 3, 'right');
  check('右端を超えるとRIGHT面へ移動する', result.face === 'RIGHT');
  check('crossedはtrue', result.crossed === true);
  check('RIGHT面の左端(col=0)に着地する', result.col === 0);
  check('rowは(varReversedがfalseなので)そのまま維持される', result.row === 3);
  check('着地後の向きはright', result.facing === 'right');
}

console.log('\n== 6. resolveMove: 面をまたいだ後、来た辺へ戻ると元の面・元のマスに戻る ==');
{
  // 面をまたいだ直後のnewFacingの逆方向(OPPOSITE_EDGE[crossed.facing])へ
  // さらに1歩進むと、必ず「入ってきた辺(viaEdge)」を逆向きに通ることになり、
  // 出発地点の面・マスに正確に戻る(空間的な往復の正しさを検証する)。
  // なお「向き(facing)」はグリッドキャラの一般的な仕様通り直近の移動方向を
  // そのまま反映するだけなので、往復後は「戻る際の移動方向」になるのが
  // 正しい仕様であり、出発時の向きに戻るわけではない(2D平面でも上→下と
  // 動けば同じマスに戻ってもfacingは'down'になるのと同じ)。
  const cube = new CubeStage(11, 11);
  cube.generate(1);
  let allOk = true;
  for (const startFace of CUBE_FACE_NAMES) {
    for (const dir of ['up', 'down', 'left', 'right']) {
      const col = dir === 'right' ? 10 : dir === 'left' ? 0 : 5;
      const row = dir === 'down' ? 10 : dir === 'up' ? 0 : 5;
      const crossed = cube.resolveMove(startFace, col, row, dir);
      const backDirection = OPPOSITE_EDGE[crossed.facing];
      const back = cube.resolveMove(crossed.face, crossed.col, crossed.row, backDirection);
      const roundTripOk = back.face === startFace && back.col === col && back.row === row;
      if (!roundTripOk) {
        console.log(
          `  NG  ${startFace}(${col},${row}).${dir} -> ${crossed.face}(${crossed.col},${crossed.row}) -> ${backDirection} -> ${back.face}(${back.col},${back.row}) (期待の面/マス: ${startFace}(${col},${row}))`
        );
        allOk = false;
      }
    }
  }
  check('全6面×4方向、面をまたいだ後に来た辺へ戻ると空間的に元の面・元のマスに正確に戻る', allOk);
}

console.log('\n== 7. 4面の「赤道帯」を右方向に回り続けると4回で元の面に戻る ==');
{
  const cube = new CubeStage(11, 11);
  cube.generate(1);
  let face = 'FRONT';
  let col = 10;
  let row = 5;
  const visited = [face];
  for (let i = 0; i < 4; i++) {
    const result = cube.resolveMove(face, col, row, 'right');
    face = result.face;
    col = result.col;
    row = result.row;
    if (i < 3) visited.push(face);
    if (result.crossed) {
      // 次に境界へ再度到達させるため、境界の反対側からもう一度端まで歩くのは
      // このテストでは省略し、境界に着地した直後に再度rightへ出ることで
      // 「毎回境界をまたぐ」動きを模擬する(面の横幅が1マスであるかのように扱う)
      col = 10; // 次の面でも右端にいるとみなして直ちに次の境界へ
    }
  }
  check(
    '赤道帯(FRONT→RIGHT→BACK→LEFT)を4回右へ渡ると元のFRONTに戻る',
    face === 'FRONT'
  );
  check('4回の巡回でFRONT/RIGHT/BACK/LEFTを一通り経由した', new Set(visited).size === 4);
}

console.log('\n== 8. faceLocalToWorld: 面の中心(u=0,v=0)は各面の法線方向そのもの ==');
{
  let ok = true;
  for (const f of CUBE_FACE_NAMES) {
    const [x, y, z] = faceLocalToWorld(f, 0, 0);
    const [nx, ny, nz] = FACE_AXES[f].N;
    if (Math.abs(x - nx) > 1e-9 || Math.abs(y - ny) > 1e-9 || Math.abs(z - nz) > 1e-9) ok = false;
  }
  check('各面の中心(u=0,v=0)がその面の法線ベクトルと一致する', ok);
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
