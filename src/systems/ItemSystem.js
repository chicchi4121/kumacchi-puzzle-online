/**
 * ItemSystem.js
 * ------------------------------------------------------------
 * アイテムの出現・取得・効果付与を統括するシステム。
 * データ駆動設計（開発ルール6）に基づき、アイテム効果は
 * ITEM_TYPES(GameConstants.js)に対応するハンドラ関数の
 * マップとして定義し、追加・変更しやすくする。
 * ------------------------------------------------------------
 */
import { ITEM_TYPES } from '../constants/GameConstants.js';

// アイテム種別ごとの効果適用ハンドラ（データ駆動）
const ITEM_EFFECTS = {
  [ITEM_TYPES.BOMB_UP]: (player) => {
    player.maxBombs = Math.min(player.maxBombs + 1, 10);
  },
  [ITEM_TYPES.FIRE_UP]: (player) => {
    player.blastRange = Math.min(player.blastRange + 1, 10);
  },
  [ITEM_TYPES.SPEED_UP]: (player) => {
    player.speedMultiplier = Math.min(player.speedMultiplier + 0.3, 2.5);
  },
  [ITEM_TYPES.SHIELD]: (player, scene) => {
    player.invincibleUntil = scene.time.now + 5000;
  },
  [ITEM_TYPES.LIFE_UP]: (player) => {
    player.lives += 1;
  },
  [ITEM_TYPES.GHOST]: (player) => {
    player.canPassSoftBlock = true;
  },
  [ITEM_TYPES.KICK]: (player) => {
    player.canKickBombs = true;
  },
};

export class ItemSystem {
  /**
   * プレイヤーがアイテムを取得した際に呼び出す。
   * @param {Player} player
   * @param {string} itemType - ITEM_TYPESのいずれか
   * @param {Phaser.Scene} scene
   */
  static applyItem(player, itemType, scene) {
    const effect = ITEM_EFFECTS[itemType];
    if (effect) effect(player, scene);
  }
}
