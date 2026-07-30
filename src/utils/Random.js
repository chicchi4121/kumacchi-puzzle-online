/**
 * Random.js
 * ------------------------------------------------------------
 * 乱数生成をこのユーティリティ経由に統一するためのモジュール。
 * ・毎試合「完全ランダム生成」であることを保証しつつ、
 *   将来的にシード固定（リプレイ機能・デバッグ用）にも対応できるよう
 *   Math.randomを直接使わずラップしている。
 * ------------------------------------------------------------
 */
export class Random {
  /**
   * @param {number|null} seed - シードを指定すると再現可能な乱数列になる。
   *                             nullの場合は毎回完全ランダム。
   */
  constructor(seed = null) {
    this.seed = seed;
    // シードが指定された場合は簡易な線形合同法(LCG)で決定的な乱数を生成する。
    this._state = seed !== null ? seed >>> 0 : null;
  }

  /** 0以上1未満の浮動小数点乱数を返す */
  next() {
    if (this._state === null) {
      return Math.random();
    }
    // LCGパラメータ（Numerical Recipes準拠）
    this._state = (Math.imul(1664525, this._state) + 1013904223) >>> 0;
    return this._state / 0xffffffff;
  }

  /** min以上max未満の整数乱数を返す */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /** 配列からランダムに1要素を選んで返す */
  pick(array) {
    if (!array || array.length === 0) return undefined;
    return array[this.nextInt(0, array.length)];
  }

  /** 確率(0〜1)でtrueを返す */
  chance(probability) {
    return this.next() < probability;
  }

  /** 配列をFisher-Yatesアルゴリズムでシャッフルする（破壊的） */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

// アプリ全体で共有する既定インスタンス（シードなし＝完全ランダム）
export const random = new Random();
