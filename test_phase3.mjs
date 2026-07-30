/**
 * test_phase3.mjs
 * ------------------------------------------------------------
 * Phase3で追加したVRM対応の第一歩に対する簡易検証。
 *
 * 重要な制約: 実際のVRM読込・3Dレンダリングはブラウザの
 * WebGL/Three.js/three-vrm(CDN経由)に依存しており、Node環境である
 * このテストでは検証できない（VRMSystem.renderSnapshot()自体は
 * dynamic importでガードされているため、呼び出さない限りNode上でも
 * 安全にimportできることのみ確認する）。
 *
 * そのため、ここでは以下の「Node上でも確実に検証できる」項目に絞る:
 *   1. VRMSystemの状態管理(setCustomVrm/hasCustomVrm)が正しく動くこと
 *   2. 同梱デフォルトVRM(assets/vrm/kumacchi.vrm)が構造的に正しい
 *      binary glTF 2.0 + VRM拡張データであること（実際にブラウザで
 *      three-vrmが読み込めるかまでは保証しないが、ファイル破損や
 *      誤ったファイルの混入は検出できる）
 * ------------------------------------------------------------
 */
import { readFile, stat } from 'node:fs/promises';

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

console.log('== 1. VRMSystemの状態管理 ==');
{
  const { VRMSystem } = await import('./src/systems/VRMSystem.js');
  const sys = new VRMSystem();
  check('初期状態ではhasCustomVrmがfalse', sys.hasCustomVrm() === false);

  const fakeBuffer = new ArrayBuffer(8);
  sys.setCustomVrm(fakeBuffer, 'test.vrm');
  check('setCustomVrm後はhasCustomVrmがtrue', sys.hasCustomVrm() === true);
  check('customFileNameが保持される', sys.customFileName === 'test.vrm');
  check('customArrayBufferが保持される', sys.customArrayBuffer === fakeBuffer);
}

console.log('\n== 2. GameScene/TitleSceneがVRMSystemをimportしても安全 ==');
{
  // VRMSystem.jsのdynamic import(three等)はrenderSnapshot()呼び出し時のみ走るため、
  // モジュールをimportするだけならNode環境でもエラーにならないはず。
  await import('./src/scenes/GameScene.js');
  await import('./src/scenes/TitleScene.js');
  check('GameScene.js / TitleScene.js のimportがエラーなく完了する', true);
}

console.log('\n== 3. 同梱デフォルトVRM(assets/vrm/kumacchi.vrm)の構造検証 ==');
{
  const path = new URL('./assets/vrm/kumacchi.vrm', import.meta.url);
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch (e) {
    fileStat = null;
  }
  check('assets/vrm/kumacchi.vrm が存在する', fileStat !== null);

  if (fileStat) {
    const buf = await readFile(path);
    const magic = buf.toString('ascii', 0, 4);
    const version = buf.readUInt32LE(4);
    const totalLength = buf.readUInt32LE(8);

    check('glTFバイナリのマジックバイト("glTF")が正しい', magic === 'glTF');
    check('glTFバージョンが2', version === 2);
    check('ヘッダのtotal lengthが実ファイルサイズと一致する', totalLength === buf.length);

    const jsonChunkLength = buf.readUInt32LE(12);
    const jsonChunkType = buf.toString('ascii', 16, 20);
    check('先頭チャンクがJSONチャンクである', jsonChunkType === 'JSON');

    const jsonText = buf.toString('utf8', 20, 20 + jsonChunkLength);
    let json = null;
    try {
      json = JSON.parse(jsonText);
    } catch (e) {
      json = null;
    }
    check('JSONチャンクが正しくパースできる', json !== null);

    const hasVrmExtension = !!(json?.extensions?.VRM || json?.extensions?.VRMC_vrm);
    check('VRM拡張(VRM または VRMC_vrm)が含まれている', hasVrmExtension);
  }
}

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
