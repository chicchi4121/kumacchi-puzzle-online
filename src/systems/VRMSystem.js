/**
 * VRMSystem.js
 * ------------------------------------------------------------
 * VRMキャラクターのアップロード・読込・差し替えを担当するシステム。
 *
 * 開発ルール8「VRMシステムはゲームロジックから分離し、キャラクター
 * 差し替えのみで動作する構造にすること」に従い、本システムは
 * Player.setDisplayObject()を通じて見た目を差し替えるだけで、
 * 移動・当たり判定等のゲームロジックには一切干渉しない。
 *
 * 実装方針（現状のスコープ）:
 *   ボンバーマン系の見下ろし2Dグリッド上でVRMをリアルタイム3D表示・
 *   アニメーションさせるのは大掛かりになるため、Phase3の第一段階として
 *   「VRMモデルを正面/背面/左/右の4方向から1枚ずつレンダリングし、
 *   それぞれのcanvasをPhaserの静止画テクスチャとして使い、移動方向
 *   (Player.facing)に応じて差し替える」方式を採用する。
 *   将来的にライブ3D表示（歩行アニメーション等）に発展させる場合は、
 *   本クラスのAPI(renderSnapshotSet)は変えずに内部実装だけ差し替え
 *   られるようにしてある。
 *
 * 【2026-07更新】「VRMで入れたキャラを動かしたとき手足を振るようにして
 * ほしい」への対応: 各方向につき静止ポーズ(idle)1枚だけでなく、腕・脚の
 * ボーンを前後逆方向に振った2種類の歩行ポーズ(walkA/walkB)も追加で
 * レンダリングするようにした。renderSnapshotSet()の戻り値は
 * { down: {idle, walkA, walkB}, up: {...}, left: {...}, right: {...} }
 * という形になり、呼び出し側(CubeRenderer)はPlayer.isMoving中、
 * walkA/walkBを交互に表示することで「歩くときに手足が振れる」ように
 * 見せる（ライブなボーンアニメーションではなく、静止画の差し替えである
 * 点は従来のスナップショット方式を踏襲している）。
 *
 * Three.js / @pixiv/three-vrm はビルドステップを増やさないよう
 * index.htmlのimport map経由でCDNからロードする（ベア指定子でdynamic
 * import）。Node環境（ユニットテスト）ではこれらのモジュールは決して
 * importされない（実際にVRMを読み込むメソッドが呼ばれた時だけdynamic
 * importが走るため、モジュール自体の読み込みはNode上でも安全に行える）。
 * ------------------------------------------------------------
 */
export class VRMSystem {
  constructor() {
    this._modulesPromise = null;
    // タイトル画面からアップロードされたVRM(このブラウザタブ内でのみ有効。
    // ファイル本体はサイズの都合上LocalStorageには保存しない）。
    this.customArrayBuffer = null;
    this.customFileName = null;
  }

  /** タイトル画面のVRMアップロード用。読み込んだファイルの中身を記憶する */
  setCustomVrm(arrayBuffer, fileName) {
    this.customArrayBuffer = arrayBuffer;
    this.customFileName = fileName;
  }

  hasCustomVrm() {
    return this.customArrayBuffer !== null;
  }

  /** Three.js/GLTFLoader/three-vrmをCDN(import map経由)から遅延ロードする */
  _loadModules() {
    if (!this._modulesPromise) {
      console.log('[VRMSystem] Three.js / three-vrm をCDNから読み込み中...');
      this._modulesPromise = Promise.all([
        import(/* webpackIgnore: true */ 'three'),
        import(/* webpackIgnore: true */ 'three/addons/loaders/GLTFLoader.js'),
        import(/* webpackIgnore: true */ '@pixiv/three-vrm'),
      ])
        .then((modules) => {
          console.log('[VRMSystem] Three.js / three-vrm の読み込みに成功しました。');
          return modules;
        })
        .catch((e) => {
          // 次回呼び出し時に再試行できるようキャッシュを破棄する
          this._modulesPromise = null;
          console.error(
            '[VRMSystem] Three.js / three-vrm のCDN読み込みに失敗しました。' +
              'ネットワーク環境やindex.htmlのimport mapのURL/バージョン指定をご確認ください。',
            e
          );
          throw e;
        });
    }
    return this._modulesPromise;
  }

  /**
   * VRMファイルの中身(ArrayBuffer)から、正面(down)・背面(up)・左(left)・
   * 右(right)の4方向それぞれについて、静止ポーズ(idle)と歩行ポーズ2種
   * (walkA/walkB。腕・脚を前後逆に振ったポーズ)を描画し、
   * { down: {idle,walkA,walkB}, up: {...}, left: {...}, right: {...} }
   * (各値はHTMLCanvasElement)として返す。キー名はPlayer.facing
   * ('up'|'down'|'left'|'right')にそのまま対応する（'down'=画面手前=正面、
   * 'up'=画面奥=背面、という向き）。
   * 失敗した場合は例外を投げる（呼び出し側でcatchし、デフォルト見た目に
   * フォールバックすること）。
   *
   * @param {ArrayBuffer} arrayBuffer
   * @param {number} size - 出力canvasの一辺(px)
   * @param {(stage: string) => void} [onProgress] - 進行状況を通知するコールバック
   * @returns {Promise<{down: {idle:HTMLCanvasElement, walkA:HTMLCanvasElement, walkB:HTMLCanvasElement}, up: object, left: object, right: object}>}
   */
  async renderSnapshotSet(arrayBuffer, size = 128, onProgress = () => {}) {
    onProgress('loading-modules');
    const [THREE, { GLTFLoader }, threeVrm] = await this._loadModules();
    const { VRMLoaderPlugin, VRMUtils } = threeVrm;

    onProgress('parsing');
    console.log('[VRMSystem] VRMファイルをパース中...', { byteLength: arrayBuffer.byteLength });

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await new Promise((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    const vrm = gltf.userData.vrm;
    if (!vrm) {
      throw new Error('VRMデータが見つかりません（VRM拡張を含まないglTFファイルの可能性があります）');
    }
    console.log('[VRMSystem] VRMのパースに成功しました。4方向のスナップショットを描画します。');
    onProgress('rendering');

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);
    vrm.update(0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(size, size);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.add(vrm.scene);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(0.5, 1, 1);
    scene.add(dirLight);

    // モデル全体(頭のてっぺんから足元まで)が余白付きで画角に収まるよう、
    // バウンディングボックスの縦横サイズからカメラ距離を計算する。
    // (以前は近似的にmaxDim*1.5という固定倍率で距離を決めていたため、
    //  実際にはFOV28度では縦方向の収まりが約75%にしかならず、頭や足が
    //  フレームからはみ出して見切れてしまっていた。今回はFOVと縦横の
    //  実寸法から必要な距離を三角関数で正しく逆算し、さらに余白
    //  (paddingFactor)を持たせることで頭が切れないようにする。)
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const dimensions = new THREE.Vector3();
    box.getSize(dimensions);
    const center = new THREE.Vector3();
    box.getCenter(center);

    const height = dimensions.y || 1;
    const horizontal = Math.max(dimensions.x, dimensions.z) || height * 0.4;

    const fovDeg = 28;
    const fovRad = (fovDeg * Math.PI) / 180;
    const paddingFactor = 1.35; // 上下左右にゆとりを持たせ、頭や手足が見切れないようにする
    const distForHeight = (height * paddingFactor) / 2 / Math.tan(fovRad / 2);
    const distForWidth = (horizontal * paddingFactor) / 2 / Math.tan(fovRad / 2);
    const distance = Math.max(distForHeight, distForWidth, height * 0.9);

    const camera = new THREE.PerspectiveCamera(fovDeg, 1, 0.05, 50);
    camera.position.set(center.x, center.y, center.z + distance);
    camera.lookAt(center);

    // three-vrmはモデルの-Z方向を正面としている。カメラは+Z側に固定した
    // ままモデル自体をY軸回転させることで、正面/背面/左右の4方向を撮影する。
    //   down (画面手前=正面): 180度回転させてカメラの方を向かせる
    //   up   (画面奥=背面)  : 回転させず、モデルの背中をカメラに向ける
    //   left / right        : 90度ずつ回転させ、左右の側面をカメラに向ける
    const ROTATIONS = {
      down: Math.PI,
      up: 0,
      left: Math.PI / 2,
      right: -Math.PI / 2,
    };

    // 「手足を振るようにしてほしい」への対応: 歩行中に見える2つの逆位相
    // ポーズ(walkA/walkB)を作るため、肩(上腕)・股関節(上脚)のボーンを
    // 前後逆方向に振る。左右対称に振ることで「歩いている」ように見せる
    // (実際のボーンアニメーションではなく、静止スナップショットを2枚
    // 交互に差し替えるだけの簡易的な歩行表現)。ボーンが取得できない
    // VRMモデル(人型ボーン構成が無い等)の場合は、posingを諦めてidleと
    // 同じ絵をwalkA/walkBにも使う(例外にはしない=フォールバック)。
    const humanoid = vrm.humanoid;
    const WALK_SWING_RAD = 0.5; // 腕の振り幅
    const WALK_LEG_SWING_RAD = 0.4; // 脚の振り幅
    const boneNames = ['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'];
    const bones = {};
    if (humanoid) {
      for (const name of boneNames) {
        bones[name] = humanoid.getNormalizedBoneNode(name) ?? null;
      }
    }
    const hasWalkBones = Object.values(bones).some((b) => b != null);

    /** 腕・脚ボーンの回転(X軸)を一括設定する。boneOffsets未指定なら全て0(ニュートラル姿勢)に戻す */
    const applyWalkPose = (boneOffsets = null) => {
      if (!hasWalkBones) return;
      if (bones.leftUpperArm) bones.leftUpperArm.rotation.x = boneOffsets?.leftUpperArm ?? 0;
      if (bones.rightUpperArm) bones.rightUpperArm.rotation.x = boneOffsets?.rightUpperArm ?? 0;
      if (bones.leftUpperLeg) bones.leftUpperLeg.rotation.x = boneOffsets?.leftUpperLeg ?? 0;
      if (bones.rightUpperLeg) bones.rightUpperLeg.rotation.x = boneOffsets?.rightUpperLeg ?? 0;
    };

    // 右腕・左脚が前に出るタイミングと、左腕・右脚が前に出るタイミングの
    // 2ポーズ（人間の自然な歩行と同じく、対角の腕・脚が同時に振れる）。
    const WALK_POSES = {
      idle: null,
      walkA: {
        leftUpperArm: -WALK_SWING_RAD,
        rightUpperArm: WALK_SWING_RAD,
        leftUpperLeg: WALK_LEG_SWING_RAD,
        rightUpperLeg: -WALK_LEG_SWING_RAD,
      },
      walkB: {
        leftUpperArm: WALK_SWING_RAD,
        rightUpperArm: -WALK_SWING_RAD,
        leftUpperLeg: -WALK_LEG_SWING_RAD,
        rightUpperLeg: WALK_LEG_SWING_RAD,
      },
    };

    const renderToCanvas = () => {
      renderer.render(scene, camera);
      const glCanvas = renderer.domElement;
      // 重要: glCanvas(renderer.domElement)は'webgl'コンテキストが紐付いた
      // canvasであり、一度webglコンテキストを取得したcanvasは二度と
      // getContext('2d')を取得できない（nullが返る）。Phaser.Textures.addCanvas()
      // は内部で2Dコンテキスト経由のピクセル読み取り(getImageData等)を行うため、
      // webgl canvasをそのまま渡すと「Cannot read properties of null
      // (reading 'getImageData')」で失敗する。
      // そのため、描画結果を独立した2D canvasへdrawImageでコピーしてから使う。
      const canvas2d = document.createElement('canvas');
      canvas2d.width = size;
      canvas2d.height = size;
      canvas2d.getContext('2d').drawImage(glCanvas, 0, 0, size, size);
      return canvas2d;
    };

    const result = {};
    for (const [facing, rotY] of Object.entries(ROTATIONS)) {
      vrm.scene.rotation.y = rotY;

      const poses = {};
      for (const [poseName, boneOffsets] of Object.entries(WALK_POSES)) {
        applyWalkPose(boneOffsets);
        vrm.update(0);
        poses[poseName] = renderToCanvas();
      }
      applyWalkPose(null); // 次の方向のレンダリングに影響しないよう、必ずニュートラル姿勢へ戻す

      result[facing] = poses;
      onProgress(`rendered-${facing}`);
    }

    renderer.dispose();

    console.log('[VRMSystem] 4方向のスナップショット描画が完了しました。', { size, boxDimensions: dimensions, distance });
    onProgress('done');
    return result;
  }

  /**
   * renderSnapshotSet()が返した{down,up,left,right}のcanvasセットから、
   * 指定のCSS filter(Canvas2D の ctx.filter、例: 'hue-rotate(220deg)')を
   * 適用した新しいcanvasセットを作って返す（元のセットは変更しない）。
   *
   * 敵キャラ(AI・2人目以降の人間プレイヤー)の見た目を、同じVRMモデル
   * (同梱のkumacchi.vrm)の色違いにするために使う。VRMを毎回それぞれの色で
   * 再レンダリングする（Three.jsのマテリアル色を差し替える）のはコストが
   * 高く、VRMごとにマテリアル構成も一定でないため、代わりに「1回だけ
   * レンダリングした結果を2D canvas上で色調補正する」という軽量な方式を
   * 採用している（PLAYER_COLOR_FILTERS参照）。
   *
   * @param {{down:{idle,walkA,walkB}, up:object, left:object, right:object}} snapshotSet
   * @param {string} filterCss - 'none'なら元のcanvasをそのまま複製する
   * @returns {{down:{idle,walkA,walkB}, up:object, left:object, right:object}}
   */
  tintSnapshotSet(snapshotSet, filterCss = 'none') {
    const tintCanvas = (srcCanvas) => {
      const tinted = document.createElement('canvas');
      tinted.width = srcCanvas.width;
      tinted.height = srcCanvas.height;
      const ctx = tinted.getContext('2d');
      ctx.filter = filterCss || 'none';
      ctx.drawImage(srcCanvas, 0, 0);
      return tinted;
    };

    const result = {};
    for (const [facing, poses] of Object.entries(snapshotSet)) {
      const tintedPoses = {};
      for (const [poseName, srcCanvas] of Object.entries(poses)) {
        tintedPoses[poseName] = tintCanvas(srcCanvas);
      }
      result[facing] = tintedPoses;
    }
    return result;
  }
}

// アプリ全体で共有するシングルトン。
// customVrmArrayBuffer: タイトル画面からアップロードされたVRM(このブラウザ
// セッション中のみ有効。LocalStorageにはファイル名など軽量な情報のみ保存する)。
export const vrmSystem = new VRMSystem();
