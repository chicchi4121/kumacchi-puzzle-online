/**
 * CubeRenderer.js
 * ------------------------------------------------------------
 * サイコロ状(立方体)の6面ステージを実際にThree.jsで3D描画するクラス。
 *
 * 開発ルール9(描画とロジックの分離)に従い、本クラスは「見た目」だけを
 * 担当する。ゲームロジック(Stage/CubeStage/Player/Bomb/Item/Explosion)は
 * 一切変更せず、それらの公開状態(face/col/row/type/isAlive等)を読み取って
 * 3Dオブジェクトを生成・更新・破棄するだけの「シャドウレンダラー」として
 * 動作する。GameScene.js(Phaser)はゲームロジックの進行・入力・HUDを担当し、
 * バトルフィールドの実描画は本クラスがオーナーの別canvas(#cube-canvas)に
 * 対して行う（index.html参照）。
 *
 * 座標系: CubeTopology.jsのFACE_AXES(各面の法線N・右方向R・下方向D)を
 * そのまま使い、半径CUBE_RADIUSの立方体として実座標に変換する。
 *
 * 【2026-07 3D演出強化】
 * 以前は「面が切り替わったらカメラ自体を瞬時に別の位置へ飛ばす」方式
 * だったため、面移動が唐突な画面切り替えに見えていた。今回、
 * ・カメラは常に固定位置(fixed camera)に据え置き、
 * ・立方体の全メッシュ(床・ブロック・プレイヤー・爆弾・アイテム・爆風)を
 *   1つのTHREE.Group(this._cubeRoot)にまとめ、
 * ・面が切り替わる瞬間に、そのGroup自体をクォータニオンで
 *   アニメーション回転させる(CUBE_ROLL_DURATION_MSかけてslerp)
 * ことで、「サイコロが転がって別の面が正面を向く」ような見た目にした。
 * 回転の目標クォータニオンは、既存の_getFaceQuaternion(face)(面ローカル
 * 軸(R,-D,N)を世界座標へ写すMsrc)と、固定カメラ用に定めた目標軸Mdstから
 * Q = Mdst * Msrc(face)^-1 として導出する(verify_cube_rotation.mjs参照。
 * threeパッケージ非依存の手計算スクリプトで全6面について数値検証済み)。
 * 立方体ルート自身にQを適用すると、面のローカルZ軸(法線N)がMdstの
 * targetOutwardに、ローカルY軸(-D、面内の上方向)がtargetUpに一致する
 * ため、結果としてその面が常にカメラ正面(固定位置)を向く。
 * ------------------------------------------------------------
 */
import {
  CUBE_FACE_NAMES,
  CUBE_FACE_COLS,
  CUBE_FACE_ROWS,
  BLOCK_TYPES,
  PLAYER_COLORS,
  PLAYER_COLOR_HEX,
  EXPLOSION_LIFETIME_MS,
  CUBE_ROLL_DURATION_MS,
} from '../constants/GameConstants.js';
import { FACE_AXES, faceLocalToWorld } from '../constants/CubeTopology.js';
import { ITEM_EMOJI } from '../objects/Item.js';
import { computeCameraFit } from '../utils/CameraFit.js';

const CUBE_RADIUS = 5; // 立方体の中心から各面までの距離(Three.jsのワールド単位)
const BLOCK_OUTWARD = 0.16; // ブロックが面から浮く距離
const BLOCK_THICKNESS = 0.32;
const ENTITY_OUTWARD = 0.4; // プレイヤー・アイテム・爆弾が面から浮く距離
const CELL_SIZE = (2 * CUBE_RADIUS) / CUBE_FACE_COLS; // 1マスのワールド単位サイズ(全面同サイズ前提)

// 「爆弾.pngを爆弾にしてほしい」への対応: 以前は単色球体(SphereGeometry)で
// 描画していた爆弾を、アップロードされた画像(くまの顔を模した爆弾)を貼った
// 平面(PlaneGeometry)に差し替える。Item(アイテム)と同じく面に沿って正対する
// 平面をitem用の_getFaceQuaternion(face)で向かせる。
const BOMB_TEXTURE_PATH = 'assets/images/bomb/bomb.png';

// 【固定カメラ設定】以前は面ごとにカメラの位置を毎回計算して飛ばしていたが、
// 今はカメラは常にこの1箇所に固定し、立方体側を回転させる。
// CAMERA_ELEVATION_RAD: 0度=水平(真横から), 90度=真上から見下ろす。50度前後で
// 「プレイに必要な見下ろし感」と「ブロックの厚み・立方体の辺が見える3D感」を両立する。
const CAMERA_ELEVATION_RAD = (50 * Math.PI) / 180;
// CAM_DISTANCE: 「ステージ・キャラを画面中央に大きく表示してほしい」との要望を受け、
// 以前(CUBE_RADIUS*3.6=18)より寄せて、面全体が画面によく収まる大きさにした。
const CAM_DISTANCE = CUBE_RADIUS * 2.8;

const BLOCK_COLORS = Object.freeze({
  [BLOCK_TYPES.HARD]: 0x555555,
  [BLOCK_TYPES.SOFT]: 0xa0623b,
  [BLOCK_TYPES.ITEM]: 0xc98a54,
});

function cellKey(face, col, row) {
  return `${face}:${col},${row}`;
}

/** 面のローカル座標(col,row) -> ワールド座標([x,y,z])。立方体ルート(cubeRoot)基準のローカル座標のまま返す(回転はcubeRoot.quaternionが別途担う)。 */
function cellWorldPos(face, col, row, cols, rows, outward = 0) {
  const u = ((col + 0.5) / cols) * 2 - 1;
  const v = ((row + 0.5) / rows) * 2 - 1;
  const [x, y, z] = faceLocalToWorld(face, u, v);
  const { N } = FACE_AXES[face];
  return [x * CUBE_RADIUS + N[0] * outward, y * CUBE_RADIUS + N[1] * outward, z * CUBE_RADIUS + N[2] * outward];
}

/** t(0〜1)を「ゆっくり加速してゆっくり減速する」滑らかな曲線に変換する(サイコロが転がる勢いを表現) */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export class CubeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ready = false;
    this._THREE = null;
    this._faceQuaternions = new Map(); // face -> Msrc(面ローカル軸を世界座標へ写すクォータニオン)
    this._faceRotationTargets = new Map(); // face -> Q(cubeRootに適用する目標回転)
    this._blockMeshes = new Map(); // "face:col,row" -> mesh
    this._bombMeshes = new Map(); // Bomb instance -> mesh
    this._itemMeshes = new Map(); // Item instance -> mesh
    this._playerMeshes = new Map(); // playerId -> mesh
    this._explosions = []; // { mesh, startedAt }
    this._itemTextureCache = new Map(); // itemType -> CanvasTexture
    this._playerTextures = new Map(); // playerId -> { down, up, left, right }: CanvasTexture (人間・AI問わず)
    this._currentFace = null;
    this._isRotating = false;
    this._rotationFrom = null;
    this._rotationTo = null;
    this._rotationStartAt = 0;
    this._rotationDurationMs = CUBE_ROLL_DURATION_MS;
  }

  /**
   * Three.js(CDN経由)を読み込み、CubeStageの内容から立方体シーンを構築する。
   * @param {CubeStage} stage
   */
  async init(stage) {
    const THREE = await import(/* webpackIgnore: true */ 'three');
    this._THREE = THREE;
    this.stage = stage;

    // 爆弾画像(bomb.png)を読み込む。失敗した場合(ネットワーク不調等)は
    // addBomb()側で従来の単色球体描画にフォールバックする(開発ルール8と
    // 同様の考え方: 画像アセットの有無がゲームの続行自体に影響しないこと)。
    this._bombTexture = null;
    try {
      this._bombTexture = await new THREE.TextureLoader().loadAsync(BOMB_TEXTURE_PATH);
    } catch (e) {
      console.error(
        '[CubeRenderer] 爆弾画像(bomb.png)の読み込みに失敗しました。従来の球体描画にフォールバックします。',
        e
      );
    }

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // 影を有効にする(「もっと3Dに見えるように」との要望に対応。ブロックの
    // 立体感・立方体が転がる際の陰影の動きが出て、平面的な見た目を軽減する)。
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);

    // 立方体に属する全メッシュ(床・ブロック・プレイヤー・爆弾・アイテム・爆風)を
    // まとめるGroup。面が切り替わる際は、カメラではなくこのGroup自体を回転させる。
    this._cubeRoot = new THREE.Group();
    this.scene.add(this._cubeRoot);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.75);
    dirLight.position.set(4, 7, 5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    const shadowExtent = CUBE_RADIUS * 2.2;
    dirLight.shadow.camera.left = -shadowExtent;
    dirLight.shadow.camera.right = shadowExtent;
    dirLight.shadow.camera.top = shadowExtent;
    dirLight.shadow.camera.bottom = -shadowExtent;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 30;
    this.scene.add(dirLight);
    // 補助光(逆側からの弱いフィルライト): 影になった面が真っ黒に潰れないようにする。
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-3, -2, -4);
    this.scene.add(fillLight);

    this._setupFixedCamera();
    this.resize();
    this._buildFaces();
    this.ready = true;
  }

  /**
   * canvasの表示サイズ(CSS)に合わせてレンダラー/カメラを更新する。
   *
   * 「スマホ用の画面に面がおさまるようにしてほしい」への対応:
   * canvasのアスペクト比(幅/高さ)が1未満(スマホの縦長画面。特に右側
   * HUDパネル分を差し引いた3D描画領域は非常に縦長になりやすい)になると、
   * PerspectiveCamera.fovは縦方向の視野角のため、横方向の視野が大幅に
   * 狭くなり、サイコロの面の左右が見切れてしまっていた。computeCameraFit
   * (CameraFit.js)でaspectに応じた縦方向FOV・カメラ距離の倍率を算出し、
   * 横方向の視野を常に確保するようにする。
   */
  resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const h = Math.max(1, this.canvas.clientHeight || this.canvas.height);
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      const { vFovDeg, distanceScale } = computeCameraFit(this.camera.aspect);
      this.camera.fov = vFovDeg;
      if (this._camDirUnit) {
        this.camera.position.copy(this._camDirUnit).multiplyScalar(CAM_DISTANCE * distanceScale);
      }
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * カメラを固定位置に据え置き、以後は変更しない(以前は面ごとに毎回カメラを
   * 動かしていた)。同時に、立方体側を回転させる際の目標軸Mdstもここで
   * 一度だけ計算しておく(verify_cube_rotation.mjsで数値検証済みの式)。
   */
  _setupFixedCamera() {
    const THREE = this._THREE;
    // targetOutward(c): 固定カメラの方向(立方体中心から見て、常にこの向きにカメラがある)。
    const c = new THREE.Vector3(0, Math.sin(CAMERA_ELEVATION_RAD), Math.cos(CAMERA_ELEVATION_RAD));
    const worldUpHint = new THREE.Vector3(0, 1, 0);
    // targetRight(a): cとworldUpHintに直交する「画面右方向」。
    const a = new THREE.Vector3().crossVectors(worldUpHint, c).normalize();
    // targetUp(b): cとaの両方に直交する「画面上方向」(a,b,cで正規直交系)。
    const b = new THREE.Vector3().crossVectors(c, a);

    // カメラの向き(c)はスマホ対応のresize()でも変わらず一定なので保持しておき、
    // resize()側では距離(CAM_DISTANCE*distanceScale)だけをこの向きに沿って
    // 変える(=カメラを同じ方向のまま前後させる)。
    this._camDirUnit = c.clone();
    this.camera.position.copy(c).multiplyScalar(CAM_DISTANCE);
    this.camera.up.copy(b);
    this.camera.lookAt(0, 0, 0);

    const m = new THREE.Matrix4().makeBasis(a, b, c);
    this._mdstQuaternion = new THREE.Quaternion().setFromRotationMatrix(m);
  }

  _getFaceQuaternion(face) {
    if (!this._faceQuaternions.has(face)) {
      const THREE = this._THREE;
      const { N, R, D } = FACE_AXES[face];
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(R[0], R[1], R[2]),
        new THREE.Vector3(-D[0], -D[1], -D[2]),
        new THREE.Vector3(N[0], N[1], N[2])
      );
      this._faceQuaternions.set(face, new THREE.Quaternion().setFromRotationMatrix(m));
    }
    return this._faceQuaternions.get(face);
  }

  /** 指定した面をカメラ正面へ向けるために、cubeRootへ適用すべき目標クォータニオンQ = Mdst * Msrc(face)^-1 */
  _getTargetQuaternionForFace(face) {
    if (!this._faceRotationTargets.has(face)) {
      const Msrc = this._getFaceQuaternion(face);
      const Q = this._mdstQuaternion.clone().multiply(Msrc.clone().invert());
      this._faceRotationTargets.set(face, Q);
    }
    return this._faceRotationTargets.get(face);
  }

  _buildFaces() {
    const THREE = this._THREE;
    this._floorGeometry = new THREE.PlaneGeometry(2 * CUBE_RADIUS, 2 * CUBE_RADIUS);
    this._floorMeshes = [];
    for (const face of CUBE_FACE_NAMES) {
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x33403a, side: THREE.DoubleSide });
      const floor = new THREE.Mesh(this._floorGeometry, floorMat);
      floor.quaternion.copy(this._getFaceQuaternion(face));
      const { N } = FACE_AXES[face];
      floor.position.set(N[0] * CUBE_RADIUS, N[1] * CUBE_RADIUS, N[2] * CUBE_RADIUS);
      floor.receiveShadow = true;
      this._cubeRoot.add(floor);
      this._floorMeshes.push(floor);

      this._rebuildFaceBlocks(face);
    }

    // 初期状態では立方体は無回転(ワールド軸=面ローカル軸)。実際にどの面を
    // 正面に向けるかはGameScene側からsnapToFace()/rotateToFace()で指定する。
  }

  /** 指定した面の全ブロックメッシュを、Stageの現在の状態から作り直す(生成時専用) */
  _rebuildFaceBlocks(face) {
    const faceStage = this.stage.getFaceStage(face);
    for (let row = 0; row < faceStage.rows; row++) {
      for (let col = 0; col < faceStage.cols; col++) {
        const type = faceStage.getBlockType(col, row);
        if (type === BLOCK_TYPES.EMPTY) continue;
        this._addBlockMesh(face, col, row, type);
      }
    }
  }

  _addBlockMesh(face, col, row, type) {
    const THREE = this._THREE;
    const geom = new THREE.BoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.94, BLOCK_THICKNESS);
    const mat = new THREE.MeshStandardMaterial({ color: BLOCK_COLORS[type] ?? 0xffffff });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.quaternion.copy(this._getFaceQuaternion(face));
    const [x, y, z] = cellWorldPos(face, col, row, CUBE_FACE_COLS, CUBE_FACE_ROWS, BLOCK_OUTWARD);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this._cubeRoot.add(mesh);
    this._blockMeshes.set(cellKey(face, col, row), mesh);
  }

  /** ブロックが破壊された時にGameScene側から呼ぶ */
  removeBlockAt(face, col, row) {
    const key = cellKey(face, col, row);
    const mesh = this._blockMeshes.get(key);
    if (!mesh) return;
    this._cubeRoot.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this._blockMeshes.delete(key);
  }

  /** 2D canvas(VRMSystem.renderSnapshotSet等)からThree.jsのテクスチャを作る */
  createCanvasTexture(canvas) {
    return new this._THREE.CanvasTexture(canvas);
  }

  /**
   * 指定プレイヤーのVRM4方向テクスチャを設定する(人間・AI問わず使用可能)。
   * GameScene._loadAllVrmAppearances()から、プレイヤー1(操作中の自分)には
   * 自分のカスタム/デフォルトVRMを、それ以外の全員(AI・2人目以降の人間
   * プレイヤー)には同梱VRMの色違いテクスチャを設定するために使う。
   *
   * textureSetは { down: {idle,walkA,walkB}, up: {...}, left: {...}, right: {...} }
   * という入れ子構造(VRMSystemの「手足を振るようにしてほしい」対応で
   * ポーズ違いのテクスチャを複数持つようになった)。
   */
  setPlayerTextures(playerId, textureSet) {
    this._playerTextures.set(playerId, textureSet);
    const mesh = this._playerMeshes.get(playerId);
    if (mesh) {
      mesh.material.map = textureSet.down?.idle ?? null;
      mesh.material.transparent = true;
      mesh.material.needsUpdate = true;
    }
  }

  _createPlayerMesh(player) {
    const THREE = this._THREE;
    const geom = new THREE.PlaneGeometry(CELL_SIZE * 0.82, CELL_SIZE * 0.82);
    let material;
    const textureSet = this._playerTextures.get(player.playerId);
    if (textureSet) {
      material = new THREE.MeshBasicMaterial({
        map: textureSet.down?.idle ?? null,
        transparent: true,
        side: THREE.DoubleSide,
      });
    } else {
      const colorName = PLAYER_COLORS[player.colorIndex % PLAYER_COLORS.length];
      material = new THREE.MeshBasicMaterial({ color: PLAYER_COLOR_HEX[colorName] ?? 0xffffff, side: THREE.DoubleSide });
    }
    const mesh = new THREE.Mesh(geom, material);
    this._cubeRoot.add(mesh);
    return mesh;
  }

  _removePlayerMesh(playerId) {
    const mesh = this._playerMeshes.get(playerId);
    if (!mesh) return;
    this._cubeRoot.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this._playerMeshes.delete(playerId);
  }

  /**
   * 全プレイヤーの見た目を現在の状態(face/col/row/facing/isAlive)に同期する。
   * 移動中はPlayer.getMoveProgress()を使って前の位置から現在地へ補間する。
   *
   * 「VRMで入れたキャラを動かしたとき手足を振るようにしてほしい」への対応:
   * player.isMoving中は、1マス移動アニメーションの進捗(progress)の前半/
   * 後半でwalkA/walkBのテクスチャを交互に切り替え、手足が振れているように
   * 見せる（静止中はidleテクスチャに戻す）。テクスチャセットが未設定の
   * プレイヤー(VRM読込前・失敗時)は色付き四角のままなので何もしない。
   * @param {Array<Player>} players
   * @param {number} now
   */
  syncPlayers(players, now) {
    for (const player of players) {
      if (!player.isAlive) {
        this._removePlayerMesh(player.playerId);
        continue;
      }
      let mesh = this._playerMeshes.get(player.playerId);
      if (!mesh) {
        mesh = this._createPlayerMesh(player);
        this._playerMeshes.set(player.playerId, mesh);
      }

      const progress = player.getMoveProgress(now);

      const textureSet = this._playerTextures.get(player.playerId);
      if (textureSet) {
        const poses = textureSet[player.facing] ?? textureSet.down;
        const poseName = player.isMoving ? (progress < 0.5 ? 'walkA' : 'walkB') : 'idle';
        const tex = poses?.[poseName] ?? poses?.idle ?? textureSet.down?.idle;
        if (tex && mesh.material.map !== tex) {
          mesh.material.map = tex;
          mesh.material.needsUpdate = true;
        }
      }

      const [fx, fy, fz] = cellWorldPos(player._prevFace, player._prevCol, player._prevRow, CUBE_FACE_COLS, CUBE_FACE_ROWS, ENTITY_OUTWARD);
      const [tx, ty, tz] = cellWorldPos(player.face, player.col, player.row, CUBE_FACE_COLS, CUBE_FACE_ROWS, ENTITY_OUTWARD);
      mesh.position.set(fx + (tx - fx) * progress, fy + (ty - fy) * progress, fz + (tz - fz) * progress);
      mesh.quaternion.copy(this._getFaceQuaternion(player.face));
    }
  }

  addBomb(bomb) {
    const THREE = this._THREE;
    let mesh;
    if (this._bombTexture) {
      // 「爆弾.pngを爆弾にしてほしい」への対応: Item(アイテム)と同様、
      // 面に正対する平面に画像を貼って表示する。
      const geom = new THREE.PlaneGeometry(CELL_SIZE * 0.62, CELL_SIZE * 0.62);
      const mat = new THREE.MeshBasicMaterial({ map: this._bombTexture, transparent: true, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(geom, mat);
      mesh.quaternion.copy(this._getFaceQuaternion(bomb.face));
    } else {
      // 画像読み込みに失敗した場合の従来フォールバック(単色球体)。
      const geom = new THREE.SphereGeometry(CELL_SIZE * 0.28, 12, 10);
      const mat = new THREE.MeshStandardMaterial({ color: 0x3b2a20 });
      mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
    }
    const [x, y, z] = cellWorldPos(bomb.face, bomb.col, bomb.row, CUBE_FACE_COLS, CUBE_FACE_ROWS, ENTITY_OUTWARD * 0.7);
    mesh.position.set(x, y, z);
    this._cubeRoot.add(mesh);
    this._bombMeshes.set(bomb, mesh);
  }

  removeBomb(bomb) {
    const mesh = this._bombMeshes.get(bomb);
    if (!mesh) return;
    this._cubeRoot.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this._bombMeshes.delete(bomb);
  }

  /**
   * 爆弾の「今にも爆発しそう」な拍動アニメーションに加え、💥(KICK)で
   * 蹴られてスライド移動中の爆弾があれば、その位置補間も行う。
   * Bomb.js側がgetMoveProgress(now)/_prevFace等(Playerと同じ補間用の
   * フィールド)を持っている場合のみ位置補間する(持っていない場合=
   * オンライン対戦のゲスト側ミラーオブジェクト等は、従来通り静的な
   * 位置のまま。スライドの滑らかな見た目は現状ホスト/ローカルのみの
   * 対応というv1の割り切り)。
   */
  _updateBombs(now) {
    for (const [bomb, mesh] of this._bombMeshes.entries()) {
      mesh.scale.setScalar(1 + 0.12 * Math.sin(now / 130));
      if (typeof bomb.getMoveProgress === 'function' && bomb._prevFace) {
        const progress = bomb.getMoveProgress(now);
        const [fx, fy, fz] = cellWorldPos(bomb._prevFace, bomb._prevCol, bomb._prevRow, CUBE_FACE_COLS, CUBE_FACE_ROWS, ENTITY_OUTWARD * 0.7);
        const [tx, ty, tz] = cellWorldPos(bomb.face, bomb.col, bomb.row, CUBE_FACE_COLS, CUBE_FACE_ROWS, ENTITY_OUTWARD * 0.7);
        mesh.position.set(fx + (tx - fx) * progress, fy + (ty - fy) * progress, fz + (tz - fz) * progress);
      }
    }
  }

  _getItemTexture(type) {
    if (this._itemTextureCache.has(type)) return this._itemTextureCache.get(type);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ITEM_EMOJI[type] ?? '?', 32, 34);
    const texture = new this._THREE.CanvasTexture(canvas);
    this._itemTextureCache.set(type, texture);
    return texture;
  }

  addItem(item) {
    const THREE = this._THREE;
    const geom = new THREE.PlaneGeometry(CELL_SIZE * 0.6, CELL_SIZE * 0.6);
    const mat = new THREE.MeshBasicMaterial({ map: this._getItemTexture(item.type), transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.quaternion.copy(this._getFaceQuaternion(item.face));
    const [x, y, z] = cellWorldPos(item.face, item.col, item.row, CUBE_FACE_COLS, CUBE_FACE_ROWS, ENTITY_OUTWARD * 0.6);
    mesh.position.set(x, y, z);
    this._cubeRoot.add(mesh);
    this._itemMeshes.set(item, mesh);
  }

  removeItem(item) {
    const mesh = this._itemMeshes.get(item);
    if (!mesh) return;
    this._cubeRoot.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this._itemMeshes.delete(item);
  }

  /** 爆風が届いたマスに一瞬だけ表示するエフェクト */
  showExplosion(face, tiles, now) {
    const THREE = this._THREE;
    const geom = new THREE.PlaneGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.9);
    for (const tile of tiles) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff9642, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.quaternion.copy(this._getFaceQuaternion(face));
      const [x, y, z] = cellWorldPos(face, tile.col, tile.row, CUBE_FACE_COLS, CUBE_FACE_ROWS, ENTITY_OUTWARD * 0.5);
      mesh.position.set(x, y, z);
      this._cubeRoot.add(mesh);
      this._explosions.push({ mesh, startedAt: now });
    }
  }

  _updateExplosions(now) {
    this._explosions = this._explosions.filter((entry) => {
      const t = (now - entry.startedAt) / EXPLOSION_LIFETIME_MS;
      if (t >= 1) {
        this._cubeRoot.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        return false;
      }
      entry.mesh.material.opacity = 0.85 * (1 - t);
      return true;
    });
  }

  /**
   * 指定した面を即座に(アニメーションなしで)正面に向ける。ゲーム開始直後、
   * まだ実際に「面をまたいで移動した」わけではない初期表示に使う
   * (この場合にrotateToFace()でアニメーションさせると、初期化時に
   * 意味もなく立方体がグルッと回って見えてしまうため)。
   * @param {string} face
   */
  snapToFace(face) {
    if (!this.ready || !face) return;
    const target = this._getTargetQuaternionForFace(face);
    this._cubeRoot.quaternion.copy(target);
    this._currentFace = face;
    this._isRotating = false;
  }

  /**
   * プレイヤーが面をまたいで移動した際、サイコロが転がったように見える
   * アニメーションで指定した面を正面へ向ける。同じ面のままの場合は何もしない。
   * @param {string} face
   * @param {number} now
   */
  rotateToFace(face, now) {
    if (!this.ready || !face || this._currentFace === face) return;
    if (this._currentFace === null) {
      // まだ一度もsnapToFace/rotateToFaceが呼ばれていない場合は、初回のみ
      // 即座に表示する(アニメーション開始位置が無いため)。
      this.snapToFace(face);
      return;
    }
    this._rotationFrom = this._cubeRoot.quaternion.clone();
    this._rotationTo = this._getTargetQuaternionForFace(face);
    this._rotationStartAt = now;
    this._rotationDurationMs = CUBE_ROLL_DURATION_MS;
    this._isRotating = true;
    this._currentFace = face;
  }

  _updateCubeRotation(now) {
    if (!this._isRotating) return;
    const t = Math.min(1, (now - this._rotationStartAt) / this._rotationDurationMs);
    const eased = easeInOutCubic(t);
    this._cubeRoot.quaternion.copy(this._rotationFrom).slerp(this._rotationTo, eased);
    if (t >= 1) this._isRotating = false;
  }

  /** 毎フレーム呼び出す: 立方体の回転アニメーション・動的エフェクトを更新して描画する */
  render(now) {
    if (!this.ready) return;
    this._updateCubeRotation(now);
    this._updateBombs(now);
    this._updateExplosions(now);
    this.renderer.render(this.scene, this.camera);
  }

  /** シーン終了時にWebGLリソースを解放する */
  dispose() {
    if (!this.ready) return;
    for (const mesh of this._floorMeshes ?? []) {
      this._cubeRoot.remove(mesh);
      mesh.material.dispose();
    }
    this._floorGeometry?.dispose();
    for (const key of Array.from(this._blockMeshes.keys())) {
      const mesh = this._blockMeshes.get(key);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const mesh of this._bombMeshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const mesh of this._itemMeshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const mesh of this._playerMeshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const entry of this._explosions) {
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
    }
    for (const texture of this._itemTextureCache.values()) {
      texture.dispose();
    }
    this.renderer?.dispose();
    this.ready = false;
  }
}
