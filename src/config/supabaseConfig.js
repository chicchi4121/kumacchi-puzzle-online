/**
 * supabaseConfig.js
 * ------------------------------------------------------------
 * Supabaseプロジェクトへの接続情報。
 *
 * 【設定方法】
 *  1. https://supabase.com で無料プランのプロジェクトを作成する
 *     （まだアカウントが無い場合はこの手順から）。
 *  2. プロジェクトのダッシュボード → 「SQL Editor」を開き、同梱の
 *     `supabase/schema.sql` の内容をそのまま実行する（ランキング用の
 *     テーブルとアクセス権限(RLS)が作成される。オンライン対戦自体は
 *     Realtimeのbroadcast/presenceのみを使うためテーブル不要）。
 *  3. プロジェクトのダッシュボード → 「Project Settings」→「API」で
 *     "Project URL" と "anon public"キー（新しいダッシュボードでは
 *     "Publishable key"と表記される場合がある）を確認し、下記の
 *     SUPABASE_URL / SUPABASE_ANON_KEY にそのまま貼り付ける。
 *
 * 【anon keyを公開しても大丈夫？】
 *  anon/publishableキーはブラウザ上のクライアントコードに埋め込む前提で
 *  Supabaseが設計しているキーであり、秘密情報ではない（実際のアクセス
 *  制御はSupabase側のRow Level Security(RLS)ポリシーで行う。
 *  `supabase/schema.sql`のRLS設定を参照）。一方でservice_roleキー等の
 *  「secret」系キーは絶対にここへ書かない・ブラウザに公開しないこと。
 *
 * 未設定(空文字のまま)の場合、オンライン対戦・オンラインランキング機能は
 * 自動的に無効化され、「Supabase未設定」のメッセージを表示した上で
 * ローカル対戦(AI戦・同一キーボードでのPVP)は従来通りプレイできる
 * （開発ルール8と同じ「機能の有無がゲーム本体に影響しない」設計）。
 * ------------------------------------------------------------
 */
export const SUPABASE_URL = 'https://bgmfzrphcoorqicfbgju.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_RmISk5lB0Tdcpyf8P4n4CA_s4yzlNr3';

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
