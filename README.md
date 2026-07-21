# くまっちパズル

対戦型落ちものパズルゲーム。2個1組のカラーブロックを操作し、同じ色を4個以上つなげて消していく。

## ディレクトリ構成

```
kumacchi-puzzle/
├── index.html            # タイトル画面(エントリーポイント)
├── game.html             # ソロプレイ
├── battle.html           # AI対戦
├── online.html           # オンライン対戦(PVP)
├── ranking.html          # ランキング
├── assets/
│   ├── images/
│   └── audio/
├── src/
│   ├── css/
│   │   ├── style.css     # タイトル画面
│   │   ├── game.css      # ソロプレイ
│   │   ├── battle.css    # AI対戦・オンライン対戦共通(対戦アリーナのレイアウト)
│   │   ├── online.css    # オンライン対戦のロビー画面
│   │   └── ranking.css
│   └── js/
│       ├── title.js
│       ├── game.js
│       ├── puzzle-core.js      # 盤面の共通ロジック(AI対戦・オンライン対戦から読み込まれる)
│       ├── battle.js           # AI対戦
│       ├── online-battle.js    # オンライン対戦(マッチング・盤面同期)
│       ├── ranking.js
│       └── supabase-config.js
├── supabase/
│   └── schema.sql        # ランキング用テーブル + オンライン対戦マッチング用テーブル/RPC
└── README.md
```

## ローカルでの確認方法

ブラウザで `index.html` を直接開くか、ローカルサーバーを立てて確認できます。

```bash
# Python がある場合
python3 -m http.server 8000
# → http://localhost:8000 で確認
```

## GitHubへのアップロード手順

1. GitHub上で新しいリポジトリを作成する(例: `kumacchi-puzzle`)
2. このフォルダの中身をそのままアップロード、またはgitで push する

```bash
cd kumacchi-puzzle
git init
git add .
git commit -m "Initial commit: title screen"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/kumacchi-puzzle.git
git push -u origin main
```

## Renderへのデプロイ手順(Static Site)

現時点(タイトル画面のみ)はサーバー処理が不要な静的サイトなので、
Renderの **Static Site** を使うのが最もシンプルです。

1. Renderのダッシュボードで **New +** → **Static Site** を選択
2. 連携したGitHubリポジトリ(`kumacchi-puzzle`)を選択
3. 設定項目
   - **Build Command**: (空欄でOK。ビルド処理不要)
   - **Publish Directory**: `.` (リポジトリのルート)
4. **Create Static Site** をクリックすればデプロイ完了

## 今後の構成変更について

- ソロプレイ・AI対戦・オンライン対戦のいずれもブラウザだけで動くため、
  Renderの構成は引き続き **Static Site のままで問題ありません**。
- オンライン対戦のリアルタイム通信は、Supabaseの **Realtime(Broadcast/Presence)** を
  そのままクライアント同士の通信に使っており、自前のNode.jsサーバーは不要です
  (以前のREADMEでは「Web Serviceへの切り替えが必要」としていましたが、
  Supabase Realtimeを使うことで不要になりました)。

## Supabase連携(ランキング機能)のセットアップ手順

1. https://supabase.com でアカウントを作成し、新しいプロジェクトを作成する
2. プロジェクト作成後、左メニューの **SQL Editor** を開き、
   このリポジトリの `supabase/schema.sql` の中身を貼り付けて実行する
   (`scores` テーブルとアクセス権限が作成されます)
3. 左メニューの **Project Settings → API** を開き、以下の2つをコピーする
   - **Project URL**
   - **anon public key**
4. `src/js/supabase-config.js` を開き、以下の2箇所を書き換える

```js
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';       // ← コピーしたProject URLに置き換える
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE'; // ← コピーしたanon public keyに置き換える
```

5. 保存してGitHubにアップロードし直せば、Renderに自動反映されます

これで、ゲームオーバー画面の「ランキングに登録」ボタンからスコアを送信でき、
`ranking.html`(タイトル画面の「🏆 ランキングを見る」リンク)で
ソロプレイ・AI対戦それぞれの上位20件を確認できるようになります。

**注意**: `anon public key` は「公開されても問題ない」設計の鍵です(閲覧・登録のみ許可し、
更新・削除は許可しないポリシーを `schema.sql` で設定しています)。
一方で、データベースの管理用パスワードや `service_role key` は絶対にコードに含めたり
GitHubにアップロードしたりしないでください。

## オンライン対戦(PVP)について

タイトル画面の「🌐 オンライン対戦」から、`online.html` で対戦相手とオンラインで対戦できます。
対戦相手の探し方は2種類です。

- **ルームコードで対戦**: 「ルームを作る」を押すと6桁のコードが発行されるので、
  友達に伝えて「ルームに参加する」から入力してもらう
- **ランダムマッチング**: 「対戦相手を探す」を押すと、同じタイミングで探している
  他のプレイヤーと自動でマッチングする

### 仕組み(サーバー不要の設計)

- 自分側の盤面は今まで通りブラウザ内で完結して動かし、相手側の盤面は
  Supabaseの **Realtime Broadcast** で送られてくる盤面スナップショットを
  そのまま描画する「ミラー」として扱っています。これにより、自前のゲームサーバーを
  持たずに、今の静的サイト構成のままオンライン対戦を実現しています。
- ランダムマッチングだけは、対戦相手を探し出すために `supabase/schema.sql` に追加した
  `matchmaking_queue` テーブルと `find_or_create_match` というRPC(Postgres関数)を
  使います。クライアントは1.8秒おきにこのRPCを呼び出し、他に待機中のプレイヤーがいれば
  自動でペアリングされます。テーブル自体へのクライアントからの直接アクセスはRLSで
  すべて拒否しており、このRPC経由でのみ安全に読み書きされます。

### セットアップ手順

ランキング機能を既にセットアップ済みの場合、追加で必要な作業は以下だけです。

1. Supabaseダッシュボードの **SQL Editor** で、更新後の `supabase/schema.sql` を
   もう一度上から下まで貼り付けて実行する
   (`matchmaking_queue` テーブルと `find_or_create_match` / `leave_matchmaking` 関数が追加されます。
   `scores` テーブル関連の部分は既存のものを上書きするだけなので、実行しても壊れません)
2. Supabaseプロジェクトの **Realtime** 機能は特別な設定なしにデフォルトで有効なので、
   追加の管理画面操作は不要です

### 現時点での制約(今後の改善候補)

- 盤面の同期は0.12秒ごとのスナップショット送信によるものなので、非常に遅い回線では
  相手側の盤面表示が数コマ遅れて見えることがあります(自分側の操作感には影響しません)
- オンライン対戦の結果はランキングにはまだ登録されません(AI対戦・ソロプレイのみ対応)
- 対戦中の「もう一度」(即リマッチ)機能はまだなく、一度ロビーに戻ってから
  再度対戦相手を探す形になります
