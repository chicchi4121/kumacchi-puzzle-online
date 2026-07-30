/**
 * Bomb.js
 * ------------------------------------------------------------
 * 設置された爆弾1個分の状態と見た目（くまの顔）を管理するクラス。
 * 爆発の判定・爆風の伝播ロジックはExplosion.jsに委譲し、
 * Bombは「いつ・誰が・どこで・どの範囲で」爆発するかの情報のみを持つ。
 * ------------------------------------------------------------
 */
import { TILE_SIZE, BOMB_FUSE_MS, BOMB_KICK_SLIDE_DURATION_MS, DEPTH } from '../constants/GameConstants.js';
import { Collision } from '../utils/Collision.js';

let nextBombInstanceId = 1;

export class Bomb {
  /**
   * @param {Phaser.Scene} scene
   * @param {string} face - サイコロ6面ステージ上でこの爆弾が置かれている面(CUBE_FACE_NAMESのいずれか)
   * @param {number} col
   * @param {number} row
   * @param {object} options - { ownerId, blastRange, onDetonate }
   *   onDetonate: (bomb: Bomb) => void  爆発時に呼び出されるコールバック
   */
  constructor(scene, face, col, row, options = {}) {
    this.scene = scene;
    this.face = face;
    this.col = col;
    this.row = row;
    // オンライン対戦(NetworkSystem)でホスト→ゲスト間の状態同期・差分検出に
    // 使う安定ID。JSオブジェクトの参照そのものはネットワーク越しに送れない
    // ため、数値IDで爆弾を識別できるようにする(Playerのplayeridと同じ用途)。
    this.id = options.id ?? nextBombInstanceId++;
    this.ownerId = options.ownerId ?? null;
    this.blastRange = options.blastRange ?? 1;
    this.onDetonate = options.onDetonate ?? (() => {});
    this.detonated = false;

    // --- 💥(KICK)アイテムによる蹴り移動用(見た目の補間はPlayerと同じ
    //     _prevFace/_prevCol/_prevRow + getMoveProgress()方式を流用する。
    //     CubeRenderer._updateBombsがこれらのフィールドの有無を見て、
    //     あれば位置を補間しながら描画する)。蹴る能力自体は「蹴ろうとする
    //     プレイヤー」側が持つ(Player.canKickBombs)ため、爆弾自身は
    //     蹴れるかどうかの状態を持たない(GameScene._tryKickBomb参照)。
    this._prevFace = face;
    this._prevCol = col;
    this._prevRow = row;
    this._isSliding = false;
    this._moveStartAt = 0;
    this._moveDurationMs = BOMB_KICK_SLIDE_DURATION_MS;

    // 3D(サイコロステージ)モードでは見た目はCubeRendererがPlayerと同様に
    // 状態(face/col/row/detonated)を読み取って描画するため、Phaser用の
    // スプライトは生成しない（開発ルール9: 描画とロジックの分離）。
    if (!scene.render3D) {
      this._createSprite();
    }

    // 約3秒後に自動爆発するタイマー。誘爆時はdetonate()が先に呼ばれ、
    // その中でこのタイマーをキャンセルする。
    this.fuseTimer = scene.time.delayedCall(BOMB_FUSE_MS, () => this.detonate());
  }

  _createSprite() {
    const { x, y } = Collision.toPixel(this.col, this.row);
    // 「爆弾.pngを爆弾にしてほしい」への対応: GameScene.preload()で読み込んだ
    // 'bombIcon'テクスチャがあればそれを使い、無ければ(読込前・読込失敗時)
    // 従来の単色円にフォールバックする。
    // 【注記】実際のゲーム画面は常にrender3D=trueのため3D側(CubeRenderer)が
    // 描画を担っており、このメソッド自体は現状呼び出されない
    // (render3D=falseの将来的な2Dモード向けの保険としてのみ存在する)。
    if (this.scene.textures?.exists?.('bombIcon')) {
      this.sprite = this.scene.add.image(x, y, 'bombIcon');
      this.sprite.setDisplaySize(TILE_SIZE * 0.72, TILE_SIZE * 0.72);
    } else {
      this.sprite = this.scene.add.circle(x, y, TILE_SIZE * 0.32, 0x3b2a20);
      this.sprite.setStrokeStyle(3, 0x1a1208, 1);
    }
    this.sprite.setDepth(DEPTH.BOMB);

    // 膨張・収縮アニメーションで「今にも爆発しそう」な演出を行う。
    this.scene.tweens.add({
      targets: this.sprite,
      scale: { from: 1, to: 1.12 },
      duration: 400,
      yoyo: true,
      repeat: -1,
    });
  }

  /**
   * 💥(KICK)所持プレイヤーに蹴られて、同じ面内の別マスへ移動する。
   * 見た目の補間はPlayer.tryMove()と同じ考え方(位置は即座に更新し、
   * CubeRendererがgetMoveProgress()を使って前の位置から見た目だけ
   * 滑らかに補間する)。面をまたいだスライドは非対応(v1の割り切り。
   * GameScene._tryKickBomb参照)。
   * @param {number} col
   * @param {number} row
   * @param {number} now - scene.time.now(呼び出し側の現在時刻)
   * @param {number} tileCount - 何マス分スライドしたか(距離に応じてアニメーション時間を伸ばす)
   */
  slideTo(col, row, now, tileCount = 1) {
    this._prevFace = this.face;
    this._prevCol = this.col;
    this._prevRow = this.row;
    this.col = col;
    this.row = row;
    this._isSliding = true;
    this._moveStartAt = now;
    this._moveDurationMs = BOMB_KICK_SLIDE_DURATION_MS * Math.max(1, tileCount);
    this.scene.time.delayedCall(this._moveDurationMs, () => {
      this._isSliding = false;
    });
  }

  /**
   * 現在の見た目のスライド進捗を0(移動元)〜1(移動先=現在のcol/row)で返す。
   * Player.getMoveProgress()と同じ考え方(CubeRenderer._updateBombs参照)。
   * @param {number} now
   */
  getMoveProgress(now) {
    if (!this._isSliding) return 1;
    const raw = (now - this._moveStartAt) / this._moveDurationMs;
    return Math.max(0, Math.min(1, raw));
  }

  /** 誘爆・自然爆発どちらからも呼び出される爆発処理の入口 */
  detonate() {
    if (this.detonated) return;
    this.detonated = true;
    this.fuseTimer?.remove(false);
    this.sprite?.destroy();
    this.onDetonate(this);
  }

  destroy() {
    this.sprite?.destroy();
  }
}
