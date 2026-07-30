/**
 * Player.js
 * ------------------------------------------------------------
 * プレイヤーキャラクターの「ロジック」を管理するクラス。
 * グリッド単位で移動し、1マス移動は必ず完了してから次の入力を
 * 受け付ける「ボンバーマン式」の移動方式を採用する。
 *
 * サイコロ6面ステージ対応にあたり、本クラスは見た目(Phaser/Three.js
 * いずれの描画オブジェクトも)を直接保持しない「純粋なロジック+状態」の
 * クラスに変更した（開発ルール9: 描画とロジックの分離を徹底）。
 * 実際の見た目(色付き四角・VRMスナップショット・3Dメッシュ等)は
 * 呼び出し側(GameScene / CubeRenderer)がPlayerの公開プロパティ
 * (face/col/row/facing/isAlive/getMoveProgress()等)を読み取って
 * 描画する。これによりPhaser専用の2D描画とThree.js製の3D描画を
 * 同じPlayerロジックで共用できる。
 * ------------------------------------------------------------
 */
import {
  PLAYER_MOVE_DURATION_MS,
  PLAYER_DEFAULT_LIVES,
  BOMB_INITIAL_COUNT,
  BLAST_INITIAL_RANGE,
} from '../constants/GameConstants.js';

const DIRECTIONS = ['up', 'down', 'left', 'right'];

let nextPlayerInstanceId = 1;

export class Player {
  /**
   * @param {Phaser.Scene} scene - 時間管理(scene.time.now/delayedCall)のみに使用
   * @param {CubeStage} stage - 6面キューブステージ(resolveMove/isWalkable等を提供)
   * @param {string} startFace - 開始する面(CUBE_FACE_NAMESのいずれか)
   * @param {number} startCol
   * @param {number} startRow
   * @param {object} options - { colorIndex, isAI, playerId }
   */
  constructor(scene, stage, startFace, startCol, startRow, options = {}) {
    this.scene = scene;
    this.stage = stage;
    this.face = startFace;
    this.col = startCol;
    this.row = startRow;
    this.playerId = options.playerId ?? nextPlayerInstanceId++;
    this.isAI = !!options.isAI;
    this.colorIndex = options.colorIndex ?? 0;

    // --- ステータス（データ駆動: アイテムやスキルにより後から書き換わる） ---
    this.lives = PLAYER_DEFAULT_LIVES;
    this.maxBombs = BOMB_INITIAL_COUNT;
    this.activeBombCount = 0; // 現在フィールドに設置中の自分の爆弾数
    this.blastRange = BLAST_INITIAL_RANGE;
    this.speedMultiplier = 1;
    this.canPassSoftBlock = false; // 👻
    this.canKickBombs = false; // 💥
    // 「新しいアイテム時限装置機能アイテムを追加してほしい」への対応。
    // trueになると、自分の爆弾は導火線任せにせず、爆弾ボタンを押した
    // タイミングで手動起爆できるようになる(GameScene._tryPlaceBomb参照)。
    this.hasRemoteDetonator = false; // ⏱
    this.invincibleUntil = 0;
    this.isAlive = true;
    this.isMoving = false;
    this.facing = 'down';

    // 「一人1回まで爆弾に当たっても大丈夫なようにしてほしい」という要望に
    // 対応: 各プレイヤーは試合中1回だけ、爆風に当たってもライフを失わない
    // (takeDamage参照)。無敵アイテム(🛡)とは独立した別枠で、消費後は
    // 通常通りライフが減る。
    this.hasBombGrace = true;

    // 「倒れたキャラクターが取ったアイテムを落とすようにしてほしい」に
    // 対応するため、取得したアイテム種別を履歴として保持しておく
    // (GameScene._dropItemsOnDeathが撃破時にこれを見て同種のアイテムを
    // マップ上に落とす)。
    this.collectedItemTypes = [];

    // --- 見た目の補間用(レンダラーが読み取る。Playerはこの値を書くだけ) ---
    this._prevFace = startFace;
    this._prevCol = startCol;
    this._prevRow = startRow;
    this._moveStartAt = 0;
    this._moveDurationMs = PLAYER_MOVE_DURATION_MS;

    // --- 集計データ（リザルト画面・勝敗判定用） ---
    this.stats = {
      kills: 0, // 撃破数
      bombsExploded: 0, // 爆破数
      itemsCollected: 0, // 取得アイテム数
    };
  }

  get isInvincible() {
    return this.scene.time.now < this.invincibleUntil;
  }

  /**
   * 指定方向への移動を試みる。既に移動中の場合や壁・ブロック・爆弾で
   * 塞がれている場合は何もしない。面の端まで到達している場合は
   * CubeStage.resolveMove()経由で隣接する面へ乗り移る。
   * @param {'up'|'down'|'left'|'right'} direction
   * @param {(face:string,col:number,row:number)=>boolean} isTileBlockedByBomb - 爆弾による移動阻害チェック
   */
  tryMove(direction, isTileBlockedByBomb = () => false) {
    if (!this.isAlive || this.isMoving) return false;
    if (!DIRECTIONS.includes(direction)) return false;

    const resolved = this.stage.resolveMove(this.face, this.col, this.row, direction);
    if (!resolved) return false;

    if (!this.stage.isWalkable(resolved.face, resolved.col, resolved.row, { canPassSoftBlock: this.canPassSoftBlock })) {
      // 壁にぶつかって進めない場合でも、体の向きだけは変える（従来の仕様を踏襲）
      this.facing = direction;
      return false;
    }
    if (isTileBlockedByBomb(resolved.face, resolved.col, resolved.row)) {
      this.facing = direction;
      return false;
    }

    this._prevFace = this.face;
    this._prevCol = this.col;
    this._prevRow = this.row;

    this.isMoving = true;
    this.face = resolved.face;
    this.col = resolved.col;
    this.row = resolved.row;
    this.facing = resolved.facing;

    this._moveStartAt = this.scene.time.now;
    this._moveDurationMs = PLAYER_MOVE_DURATION_MS / this.speedMultiplier;
    this.scene.time.delayedCall(this._moveDurationMs, () => {
      this.isMoving = false;
    });
    return true;
  }

  /**
   * 現在の見た目の移動進捗を0(移動元)〜1(移動先=現在のface/col/row)で返す。
   * レンダラーが _prevFace/_prevCol/_prevRow と face/col/row の間を
   * 補間してなめらかな移動アニメーションを描くために使う。
   * 移動中でなければ常に1(=補間不要、現在地そのまま)を返す。
   */
  getMoveProgress(now = this.scene.time.now) {
    if (!this.isMoving) return 1;
    const raw = (now - this._moveStartAt) / this._moveDurationMs;
    return Math.max(0, Math.min(1, raw));
  }

  /** 爆弾設置可能かどうか */
  canPlaceBomb() {
    return this.isAlive && this.activeBombCount < this.maxBombs;
  }

  onBombPlaced() {
    this.activeBombCount++;
  }

  onBombResolved() {
    this.activeBombCount = Math.max(0, this.activeBombCount - 1);
  }

  /**
   * 爆風やAI等からのダメージ処理。無敵中は無効化する。
   * 「一人1回まで爆弾に当たっても大丈夫なように」との要望により、各
   * プレイヤーは試合中1回だけ、ライフを失わずに被弾を無効化できる
   * (hasBombGrace)。無敵アイテム(🛡)とは別枠で、こちらを消費した後も
   * 通常の無敵アイテムは引き続き機能する。猶予を使った場合も、被弾直後の
   * 連続ヒット防止のため短い無敵時間を付与する。
   * @returns {boolean} ライフが実際に減った(=通常のダメージが発生した)場合true。
   *   猶予で無効化された場合や、既に無敵/死亡していた場合はfalse。
   */
  takeDamage() {
    if (!this.isAlive || this.isInvincible) return false;
    if (this.hasBombGrace) {
      this.hasBombGrace = false;
      this.invincibleUntil = this.scene.time.now + 1500;
      return false;
    }
    this.lives -= 1;
    if (this.lives <= 0) {
      this.isAlive = false;
    } else {
      // 被弾後の一時無敵（連続被弾防止）は簡易的に一定時間付与する。
      this.invincibleUntil = this.scene.time.now + 1500;
    }
    return true;
  }

  destroy() {
    // 見た目(Phaser/Three.jsオブジェクト)はレンダラー側が所有・破棄するため、
    // ここでは特にクリーンアップするものはない。
  }
}
