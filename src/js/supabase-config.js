// ==========================================================
// Supabase接続設定
// Supabaseダッシュボード > Project Settings > API から
// 以下の2つをコピーして書き換えてください。
// - Project URL     → SUPABASE_URL
// - anon public key → SUPABASE_ANON_KEY (公開しても問題ない方の鍵です)
// ==========================================================

const SUPABASE_URL = 'https://dbbvqirohosnnoalelow.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_f9UnfnfFsf18fS1NgUvUgQ_l66_5TW7';

let supabaseClient = null;
if (
  typeof window.supabase !== 'undefined' &&
  SUPABASE_URL !== 'YOUR_SUPABASE_URL_HERE' &&
  SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY_HERE'
) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.warn('Supabaseが未設定です。src/js/supabase-config.js にURLとanon keyを設定してください。');
}
