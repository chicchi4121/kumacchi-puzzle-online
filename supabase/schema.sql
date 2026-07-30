-- ------------------------------------------------------------
-- くまっちボム！ - Supabaseスキーマ (ランキング機能用)
-- ------------------------------------------------------------
-- Supabaseダッシュボード → 「SQL Editor」→ 「New query」に、この内容を
-- そのまま貼り付けて実行してください(RUNボタン)。
--
-- 注意: オンライン対戦(部屋作成・入力/状態の同期)そのものはSupabase
-- Realtimeの「Broadcast」「Presence」機能のみを使い、テーブルへの保存を
-- 一切行わないため、このスキーマにオンライン対戦用のテーブルはありません
-- (Realtime機能はSupabaseプロジェクトでデフォルト有効です。追加設定は
-- 不要です)。ここで作るのは「対戦結果ランキング」表示用のテーブルのみです。
-- ------------------------------------------------------------

-- 1試合につき、参加した各プレイヤー(人間・AI問わず)ごとに1行を記録する
-- 「対戦ログ」形式のシンプルなランキングテーブル。
create table if not exists public.rankings (
  id bigint generated always as identity primary key,
  player_name text not null default 'プレイヤー',
  mode text not null default 'ai', -- 'ai' | 'pvp'(ローカル対戦) | 'online'
  rank integer,
  kills integer not null default 0,
  bombs_exploded integer not null default 0,
  items_collected integer not null default 0,
  exp integer not null default 0,
  is_human boolean not null default true,
  created_at timestamptz not null default now()
);

-- ランキング表示を軽くするためのインデックス(exp降順で上位N件を取得する。
-- 現在は使っていないが、将来expベースの表示に戻す場合のために残してある)。
create index if not exists rankings_exp_idx on public.rankings (exp desc);

-- 表示ランキングは「プレイヤー名ごとの勝利数」順(クライアント側で集計する
-- 方式、RankingSystem.js参照)にしたため、直近の対戦ログをまとめて取得する
-- クエリ(created_at降順)を軽くするインデックスも用意しておく。
create index if not exists rankings_created_at_idx on public.rankings (created_at desc);

-- Row Level Security(RLS)を有効化する。
alter table public.rankings enable row level security;

-- 【重要・既知の制限】このゲームには専用のバックエンド(サーバー)が無く、
-- ブラウザからanon(publishable)キーで直接Supabaseへ書き込む構成のため、
-- 「本当に対戦した結果か」をサーバー側で検証する手段がありません。
-- 以下のポリシーは「誰でも読める・誰でも1行ずつ追加できる」という
-- 最も単純な設定です。カジュアルな身内向けランキングとしては十分ですが、
-- 悪意のある第三者がanonキーを使って不正なスコアを大量投稿することを
-- 完全には防げない点をご了承ください(将来的にSupabase Edge Functions
-- 等でサーバー側検証を挟むことで対策できます)。
create policy if not exists "rankings_public_read"
  on public.rankings for select
  to anon
  using (true);

create policy if not exists "rankings_public_insert"
  on public.rankings for insert
  to anon
  with check (
    -- 明らかにおかしい値(負数・異常に大きいexp等)だけは最低限弾いておく。
    kills >= 0 and kills <= 999
    and bombs_exploded >= 0 and bombs_exploded <= 9999
    and items_collected >= 0 and items_collected <= 9999
    and exp >= 0 and exp <= 100000
    and char_length(player_name) <= 40
  );
