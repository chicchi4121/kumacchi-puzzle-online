/**
 * Item.js
 * ------------------------------------------------------------
 * フィールド上に出現するアイテムの見た目と種別を管理するクラス。
 * 出現・取得・効果適用の実処理はGameScene（出現）とItemSystem.js
 * （効果適用）が担当し、本クラスは見た目（絵文字プレースホルダー）
 * のみを管理する（開発ルール9: 描画とロジックの分離）。
 * ------------------------------------------------------------
 */
import { TILE_SIZE, ITEM_TYPES, DEPTH } from '../constants/GameConstants.js';
import { Collision } from '../utils/Collision.js';

// アイテム種別ごとの絵文字表示（画像アセット未整備の間のプレースホルダー）
// CubeRendererが3D空間上のテクスチャ描画にも同じ絵文字を使うためexportする。
export const ITEM_EMOJI = Object.freeze({
  [ITEM_TYPES.BOMB_UP]: '💣',
  [ITEM_TYPES.FIRE_UP]: '🔥',
  [ITEM_TYPES.SPEED_UP]: '👟',
  [ITEM_TYPES.SHIELD]: '🛡',
  [ITEM_TYPES.LIFE_UP]: '❤️',
  [ITEM_TYPES.GHOST]: '👻',
  [ITEM_TYPES.KICK]: '💥',
  [ITEM_TYPES.TIMER]: '⏱',
});

let nextItemInstanceId = 1;

export class Item {
  /**
   * @param {Phaser.Scene} scene
   * @param {string} face - サイコロ6面ステージ上でこのアイテムが出現している面
   * @param {number} col
   * @param {number} row
   * @param {string} type
   * @param {object} options - { id } オンライン対戦での状態同期用の安定ID(Bomb.js参照)
   */
  constructor(scene, face, col, row, type, options = {}) {
    this.scene = scene;
    this.face = face;
    this.col = col;
    this.row = row;
    this.type = type;
    this.id = options.id ?? nextItemInstanceId++;

    // 3D(サイコロステージ)モードではCubeRendererが状態(face/col/row/type)を
    // 読み取って描画するため、Phaser用のスプライトは生成しない。
    if (!scene.render3D) {
      const { x, y } = Collision.toPixel(col, row);
      this.sprite = scene.add.text(x, y, ITEM_EMOJI[type] ?? '?', {
        fontSize: `${Math.floor(TILE_SIZE * 0.6)}px`,
      });
      this.sprite.setOrigin(0.5, 0.5);
      this.sprite.setDepth(DEPTH.ITEM);
    }
  }

  destroy() {
    this.sprite?.destroy();
  }
}
