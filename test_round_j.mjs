/**
 * test_round_j.mjs
 * ------------------------------------------------------------
 * 今回(2026-07)の6件の要望対応を検証する簡易ユニットテスト。
 *
 * 1. 「壊せないブロックを1マスあけて全マスにおいてほしい」→ Stage.jsの
 *    柱パターン(col・rowが共に偶数のマスのみ)が、外周も含め全マスに
 *    一様に適用され、かつ隣接する柱同士が前後左右斜め(8方向)いずれにも
 *    隙間なく並ばないこと、開始地点は必ず空白になることの検証
 *    (2026-07再修正: チェッカーボード((col+row)%2===0)は柱同士が斜めに
 *    隙間なく連続してしまう不具合があったため、8方向すべてに1マス以上の
 *    隙間ができる伝統的な配置に戻し、あわせて外周の特別扱いも撤廃した)。
 * 2. 「VRMで入れたキャラを動かしたとき手足を振るようにしてほしい」→
 *    VRMSystem.renderSnapshotSet/tintSnapshotSetの戻り値がidle/walkA/walkB
 *    の3ポーズを持つ入れ子構造になったこと、CubeRenderer.jsが
 *    player.isMovingに応じてポーズを切り替えるコードを持つことの静的確認。
 * 3. 「制限時間が過ぎたらサドンデスで爆弾が降る」→ BattleSystem.suddenDeath
 *    とGameScene._spawnSuddenDeathBombs等の存在・連携の検証
 *    (BattleSystem自体の詳細な状態遷移はtest_phase2.mjsで検証済み)。
 * 4. 「プレイヤーが負けたら終わりにしてほしい」→ GameSceneがBattleSystemへ
 *    humanPlayersを渡していることの検証(判定ロジック自体はtest_phase2.mjs
 *    4-2b/4-2cで検証済み)。
 * 5. 「トップ画面.pngをトップ画面にしてほしい」→ 画像アセットの存在と
 *    TitleScene.jsがそれを読み込み・表示するコードを持つことの検証。
 * 6. 「爆弾.pngを爆弾にしてほしい」→ 画像アセットの存在とCubeRenderer.jsが
 *    それを読み込み、addBomb()で使用するコードを持つことの検証。
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

console.log('== 1. 壊せないブロックの配置(Stage.js) ==');
{
  const { Stage, buildStartCandidates } = await import('./src/objects/Stage.js');
  const { BLOCK_TYPES } = await import('./src/constants/GameConstants.js');

  const stage = new Stage(11, 11);
  stage.generate(1);
  const starts = new Set(stage.getStartPositions().map((p) => `${p.col},${p.row}`));

  check(
    '全マス(外周含む)について、柱(col・rowが共に偶数)のマスだけがHARDになっている(開始地点を除く)',
    (() => {
      for (let row = 0; row < 11; row++) {
        for (let col = 0; col < 11; col++) {
          if (starts.has(`${col},${row}`)) continue; // 開始地点は安全地帯化で強制的にEMPTYになる
          const shouldBePillar = col % 2 === 0 && row % 2 === 0;
          const isHard = stage.getBlockType(col, row) === BLOCK_TYPES.HARD;
          if (shouldBePillar !== isHard) return false;
        }
      }
      return true;
    })()
  );

  check(
    '柱同士は前後左右斜め(8方向)いずれにも隣接しない(必ず1マス以上の隙間がある)',
    (() => {
      for (let row = 0; row < 11; row++) {
        for (let col = 0; col < 11; col++) {
          if (!(col % 2 === 0 && row % 2 === 0)) continue;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = row + dr;
              const nc = col + dc;
              if (nr < 0 || nr >= 11 || nc < 0 || nc >= 11) continue;
              if (nc % 2 === 0 && nr % 2 === 0) return false;
            }
          }
        }
      }
      return true;
    })()
  );

  check('実際に使われた開始地点は(柱パターンに関わらず)必ずEMPTYになっている', (() => {
    return stage.getStartPositions().every((p) => stage.getBlockType(p.col, p.row) === BLOCK_TYPES.EMPTY);
  })());

  check('全ての開始候補地点(6人分)についても、それぞれを開始地点として生成すれば必ずEMPTYになる', (() => {
    return buildStartCandidates(11, 11).every((_, i) => {
      const s2 = new Stage(11, 11);
      s2.generate(i + 1);
      return s2.getStartPositions().every((p) => s2.getBlockType(p.col, p.row) === BLOCK_TYPES.EMPTY);
    });
  })());

  check(
    '端(外周)も内側と同じ柱判定ルールに従う(四隅(0,0)等はcol・rowが共に偶数=柱なので常にHARD)',
    stage.getBlockType(0, 0) === BLOCK_TYPES.HARD && stage.getBlockType(10, 10) === BLOCK_TYPES.HARD
  );
  check(
    '外周でも柱でない座標(奇数側)はHARDに固定されない(内側と同じくランダムなEMPTY/SOFT/ITEMになりうる)',
    stage.getBlockType(1, 0) !== BLOCK_TYPES.HARD
  );
}

console.log('\n== 2. VRM歩行ポーズ(手足の振り)対応 ==');
{
  const vrmSrc = fs.readFileSync('src/systems/VRMSystem.js', 'utf8');
  check('renderSnapshotSetがidle/walkA/walkBの3ポーズを描画している', /WALK_POSES/.test(vrmSrc) && /walkA/.test(vrmSrc) && /walkB/.test(vrmSrc));
  check('腕(UpperArm)・脚(UpperLeg)のボーンを取得している', /leftUpperArm/.test(vrmSrc) && /rightUpperLeg/.test(vrmSrc));
  check('ポーズ描画後にニュートラル姿勢へ戻している(次の方向への影響防止)', /applyWalkPose\(null\)/.test(vrmSrc));
  check('tintSnapshotSetが入れ子構造(facing->pose)を正しく処理している', /for \(const \[poseName, srcCanvas\] of Object\.entries\(poses\)\)/.test(vrmSrc));

  const rendererSrc = fs.readFileSync('src/systems/CubeRenderer.js', 'utf8');
  check('CubeRenderer.syncPlayersがplayer.isMovingに応じてwalkA/walkBを切り替えている', /player\.isMoving \? \(progress < 0\.5 \? 'walkA' : 'walkB'\) : 'idle'/.test(rendererSrc));
  check('CubeRenderer._createPlayerMesh/setPlayerTexturesがtextureSet.down.idleを参照している(新構造への対応)', /textureSet\.down\?\.idle/.test(rendererSrc));

  const gameSceneSrc = fs.readFileSync('src/scenes/GameScene.js', 'utf8');
  check('GameScene._loadAllVrmAppearancesが新しい入れ子構造からテクスチャセットを構築している(buildTextureSet)', /buildTextureSet/.test(gameSceneSrc));
}

console.log('\n== 3. サドンデス(制限時間切れ後の爆弾降らせ)対応 ==');
{
  const battleSrc = fs.readFileSync('src/systems/BattleSystem.js', 'utf8');
  check('BattleSystemがsuddenDeathフラグを持ち、時間切れ時にはisOverではなくこのフラグのみを立てる', /this\.suddenDeath = true/.test(battleSrc) && !/timeLimitMs[\s\S]{0,40}_finish/.test(battleSrc));

  const constSrc = fs.readFileSync('src/constants/GameConstants.js', 'utf8');
  check('SUDDEN_DEATH_BOMB_INTERVAL_MS / SUDDEN_DEATH_BOMBS_PER_WAVE / SUDDEN_DEATH_BLAST_RANGEが定義されている', (() => {
    return (
      /export const SUDDEN_DEATH_BOMB_INTERVAL_MS/.test(constSrc) &&
      /export const SUDDEN_DEATH_BOMBS_PER_WAVE/.test(constSrc) &&
      /export const SUDDEN_DEATH_BLAST_RANGE/.test(constSrc)
    );
  })());

  const gameSceneSrc = fs.readFileSync('src/scenes/GameScene.js', 'utf8');
  check('GameSceneが_updateSuddenDeathBombRain/_spawnSuddenDeathBombs/_trySpawnEnvironmentBombを持つ', (() => {
    return (
      /_updateSuddenDeathBombRain\(time\)/.test(gameSceneSrc) &&
      /_spawnSuddenDeathBombs\(\)/.test(gameSceneSrc) &&
      /_trySpawnEnvironmentBomb\(face\)/.test(gameSceneSrc)
    );
  })());
  check('update()ループ内でbattleSystem.update()の直後に_updateSuddenDeathBombRainを呼んでいる', /this\.battleSystem\.update\(delta\);\s*\n\s*this\._updateSuddenDeathBombRain\(time\);/.test(gameSceneSrc));
  check('環境爆弾はownerId: nullで生成される(誰かの所持数を消費しない)', /ownerId: null,\s*\n\s*blastRange: SUDDEN_DEATH_BLAST_RANGE/.test(gameSceneSrc));
}

console.log('\n== 4. 「プレイヤーが負けたら終わりにしてほしい」対応 ==');
{
  const gameSceneSrc = fs.readFileSync('src/scenes/GameScene.js', 'utf8');
  check('new BattleSystem(...)にhumanPlayers: this.humanPlayersを渡している', /new BattleSystem\(this\.players, \{\s*\n\s*timeLimitMs: this\.config\.timeLimitMs,\s*\n\s*humanPlayers: this\.humanPlayers,/.test(gameSceneSrc));
}

console.log('\n== 5. トップ画面.pngをタイトル画面に使用 ==');
{
  check('assets/images/title/title_logo.pngが存在する', fs.existsSync('assets/images/title/title_logo.png'));
  check('title_logo.pngが空でない有効なファイルサイズを持つ', fs.statSync('assets/images/title/title_logo.png').size > 1000);

  const titleSrc = fs.readFileSync('src/scenes/TitleScene.js', 'utf8');
  check('TitleSceneがpreload()でtitleLogo画像を読み込んでいる', /this\.load\.image\(TITLE_LOGO_KEY, TITLE_LOGO_PATH\)/.test(titleSrc));
  check('TitleScene.create()内でロゴ画像を表示している(画像優先、失敗時はテキストへフォールバック)', /this\.textures\.exists\(TITLE_LOGO_KEY\)/.test(titleSrc) && /this\.add\.image\(centerX, centerY, TITLE_LOGO_KEY\)/.test(titleSrc));
}

console.log('\n== 5b. 「トップ画面全体に画像表示させてほしい」「選択項目は見やすくしてほしい」対応 ==');
{
  const titleSrc = fs.readFileSync('src/scenes/TitleScene.js', 'utf8');
  check(
    'ロゴ画像を画面いっぱいに拡大するcover方式のスケール計算がある',
    /Math\.max\(this\.scale\.width \/ bg\.width, this\.scale\.height \/ bg\.height\)/.test(titleSrc),
  );
  check('背景画像の上に半透明の暗幕(コントラスト確保用)を重ねている', /this\.add\.rectangle\(centerX, centerY, this\.scale\.width, this\.scale\.height, 0x000000/.test(titleSrc));
  check('メニュー項目の背後に読みやすさ用の半透明パネルを敷いている', /panelWidth, panelBottom - panelTop, 0x000000/.test(titleSrc));
  check(
    '_createMenuButtonが不透明な背景色と縁取り(stroke)で視認性を高めている',
    /idleBg = 'rgba\(35,35,40,0\.88\)'/.test(titleSrc) && /strokeThickness: disabled \? 0 : 2/.test(titleSrc),
  );
}

console.log('\n== 6. 爆弾.pngをゲーム内の爆弾表示に使用 ==');
{
  check('assets/images/bomb/bomb.pngが存在する', fs.existsSync('assets/images/bomb/bomb.png'));
  check('bomb.pngが空でない有効なファイルサイズを持つ', fs.statSync('assets/images/bomb/bomb.png').size > 1000);

  const rendererSrc = fs.readFileSync('src/systems/CubeRenderer.js', 'utf8');
  check('CubeRenderer.init()がbomb.pngテクスチャを読み込んでいる(TextureLoader)', /BOMB_TEXTURE_PATH/.test(rendererSrc) && /TextureLoader\(\)\.loadAsync\(BOMB_TEXTURE_PATH\)/.test(rendererSrc));
  check('addBomb()がbombTexture読込成功時はテクスチャ付き平面を、失敗時は従来の球体にフォールバックする', /if \(this\._bombTexture\) \{/.test(rendererSrc) && /従来フォールバック/.test(rendererSrc));
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
