/**
 * Collision.js
 * ------------------------------------------------------------
 * グリッドベースの当たり判定ユーティリティ。
 * 描画(Phaser)や物理エンジンに依存せず、純粋なロジックとして
 * 座標変換・移動可否判定・爆風到達判定を提供する。
 * ------------------------------------------------------------
 */
import { TILE_SIZE, BLOCK_TYPES } from '../constants/GameConstants.js';

export class Collision {
  /** ピクセル座標 -> グリッド座標 */
  static toGrid(pixelX, pixelY) {
    return {
      col: Math.floor(pixelX / TILE_SIZE),
      row: Math.floor(pixelY / TILE_SIZE),
    };
  }

  /** グリッド座標 -> マス中央のピクセル座標 */
  static toPixel(col, row) {
    return {
      x: col * TILE_SIZE + TILE_SIZE / 2,
      y: row * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  /** 指定座標がマップ範囲内かどうか */
  static inBounds(col, row, cols, rows) {
    return col >= 0 && row >= 0 && col < cols && row < rows;
  }

  /**
   * プレイヤーがそのマスへ移動できるかを判定する。
   *
   * 仕様（フィードバック反映版）:
   * - 壊せない壁(HARD)は通り抜けできない（常に移動不可）。
   * - 壊せる壁(SOFT/ITEM)は、通り抜けアイテム(👻 GHOST)を取得済みの
   *   プレイヤー(options.canPassSoftBlock === true)に限り通り抜けできる。
   *   未取得のプレイヤーにとっては壊す/迂回するまで移動不可。
   * - 空白(EMPTY)は常に移動可能。
   *
   * @param {Array<Array<string>>} grid - Stage.jsが保持するブロック種別の2次元配列
   * @param {number} col
   * @param {number} row
   * @param {object} options - { canPassSoftBlock?: boolean }
   */
  static isWalkable(grid, col, row, options = {}) {
    if (!grid[row] || grid[row][col] === undefined) return false;
    const type = grid[row][col];
    if (type === BLOCK_TYPES.HARD) return false;
    if (type === BLOCK_TYPES.SOFT || type === BLOCK_TYPES.ITEM) {
      return !!options.canPassSoftBlock;
    }
    return true; // EMPTY
  }

  /** 2つのグリッド座標が一致するか（爆風とプレイヤー等の当たり判定に使用） */
  static sameTile(a, b) {
    return a.col === b.col && a.row === b.row;
  }
}
