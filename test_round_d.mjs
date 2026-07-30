/**
 * test_round_d.mjs
 * ------------------------------------------------------------
 * 「プレイできなくなった」不具合の修正と、オートマッチングの
 * 人数選択/制限時間設定/AI難易度設定への対応を検証する簡易ユニット
 * テスト。
 *
 * 【背景】v16で画面レイアウトをブラウザ追従に変更した際、GameScene.jsの
 * インポートからSCREEN_WIDTH/SCREEN_HEIGHTを削除したが、_startCountdown()
 * 内の参照を書き換え忘れており、対戦開始直後(カウントダウン表示時)に
 * 必ずReferenceErrorで例外が発生し、事実上プレイ不能になっていた。
 * 同種の「importから消したのに参照だけ残る」不具合を再発検知できるよう、
 * ソースコードを静的に走査するリグレッションガードを1で用意する。
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

console.log('== 1. GameScene.js等がimportしていないSCREEN_WIDTH/SCREEN_HEIGHTをコード中で参照していないか(今回の不具合の再発防止) ==');
{
  // 画面レイアウトのブラウザ追従化(2026-07)で、GameScene.js含む複数の
  // シーンファイルはSCREEN_WIDTH/SCREEN_HEIGHTをimportから外し、
  // this.scale.width/heightやthis._layoutを使う方式に切り替えた。
  // コメント中の言及(「旧SCREEN_WIDTHではなく〜」等)は許容しつつ、
  // 実行可能なコード行の中に生の識別子として残っていないかを確認する。
  const filesExpectedToNotImportScreenConstants = [
    'src/scenes/GameScene.js',
    'src/scenes/LobbyScene.js',
    'src/scenes/PauseScene.js',
    'src/scenes/RankingScene.js',
    'src/scenes/ResultScene.js',
    'src/scenes/TitleScene.js',
  ];

  function stripCommentsAndStrings(src) {
    // ブロックコメント・行コメントを取り除く(簡易版。文字列リテラル内の
    // "//"や"/*"はテンプレートリテラル等ごく一部を除き無視できる程度の
    // 精度で十分。今回の目的は「コード中の生の識別子参照」の検出)。
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  }

  for (const file of filesExpectedToNotImportScreenConstants) {
    const src = fs.readFileSync(file, 'utf8');
    const importBlockMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/constants\/GameConstants\.js['"]/);
    const importedNames = importBlockMatch ? importBlockMatch[1].split(',').map((s) => s.trim()) : [];
    check(`${file}: GameConstants.jsからSCREEN_WIDTH/SCREEN_HEIGHTをimportしていない`, !importedNames.includes('SCREEN_WIDTH') && !importedNames.includes('SCREEN_HEIGHT'));

    const codeOnly = stripCommentsAndStrings(src);
    const hasBareScreenWidth = /\bSCREEN_WIDTH\b/.test(codeOnly);
    const hasBareScreenHeight = /\bSCREEN_HEIGHT\b/.test(codeOnly);
    check(`${file}: コード中(コメント除く)にSCREEN_WIDTHの生参照が残っていない`, !hasBareScreenWidth);
    check(`${file}: コード中(コメント除く)にSCREEN_HEIGHTの生参照が残っていない`, !hasBareScreenHeight);
  }
}

console.log('\n== 2. GameScene.jsが構文的にロード可能で、_startCountdownがthis._layoutを使っていることの確認 ==');
{
  const src = fs.readFileSync('src/scenes/GameScene.js', 'utf8');
  const startCountdownMatch = src.match(/_startCountdown\(\)\s*\{[\s\S]*?\n  \}/);
  check('_startCountdown()メソッドが見つかる', !!startCountdownMatch);
  if (startCountdownMatch) {
    const body = startCountdownMatch[0];
    check('_startCountdown()内でthis._layout.stageWidthを使っている(固定値ではなく動的なレイアウトを参照)', /this\._layout\.stageWidth/.test(body));
    check('_startCountdown()内でthis._layout.totalHeightを使っている', /this\._layout\.totalHeight/.test(body));
  }

  const { execSync } = await import('child_process');
  let syntaxOk = true;
  try {
    execSync('node --check src/scenes/GameScene.js', { stdio: 'pipe' });
  } catch {
    syntaxOk = false;
  }
  check('GameScene.jsが構文エラー無くパースできる', syntaxOk);
}

console.log('\n== 3. オートマッチングの希望人数に応じたAI補充人数の計算式 ==');
{
  const MAX_PLAYERS = 6;
  // OnlineLobbyScene._becomeAutoMatchLeaderと同じ計算式をここで再実装して検証する
  // (「最初にマッチングする人が人数選択できるようにしてほしい」への対応)。
  function computeAiCount(groupLength, desiredParticipantCount) {
    const humanCount = Math.max(1, groupLength);
    const desiredTotal = Math.max(humanCount, Math.min(MAX_PLAYERS, desiredParticipantCount));
    return { humanCount, aiCount: Math.max(0, desiredTotal - humanCount) };
  }

  check('一人だけで希望人数4を選んだ場合、AIが3人補充される(合計4人)', computeAiCount(1, 4).aiCount === 3);
  check('2人集まって希望人数4を選んだ場合、AIが2人補充される(合計4人)', computeAiCount(2, 4).aiCount === 2);
  check('希望人数ちょうどに人間が集まった場合、AIは0人', computeAiCount(4, 4).aiCount === 0);
  check('希望人数より多くの人間が集まった場合でもAIはマイナスにならない(0人)', computeAiCount(5, 4).aiCount === 0);
  check('希望人数がMAX_PLAYERSを超えて指定されてもMAX_PLAYERSまでにクランプされる', computeAiCount(1, 99).aiCount === MAX_PLAYERS - 1);
  check('一人だけで希望人数2(最小値)を選んだ場合、AIは1人だけ補充される', computeAiCount(1, 2).aiCount === 1);
}

console.log('\n== 4. OnlineLobbyScene.jsの静的チェック(不要になった定数の参照が残っていないか) ==');
{
  const src = fs.readFileSync('src/scenes/OnlineLobbyScene.js', 'utf8');
  check('AUTO_MATCH_MIN_PLAYERSを参照していない(廃止済み)', !/AUTO_MATCH_MIN_PLAYERS/.test(src));
  check('AUTO_MATCH_SOLO_AI_COUNTを参照していない(廃止済み)', !/AUTO_MATCH_SOLO_AI_COUNT/.test(src));
  check('autoMatchSettings(希望人数/AI難易度/制限時間)を保持している', /this\.autoMatchSettings\s*=/.test(src));
  check('_showAutoMatchSettingsメソッドが存在する(設定画面)', /_showAutoMatchSettings\s*\(/.test(src));
  check('_becomeAutoMatchLeader内でthis.autoMatchSettingsを参照している', /_becomeAutoMatchLeader[\s\S]{0,600}this\.autoMatchSettings/.test(src));

  const { execSync } = await import('child_process');
  let syntaxOk = true;
  try {
    execSync('node --check src/scenes/OnlineLobbyScene.js', { stdio: 'pipe' });
  } catch {
    syntaxOk = false;
  }
  check('OnlineLobbyScene.jsが構文エラー無くパースできる', syntaxOk);
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
