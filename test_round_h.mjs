/**
 * test_round_h.mjs
 * ------------------------------------------------------------
 * 今回(2026-07)の3件の修正を検証する簡易ユニットテスト。
 *
 * 1. 「参加人数を選ぶ項目の文字が大きすぎて見えなくなっている」
 *    「オートマッチングの参加人数設定の人数を選ぶ項目の文字が大きすぎて
 *    見えなくなっている」への対応(LobbyScene.js / OnlineLobbyScene.js の
 *    値表示文字列の短縮)。
 * 2. 「オートマッチング設定の文字が文字化けしている」への対応
 *    (ヒント文へのwordWrap追加、および行間レイアウトの動的化)。
 * 3. 「ファイルのオープニング.mp3をオープニング画面のBGMにしてほしい。
 *    バトルBGM.zipを対戦毎にランダムで流れるようにしてほしい」への対応
 *    (SoundSystem.jsのBGM実音源化)。
 * ------------------------------------------------------------
 */
import fs from 'fs';

// SoundSystem.js の_ensureContext()はwindow.AudioContextを参照するため、
// Node環境でも(window未定義によるReferenceErrorを避けるため)window自体は
// 用意しておく(AudioContextは未定義のままでよく、_ensureContext側で
// 非対応環境として安全にスキップされる。test_round_e/f/g.mjsと同様の手当て)。
globalThis.window = globalThis;

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

function stripCommentsAndStrings(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

console.log('== 1. LobbyScene.js: 参加人数の値表示が短縮されている(+/-ボタンとの重なり防止) ==');
{
  const src = fs.readFileSync('src/scenes/LobbyScene.js', 'utf8');
  check(
    '値表示関数が`${this.settings.participantCount}人`のみで、人間/AI内訳を含まない',
    /\(\)\s*=>\s*`\$\{this\.settings\.participantCount\}人`/.test(src)
  );
  check(
    '旧来の長い内訳文字列(人間/AI)がparticipantRowの値表示から消えている',
    !/participantCount\}人 \(人間/.test(src)
  );
}

console.log();
console.log('== 2. OnlineLobbyScene.js: 希望人数の値表示が短縮されている ==');
{
  const src = fs.readFileSync('src/scenes/OnlineLobbyScene.js', 'utf8');
  check(
    '値表示関数が`${this.autoMatchSettings.participantCount}人`のみで、AI補充の説明を含まない',
    /\(\)\s*=>\s*`\$\{this\.autoMatchSettings\.participantCount\}人`/.test(src)
  );
  check(
    '旧来の長い説明文字列(不足分はAIで補充)がparticipantRowの値表示から消えている',
    !/participantCount\}人\(不足分はAIで補充\)/.test(src)
  );
}

console.log();
console.log('== 3. OnlineLobbyScene.js: オートマッチング関連のヒント文にwordWrapが指定されている(文字化け対策) ==');
{
  const src = fs.readFileSync('src/scenes/OnlineLobbyScene.js', 'utf8');

  function extractMethodBody(source, methodName) {
    const idx = source.indexOf(`${methodName}(`);
    check(`${methodName}メソッドが見つかる`, idx !== -1);
    if (idx === -1) return '';
    // 中括弧の対応を数えてメソッド本体を大まかに抽出する。
    let depth = 0;
    let start = source.indexOf('{', idx);
    let i = start;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    return source.slice(start, i + 1);
  }

  const entryBody = extractMethodBody(src, '_showAutoMatchEntry');
  const settingsBody = extractMethodBody(src, '_showAutoMatchSettings');

  check('_showAutoMatchEntry内のヒント文にwordWrapが指定されている', /wordWrap:\s*\{\s*width:\s*wrapWidth\s*\}/.test(entryBody));
  check('_showAutoMatchSettings内のヒント文にwordWrapが指定されている', /wordWrap:\s*\{\s*width:\s*wrapWidth\s*\}/.test(settingsBody));

  check(
    '_showAutoMatchSettings内で、ヒント文の実測の高さ(hintLabel.height)を基準に後続行のY座標を動的に決めている(固定オフセットの重なり防止)',
    /hintBottom\s*=\s*hintY\s*\+\s*\(hintLabel\.height \|\| 56 \* s\) \/ 2/.test(settingsBody)
  );
  check(
    '_showAutoMatchEntry内でも同様にhintLabel.heightを基準にボタン位置を決めている',
    /hintBottom\s*=\s*hintY\s*\+\s*\(hintLabel\.height \|\| 40 \* s\) \/ 2/.test(entryBody)
  );

  // 行の並び順(participantY < difficultyY < timeLimitY < searchBtnY < backBtnY)が
  // 常に一定のrowGap以上空いていることをソースコード上の式から確認する
  // (実際の描画結果は本物のブラウザでしか厳密には検証できないが、式の
  // 組み立て自体が単調増加になっていることは静的にチェックできる)。
  check('participantY, difficultyY, timeLimitYがrowGapずつ単調に加算される式になっている', (() => {
    const gapUses = (settingsBody.match(/\+\s*rowGap/g) || []).length;
    return gapUses >= 3;
  })());
}

console.log();
console.log('== 4. SoundSystem.js: BGMの音源ファイル定義・存在確認 ==');
{
  const src = fs.readFileSync('src/systems/SoundSystem.js', 'utf8');
  check('BGM_FILES.titleにopening.mp3が1つだけ定義されている', /title:\s*\['assets\/audio\/bgm\/opening\.mp3'\]/.test(src));
  const gameBlockMatch = src.match(/game:\s*\[([^\]]*)\]/);
  check('BGM_FILES.gameブロックが見つかる', !!gameBlockMatch);
  if (gameBlockMatch) {
    const files = [...gameBlockMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    check('BGM_FILES.gameに5曲(battle1〜5.mp3)が列挙されている', files.length === 5);
    check(
      '列挙されたファイル名がbattle1.mp3〜battle5.mp3と一致する',
      files.every((f, i) => f === `assets/audio/bgm/battle${i + 1}.mp3`)
    );
  }

  const expectedFiles = [
    'assets/audio/bgm/opening.mp3',
    'assets/audio/bgm/battle1.mp3',
    'assets/audio/bgm/battle2.mp3',
    'assets/audio/bgm/battle3.mp3',
    'assets/audio/bgm/battle4.mp3',
    'assets/audio/bgm/battle5.mp3',
  ];
  for (const f of expectedFiles) {
    let size = -1;
    try {
      size = fs.statSync(f).size;
    } catch {
      size = -1;
    }
    check(`${f} が実ファイルとして存在し、サイズが0より大きい`, size > 0);
  }
}

console.log();
console.log('== 5. SoundSystem.js: playBGM()の呼び出し箇所が想定通り(ランダム選択設計の前提確認) ==');
{
  // playBGM('game')/playBGM('title')が複数箇所から呼ばれていると、
  // 「呼び出しのたびにランダム選択」という設計が「対戦毎にランダム」という
  // 要望を満たさなくなる(例えば1対戦中に何度も呼ばれると曲が途中で
  // 切り替わってしまう)。各シーンで想定通り1回だけ呼ばれているかを確認する。
  const gameSceneSrc = fs.readFileSync('src/scenes/GameScene.js', 'utf8');
  const titleSceneSrc = fs.readFileSync('src/scenes/TitleScene.js', 'utf8');

  const gameCalls = (gameSceneSrc.match(/playBGM\(\s*['"]game['"]\s*\)/g) || []).length;
  const titleCalls = (titleSceneSrc.match(/playBGM\(\s*['"]title['"]\s*\)/g) || []).length;

  check("GameScene.js内でplayBGM('game')が(対戦開始につき)1回だけ呼ばれている", gameCalls === 1);
  check("TitleScene.js内でplayBGM('title')が1回だけ呼ばれている", titleCalls === 1);
}

console.log();
console.log('== 6. SoundSystem.js: playBGM()の実際の再生動作(<audio>要素をモックして検証) ==');
{
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.loop = false;
      this.volume = 1;
      this.paused = false;
      this._playCalled = 0;
    }
    play() {
      this._playCalled++;
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }

  const originalAudio = globalThis.Audio;
  globalThis.Audio = FakeAudio;

  const { soundSystem } = await import('./src/systems/SoundSystem.js?round_h_test');

  // title: 常にopening.mp3を再生する
  soundSystem.playBGM('title');
  check("playBGM('title')はassets/audio/bgm/opening.mp3を再生する", soundSystem._bgmAudio?.src === 'assets/audio/bgm/opening.mp3');
  check("playBGM('title')は<audio>のplay()を呼ぶ", soundSystem._bgmAudio?._playCalled === 1);
  check('currentBgmKeyが"title"になる', soundSystem.currentBgmKey === 'title');

  // game: 複数回呼び出して、5曲全てが(統計的に)選ばれ、かつ範囲外のファイルが
  // 選ばれないことを確認する。
  const validGameFiles = new Set([
    'assets/audio/bgm/battle1.mp3',
    'assets/audio/bgm/battle2.mp3',
    'assets/audio/bgm/battle3.mp3',
    'assets/audio/bgm/battle4.mp3',
    'assets/audio/bgm/battle5.mp3',
  ]);
  const seen = new Set();
  let allValid = true;
  const TRIALS = 200;
  for (let i = 0; i < TRIALS; i++) {
    soundSystem.playBGM('game');
    const src = soundSystem._bgmAudio?.src;
    if (!validGameFiles.has(src)) allValid = false;
    seen.add(src);
  }
  check(`playBGM('game')は毎回battle1〜5.mp3の範囲内から選ぶ(${TRIALS}回試行)`, allValid);
  check(`${TRIALS}回試行すれば5曲全てが少なくとも1回は選ばれる(統計的検証)`, seen.size === 5);

  // stopBGM: 再生中の<audio>を一時停止し、状態をリセットする
  soundSystem.playBGM('game');
  const activeAudio = soundSystem._bgmAudio;
  soundSystem.stopBGM();
  check('stopBGM()は再生中の<audio>のpause()を呼ぶ', activeAudio.paused === true);
  check('stopBGM()後はcurrentBgmKeyがnullになる', soundSystem.currentBgmKey === null);
  check('stopBGM()後は_bgmAudioがnullになる', soundSystem._bgmAudio === null);

  // setVolume: 再生中の<audio>のvolumeも即座に更新される
  soundSystem.playBGM('title');
  soundSystem.setVolume('bgm', 0.3);
  check('setVolume("bgm", 0.3)は再生中の<audio>のvolumeも更新する', Math.abs(soundSystem._bgmAudio.volume - 0.3) < 1e-9);
  soundSystem.stopBGM();

  globalThis.Audio = originalAudio;
}

console.log();
console.log('== 7. SoundSystem.js: <audio>非対応環境(Audio未定義)でも例外を投げない ==');
{
  const originalAudio = globalThis.Audio;
  delete globalThis.Audio;

  const { soundSystem } = await import('./src/systems/SoundSystem.js?round_h_test2');
  let threw = false;
  try {
    soundSystem.playBGM('game');
  } catch {
    threw = true;
  }
  check('Audio未定義環境でplayBGM()を呼んでも例外を投げない', !threw);
  check('Audio未定義環境ではcurrentBgmKeyが更新されない(何もしないだけで安全に無視する)', soundSystem.currentBgmKey === null);

  if (originalAudio !== undefined) globalThis.Audio = originalAudio;
}

console.log();
console.log(`合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
