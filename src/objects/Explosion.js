/**
 * Explosion.js
 * ------------------------------------------------------------
 * 爆風の伝播範囲を計算し、爆風エフェクトを描画するクラス。
 *
 * ロジック（どのマスまで爆風が届くか）と描画（エフェクト表示）を
 * 分離するため、範囲計算は静的メソッド`computeBlastTiles`として
 * Phaserに依存しない純粋関数にしてある（開発ルール9）。
 * ------------------------------------------------------------
 */
import { TILE_SIZE, EXPLOSION_LIFETIME_MS, BLOCK_TYPES, DEPTH } from '../constants/GameConstants.js';
import { Collision } from '../utils/Collision.js';

const DIRECTIONS = [
  { dCol: 0, dRow: -1 }, // 上
  { dCol: 0, dRow: 1 }, // 下
  { dCol: -1, dRow: 0 }, // 左
  { dCol: 1, dRow: 0 }, // 右
];

export class Explosion {
  /**
   * 爆風が届くマスを計算する。壁(HARD)で停止し、壊せるブロックに
   * 当たった場合はそのマスまでは爆風が届いて破壊されるが、そこで止まる
   * （伝統的なボンバーマンの爆風挙動）。
   *
   * @param {Stage} stage
   * @param {number} originCol
   * @param {number} originRow
   * @param {number} range - 爆風の届く最大マス数
   * @param {object} options - { dryRun: boolean } trueの場合ブロックを実際には
   *   破壊せず範囲計算のみ行う（AIの危険地帯予測など、盤面を変えずに
   *   「もし爆発したら」を調べたい場合に使用する）。
   * @returns {{ tiles: Array<{col:number,row:number}>, broken: Array<{col:number,row:number,spawnItem:boolean,itemType:?string}> }}
   */
  static computeBlastTiles(stage, originCol, originRow, range, options = {}) {
    const { dryRun = false } = options;
    const tiles = [{ col: originCol, row: originRow }];
    const broken = [];

    for (const dir of DIRECTIONS) {
      for (let step = 1; step <= range; step++) {
        const col = originCol + dir.dCol * step;
        const row = originRow + dir.dRow * step;
        const type = stage.getBlockType(col, row);

        if (type === BLOCK_TYPES.HARD) {
          break; // 壁で停止（このマスには到達しない）
        }

        tiles.push({ col, row });

        if (type === BLOCK_TYPES.SOFT || type === BLOCK_TYPES.ITEM) {
          if (dryRun) {
            // 予測のみ：盤面は変更せずここで停止したことにする
            broken.push({ col, row, spawnItem: type === BLOCK_TYPES.ITEM, itemType: null });
          } else {
            const result = stage.breakBlock(col, row);
            if (result.destroyed) {
              broken.push({ col, row, spawnItem: result.spawnItem, itemType: result.itemType ?? null });
            }
          }
          break; // ブロックを破壊したらそこで爆風は止まる
        }
        // EMPTYの場合はそのまま次のマスへ爆風が伝播する
      }
    }

    return { tiles, broken };
  }

  /**
   * 爆風エフェクトを描画する（見た目のみ。当たり判定はGameScene側でtilesを使って行う）。
   * @param {Phaser.Scene} scene
   * @param {Array<{col:number,row:number}>} tiles
   */
  static render(scene, tiles) {
    for (const tile of tiles) {
      const { x, y } = Collision.toPixel(tile.col, tile.row);
      const fx = scene.add.rectangle(x, y, TILE_SIZE - 6, TILE_SIZE - 6, 0xff9642, 0.85);
      fx.setDepth(DEPTH.EXPLOSION);
      scene.tweens.add({
        targets: fx,
        alpha: 0,
        duration: EXPLOSION_LIFETIME_MS,
        onComplete: () => fx.destroy(),
      });
    }
  }
}
