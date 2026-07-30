/**
 * RankingSystem.js
 * ------------------------------------------------------------
 * Supabaseと連携し、対戦成績ランキングの送信・取得を担当するシステム。
 *
 * Supabase未設定(src/config/supabaseConfig.js)の場合は、LocalStorage
 * (Save.js)のランキングキャッシュを参照・追記するだけのモックとして
 * 動作する(開発ルール8と同じ「機能の有無がゲーム本体に影響しない」
 * フォールバック設計)。
 *
 * テーブル定義・RLS設定は`supabase/schema.sql`を参照。1試合につき、
 * 参加した各プレイヤー(人間・AI問わず)ごとに1行を記録する「対戦ログ」
 * 形式のシンプルなテーブルになっている。
 *
 * 【表示ランキングは勝利数順】テーブル自体は対戦ログ(1試合1行)のままだが、
 * 表示用のランキングは「プレイヤー名ごとの勝利数(rank===1の行数)」を
 * 集計し、勝利数が多い順に並べたものにしている(同数の場合は参考として
 * 総獲得exp降順)。専用の集計テーブル/ビューを作らず、対戦ログを広めに
 * 取得してからJS側で集計する方式にすることで、schema.sqlの変更なしに
 * 対応できるようにした。
 * ------------------------------------------------------------
 */
import { Save } from '../utils/Save.js';
import { getSupabaseClient } from './SupabaseClient.js';

const RANKING_TABLE = 'rankings';
// 勝利数集計のため対戦ログを広めに取得する件数の上限(全プレイヤー分の
// 直近の対戦ログをまとめて取得し、JS側でplayer_nameごとに集計する)。
const RANKING_AGGREGATE_FETCH_LIMIT = 2000;

export class RankingSystem {
  constructor() {
    this._clientPromise = null;
  }

  async _getClient() {
    if (!this._clientPromise) {
      this._clientPromise = getSupabaseClient().catch((e) => {
        console.warn('[RankingSystem] Supabaseへの接続に失敗したため、ローカル保存のみで動作します。', e);
        return null;
      });
    }
    return this._clientPromise;
  }

  /**
   * ランキング上位を取得する(勝利数の多い順)。Supabase未設定・取得失敗時は
   * ローカルキャッシュ(自分の端末での対戦履歴のみ)にフォールバックする。
   * @param {number} limit
   * @returns {Promise<Array<object>>} - [{ player_name, wins, matches, kills, exp }, ...]
   */
  async fetchRanking(limit = 20) {
    const client = await this._getClient();
    if (!client) {
      return this._aggregateWins(Save.getRankingCache(), limit);
    }
    try {
      const { data, error } = await client
        .from(RANKING_TABLE)
        .select('player_name, mode, rank, kills, bombs_exploded, items_collected, exp, is_human, created_at')
        .order('created_at', { ascending: false })
        .limit(RANKING_AGGREGATE_FETCH_LIMIT);
      if (error) throw error;
      return this._aggregateWins(data ?? [], limit);
    } catch (e) {
      console.warn('[RankingSystem] ランキングの取得に失敗しました。ローカルキャッシュを表示します。', e);
      return this._aggregateWins(Save.getRankingCache(), limit);
    }
  }

  /**
   * 対戦ログ(1試合1行、rank===1が勝利)を、プレイヤー名ごとの
   * 勝利数(wins)・試合数(matches)・累計撃破数(kills)・累計exp(exp)に
   * 集計し、勝利数の多い順(同数ならexp降順)に並べ替える。
   * @param {Array<object>} rows - 対戦ログ(player_name/rank/kills/exp等)
   * @param {number} limit
   */
  _aggregateWins(rows, limit) {
    const byName = new Map();
    for (const row of rows ?? []) {
      const name = row.player_name ?? row.playerName ?? 'プレイヤー';
      if (!byName.has(name)) {
        byName.set(name, { player_name: name, wins: 0, matches: 0, kills: 0, exp: 0 });
      }
      const entry = byName.get(name);
      entry.matches += 1;
      entry.kills += row.kills ?? 0;
      entry.exp += row.exp ?? 0;
      if (row.rank === 1) entry.wins += 1;
    }
    return [...byName.values()].sort((a, b) => b.wins - a.wins || b.exp - a.exp).slice(0, limit);
  }

  /**
   * 1人分の対戦結果を記録する。常にローカルキャッシュにも追記しておく
   * (Supabase接続失敗時のフォールバック・オフラインでも自分の履歴だけは
   * 見られるようにするため)。
   * @param {object} result - { playerName, mode, rank, kills, bombsExploded, itemsCollected, exp, isHuman }
   */
  async submitResult(result) {
    const record = {
      player_name: result.playerName ?? 'プレイヤー',
      mode: result.mode ?? 'ai',
      rank: result.rank ?? null,
      kills: result.kills ?? 0,
      bombs_exploded: result.bombsExploded ?? 0,
      items_collected: result.itemsCollected ?? 0,
      exp: result.exp ?? 0,
      is_human: !!result.isHuman,
    };

    const cache = Save.getRankingCache();
    cache.push({ ...record, created_at: new Date().toISOString() });
    Save.setRankingCache(cache.slice(-200)); // ローカルは肥大化しないよう直近200件までに制限

    const client = await this._getClient();
    if (!client) return;
    try {
      const { error } = await client.from(RANKING_TABLE).insert(record);
      if (error) throw error;
    } catch (e) {
      console.warn('[RankingSystem] Supabaseへのランキング送信に失敗しました(ローカルには保存済みです)。', e);
    }
  }
}

export const rankingSystem = new RankingSystem();
