/**
 * BattleSystem.js
 * ------------------------------------------------------------
 * 対戦の勝敗判定・進行・順位確定を統括するシステム。
 * GameSceneはこのシステムに「プレイヤーがやられた」等のイベントを
 * 通知し、本システムが勝利条件（最後の1人 / 人間の全滅）と最終順位を判定する。
 *
 * 【2026-07更新】
 * ・「制限時間を過ぎたら終わりではなく、残り一人になるまで爆弾が沢山
 *   降ってくるようにしてほしい」への対応: 制限時間(timeLimitMs)に到達
 *   しても即座に勝敗を決めず、代わりにsuddenDeathフラグを立てるだけに
 *   した。実際に「爆弾を降らせる」演出・処理はGameScene側
 *   (_updateSuddenDeathBombRain等)がこのフラグを見て行う(開発ルール9:
 *   演出に関わる処理はSceneに任せ、本クラスは純粋な勝敗判定ロジックに
 *   留める)。試合は結局、生存者が1人になるまで(既存の
 *   「alivePlayers.length<=1」判定)続く。
 * ・「プレイヤーが負けたら終わりにしてほしい」への対応: 人間プレイヤー
 *   (options.humanPlayers)が全員死亡した時点で、AI同士の決着を待たずに
 *   即座に勝敗を決定するようにした(_decideWinnerByScoreを、以前の
 *   「時間切れ時」から「人間全滅時」の判定へ転用)。
 * ------------------------------------------------------------
 */
import { random } from '../utils/Random.js';

export class BattleSystem {
  /**
   * @param {Array<Player>} players
   * @param {object} options - { timeLimitMs, humanPlayers }
   *   humanPlayers: このクライアントが把握している「実際の人間が操作する
   *   プレイヤー」の配列(オンライン対戦のホストでは接続中の全員分)。
   *   省略時は「人間が負けたら即終了」判定自体を行わない(単体テスト等、
   *   人間/AIの区別が無い呼び出し向けの後方互換)。
   */
  constructor(players, options = {}) {
    this.players = players;
    this.timeLimitMs = options.timeLimitMs ?? 180000; // デフォルト3分
    this.humanPlayers = options.humanPlayers ?? null;
    this.elapsedMs = 0;
    this.isOver = false;
    this.winner = null;
    this.deathOrder = []; // 死亡した順（先に死んだプレイヤーが先頭）
    this.finalRanks = new Map(); // playerId -> 最終順位(1が1位)
    // 制限時間到達後、生存者1人になるまで爆弾が降り続ける「サドンデス」状態。
    this.suddenDeath = false;
  }

  update(delta) {
    if (this.isOver) return;
    this.elapsedMs += delta;

    const alivePlayers = this.players.filter((p) => p.isAlive);

    if (alivePlayers.length <= 1 && this.players.length > 1) {
      this._finish(alivePlayers[0] ?? null);
      return;
    }

    // 「プレイヤーが負けたら終わりにしてほしい」: 人間プレイヤーが
    // (1人でも複数人でも)全員死亡していれば、残るAI同士の決着を待たず
    // 即座に勝敗を決める。
    if (this.humanPlayers && this.humanPlayers.length > 0 && this.humanPlayers.every((p) => !p.isAlive)) {
      this._finish(this._decideWinnerByScore());
      return;
    }

    if (!this.suddenDeath && this.elapsedMs >= this.timeLimitMs) {
      this.suddenDeath = true;
    }
  }

  /** GameSceneはプレイヤーが死亡した瞬間にこれを呼び出す */
  notifyPlayerDied(player) {
    if (!this.deathOrder.includes(player)) {
      this.deathOrder.push(player);
    }
  }

  /**
   * 進行中の暫定順位を返す。生存中は「まだ確定していない(null)」を返し、
   * 死亡したプレイヤーには「その時点で何位が確定したか」を返す
   * （最後まで生き残った1人が1位、最初に死んだプレイヤーが最下位）。
   */
  getLiveRank(player) {
    if (player.isAlive) {
      const aliveCount = this.players.filter((p) => p.isAlive).length;
      return aliveCount <= 1 ? 1 : null;
    }
    const deathIndex = this.deathOrder.indexOf(player);
    if (deathIndex === -1) return null;
    return this.players.length - deathIndex;
  }

  /**
   * 人間プレイヤーが全滅し、残るAI同士の決着を待たずに即座に勝敗を決める
   * 際に使う: 残機 → スコア(撃破数) → 抽選 の優先順位で、現在生存中の
   * プレイヤーの中から勝者を決定する。
   */
  _decideWinnerByScore() {
    const alive = this.players.filter((p) => p.isAlive);
    if (alive.length === 0) return null;

    const maxLives = Math.max(...alive.map((p) => p.lives));
    let candidates = alive.filter((p) => p.lives === maxLives);
    if (candidates.length === 1) return candidates[0];

    // 残機が同点の場合は撃破数(スコア)で判定する
    const maxKills = Math.max(...candidates.map((p) => p.stats?.kills ?? 0));
    candidates = candidates.filter((p) => (p.stats?.kills ?? 0) === maxKills);
    if (candidates.length === 1) return candidates[0];

    // それでも同点の場合は抽選（ランダム選出）
    return candidates[random.nextInt(0, candidates.length)];
  }

  _finish(winner) {
    this.isOver = true;
    this.winner = winner;
    this._computeFinalRanks(winner);
  }

  /** 勝者を1位、時間切れ時の他の生存者を残機/撃破数で順位付けし、
   *  死亡済みプレイヤーは死亡順(直近に死んだ方が上位)で埋める。 */
  _computeFinalRanks(winner) {
    const ranked = [];
    if (winner) ranked.push(winner);

    const aliveOthers = this.players.filter((p) => p.isAlive && p !== winner);
    aliveOthers.sort((a, b) => {
      if (b.lives !== a.lives) return b.lives - a.lives;
      return (b.stats?.kills ?? 0) - (a.stats?.kills ?? 0);
    });
    ranked.push(...aliveOthers);

    ranked.push(...[...this.deathOrder].reverse());

    this.finalRanks = new Map();
    ranked.forEach((p, i) => this.finalRanks.set(p.playerId, i + 1));
  }
}
