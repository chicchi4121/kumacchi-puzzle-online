/**
 * SupabaseClient.js
 * ------------------------------------------------------------
 * Supabase JS SDKをCDN(import map経由)から遅延ロードし、単一の
 * クライアントインスタンスを使い回すためのモジュール。
 *
 * VRMSystem.js / CubeRenderer.jsがThree.jsをCDNから遅延ロードしている
 * のと全く同じパターン（開発ルール9の応用）。実際に接続が必要になる
 * 瞬間(オンライン対戦・ランキング機能の利用時)まではSupabase JS SDK
 * 自体を読み込まないため、Node上のユニットテストではこのモジュールの
 * importだけなら安全に行える(getClient()を実際に呼ばない限りCDNへは
 * 一切アクセスしない)。
 *
 * SUPABASE_URL/SUPABASE_ANON_KEYが未設定の場合はgetClient()がnullを
 * 返し、呼び出し側(NetworkSystem.js/RankingSystem.js)はローカルの
 * フォールバック動作に切り替える。
 * ------------------------------------------------------------
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from '../config/supabaseConfig.js';

let clientPromise = null;

/**
 * Supabaseクライアントを取得する。未設定時はnullを返す(例外は投げない。
 * 呼び出し側で `if (!client) { ...ローカル動作... }` と分岐しやすくするため)。
 * @returns {Promise<import('@supabase/supabase-js').SupabaseClient|null>}
 */
export async function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;

  if (!clientPromise) {
    console.log('[SupabaseClient] Supabase JS SDKをCDNから読み込み中...');
    clientPromise = import(/* webpackIgnore: true */ '@supabase/supabase-js')
      .then(({ createClient }) => {
        console.log('[SupabaseClient] Supabase JS SDKの読み込みに成功しました。接続を開始します。');
        return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          realtime: {
            params: {
              // 1秒あたりの受信イベント数の上限(既定値のままだと大人数対戦時に
              // stateブロードキャストが間引かれる恐れがあるため少し引き上げる)。
              eventsPerSecond: 20,
            },
          },
        });
      })
      .catch((e) => {
        // 次回呼び出し時に再試行できるようキャッシュを破棄する。
        clientPromise = null;
        console.error(
          '[SupabaseClient] Supabase JS SDKのCDN読み込み、または接続に失敗しました。' +
            'ネットワーク環境やsupabaseConfig.jsのURL/キー設定をご確認ください。',
          e
        );
        throw e;
      });
  }
  return clientPromise;
}

/** テスト・再接続用: キャッシュ済みクライアントを破棄する */
export function resetSupabaseClient() {
  clientPromise = null;
}
