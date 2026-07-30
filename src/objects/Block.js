/**
 * Block.js
 * ------------------------------------------------------------
 * 1マス分のブロックの「見た目」を管理するクラス。
 * ブロックの状態（壊せる/壊せない/アイテム入り）そのものは
 * Stage.jsが真実のデータとして保持し、Blockはその描画表現のみを担当する
 * （描画とロジックの分離：開発ルール9）。
 * ------------------------------------------------------------
 */
import { TILE_SIZE, BLOCK_TYPES, DEPTH } from '../constants/GameConstants.js';

// ブロック種別ごとの色（画像アセット未用意の段階ではプレースホルダー描画とする）
const BLOCK_COLORS = Object.freeze({
  [BLOCK_TYPES.HARD]: 0x555555,
  [BLOCK_TYPES.SOFT]: 0xa0623b,
  [BLOCK_TYPES.ITEM]: 0xc98a54,
});

export class Block {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} col
   * @param {number} row
   * @param {string} type - BLOCK_TYPESのいずれか
   */
  constructor(scene, col, row, type) {
    this.scene = scene;
    this.col = col;
    this.row = row;
    this.type = type;
    this.sprite = null;

    if (type !== BLOCK_TYPES.EMPTY) {
      this._createSprite();
    }
  }

  _createSprite() {
    const x = this.col * TILE_SIZE + TILE_SIZE / 2;
    const y = this.row * TILE_SIZE + TILE_SIZE / 2;
    const color = BLOCK_COLORS[this.type] ?? 0xffffff;

    // TODO(Phase2): 画像アセット(assets/images/*)が用意され次第、
    // rectangleではなくsceneに事前ロードした画像スプライトに差し替える。
    this.sprite = this.scene.add.rectangle(x, y, TILE_SIZE - 2, TILE_SIZE - 2, color);
    this.sprite.setDepth(DEPTH.BLOCK);
    this.sprite.setStrokeStyle(1, 0x000000, 0.15);
  }

  /** ブロック破壊時の演出とスプライト破棄 */
  destroy() {
    if (this.sprite) {
      this.scene.tweens.add({
        targets: this.sprite,
        alpha: 0,
        scale: 0.6,
        duration: 150,
        onComplete: () => this.sprite?.destroy(),
      });
      this.sprite = null;
    }
    this.type = BLOCK_TYPES.EMPTY;
  }
}
