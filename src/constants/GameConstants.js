/**
 * GameConstants.js
 * ------------------------------------------------------------
 * ゲーム全体で使用する設定値・マジックナンバーを一元管理するファイル。
 * 開発ルール5「マジックナンバーを避け、設定値は定数ファイルで一元管理すること」
 * に基づき、他ファイルからは必ずこのファイル経由で値を参照すること。
 * ------------------------------------------------------------
 */

// --- 画面・グリッド設定 -----------------------------------------
export const TILE_SIZE = 48; // 1マスのピクセルサイズ
export const GRID_COLS = 15; // マップの横マス数（奇数推奨：迷路生成の都合上）
export const GRID_ROWS = 11; // マップの縦マス数（奇数推奨）
export const SCREEN_WIDTH = TILE_SIZE * GRID_COLS;
export const SCREEN_HEIGHT = TILE_SIZE * GRID_ROWS + 64; // 下部UI分の余白
// ↑SCREEN_WIDTH/SCREEN_HEIGHTは、GameScene以外のメニュー系シーン
// (Title/Lobby/OnlineLobby/Ranking/Result/Pause)の元々の固定レイアウト
// 計算にのみ使う想定の値（これらのシーンは実行時にthis.scale.width/height
// で中央揃えし直すため、実際にはブラウザの実サイズに追従する）。
// GameScene(対戦画面)はScale.RESIZEでブラウザの実サイズいっぱいに表示する
// ため、この固定値をそのままステージ枠のサイズとしては使わない
// (下記「対戦画面レイアウト」参照)。

// --- 対戦画面レイアウト(GameScene) ---------------------------------------
// 「画面の上下はブラウザの大きさに合わせて、右側の空いている部分に
// 各プレイヤーの情報を表示してほしい」という要望に対応するため、
// GameSceneはPhaser.Scale.RESIZEモードでブラウザの実サイズいっぱいに
// 表示する(main.js参照)。画面右側にHUD_PANEL_WIDTH分の固定幅を確保して
// 各プレイヤーの情報パネルを表示し、残りの(左側)領域を3Dバトルステージ
// (#cube-canvas)の表示領域にする。STAGE_VIEWPORT_MIN_WIDTHは、非常に
// 狭いウィンドウでもステージが極端に潰れないようにする下限。
export const HUD_PANEL_WIDTH = 260;
export const STAGE_VIEWPORT_MIN_WIDTH = 480;
// 「スマホでもプレイできるように」への対応: スマホ(特に縦持ち、幅400px
// 前後)ではSTAGE_VIEWPORT_MIN_WIDTHを優先する従来の計算式のままだと
// 右側パネルの幅が0になり、プレイヤー情報が一切表示されなくなって
// しまう。MIN_HUD_PANEL_WIDTHは、画面がどれだけ狭くても右側パネルに
// 必ず確保する最低幅(ViewportLayout.computeBattleLayout参照)。この幅を
// 下回る場合はコンパクト表示(アイコン+簡易ステータスのみ)に切り替える
// 閾値としてCOMPACT_HUD_PANEL_THRESHOLDも合わせて定義する。
export const MIN_HUD_PANEL_WIDTH = 96;
export const COMPACT_HUD_PANEL_THRESHOLD = 150;

// --- パフォーマンス目標 -----------------------------------------
export const TARGET_FPS = 60;
export const MAX_LOAD_TIME_MS = 5000;

// --- プレイヤー設定 ---------------------------------------------
export const PLAYER_MOVE_DURATION_MS = 150; // 1マス移動にかかる時間
export const PLAYER_DEFAULT_LIVES = 3;
export const PLAYER_INVINCIBLE_DURATION_MS = 5000; // 🛡アイテムの無敵時間
export const PLAYER_SPEED_BOOST_MULTIPLIER = 1.6; // 👟アイテムの速度倍率
export const PLAYER_COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'white'];
export const MAX_PLAYERS = 6;

// 敵キャラ(AI・2人目以降の人間プレイヤー)の見た目を「同じキャラクター
// (同梱のkumacchi.vrm、地の色は赤)」の色違いにするためのCanvas2D
// filterプロパティ用CSS文字列。PLAYER_COLORSの各色に対応する
// (赤=自分のカスタム/デフォルト見た目そのまま、他の色は色相回転・
// 彩度/明度調整で作る)。実際の見え方はブラウザでの確認が必要。
export const PLAYER_COLOR_FILTERS = Object.freeze({
  red: 'none',
  blue: 'hue-rotate(220deg) saturate(1.1)',
  yellow: 'hue-rotate(50deg) saturate(1.2) brightness(1.05)',
  green: 'hue-rotate(120deg)',
  black: 'saturate(0.3) brightness(0.3)',
  white: 'saturate(0.2) brightness(1.9)',
});

// PLAYER_COLORSの各色名 -> 16進カラーコード。CubeRenderer(Three.js、
// プレースホルダーの色付き四角)とGameScene(HUDの右側プレイヤー情報パネル)
// の両方から参照する共通値(データ駆動: 開発ルール6。同じ色を2箇所で
// 個別に定義してズレるのを防ぐ)。
export const PLAYER_COLOR_HEX = Object.freeze({
  red: 0xe74c3c,
  blue: 0x3498db,
  yellow: 0xf1c40f,
  green: 0x2ecc71,
  black: 0x2c3e50,
  white: 0xecf0f1,
});

// --- ローカル対戦(PVP)設定 ------------------------------------------
// 同一キーボードでのホットシート対戦を想定し、最大4人までの人間プレイヤーに
// 別々のキー割り当てを用意する（5人目以降は物理的なキー競合を避けるのが
// 難しいため、現状はAI専用とする）。各配列の並びは
// [up, down, left, right, bomb] のPhaser.Input.Keyboard.KeyCodes名。
export const MAX_HUMAN_PLAYERS = 4;
export const HUMAN_KEY_MAPS = Object.freeze([
  Object.freeze({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', bomb: 'SPACE' }), // プレイヤー1: 矢印キー+Space
  Object.freeze({ up: 'W', down: 'S', left: 'A', right: 'D', bomb: 'F' }), // プレイヤー2: WASD+F
  Object.freeze({ up: 'I', down: 'K', left: 'J', right: 'L', bomb: 'U' }), // プレイヤー3: IJKL+U
  Object.freeze({ up: 'NUMPAD_EIGHT', down: 'NUMPAD_TWO', left: 'NUMPAD_FOUR', right: 'NUMPAD_SIX', bomb: 'NUMPAD_ZERO' }), // プレイヤー4: テンキー
]);

// --- 爆弾設定 -----------------------------------------------------
export const BOMB_INITIAL_COUNT = 1;
export const BOMB_MAX_COUNT = 10;
export const BOMB_FUSE_MS = 3000; // 設置から爆発までの時間（約3秒）
export const BLAST_INITIAL_RANGE = 1; // 初期爆風範囲（マス数）
export const BLAST_MAX_RANGE = 10; // 最大爆風範囲
export const EXPLOSION_LIFETIME_MS = 400; // 爆風エフェクトの表示時間

// --- サドンデス設定 ---------------------------------------------------
// 「制限時間を過ぎたら終わりではなく、制限時間が過ぎて0になったら残り
// 一人になるまで爆弾が沢山降ってくるようにしてほしい」への対応。
// BattleSystem.suddenDeathがtrueになった(制限時間到達)後、GameScene側が
// 一定間隔で、生存者がいる面それぞれにランダムな位置から「環境爆弾」
// (誰の所有物でもない爆弾)を降らせ続ける(GameScene._spawnSuddenDeathBombs
// 参照)。
export const SUDDEN_DEATH_BOMB_INTERVAL_MS = 1200; // 爆弾を降らせる間隔
export const SUDDEN_DEATH_BOMBS_PER_WAVE = 2; // 1回に、生存者がいる面ごとに降らせる爆弾の数
export const SUDDEN_DEATH_BLAST_RANGE = 3; // 環境爆弾の爆風範囲(通常の初期爆風より広めにして決着を早める)

// --- ブロック設定 ---------------------------------------------------
export const BLOCK_TYPES = Object.freeze({
  EMPTY: 'empty',
  HARD: 'hard', // 壊せないブロック
  SOFT: 'soft', // 壊せるブロック
  ITEM: 'item', // アイテム入りブロック（破壊後にアイテム出現）
});

export const ITEM_BLOCK_RATE = 0.35; // 壊せるブロックのうちアイテムを内包する割合
export const SAFE_ZONE_RADIUS = 1; // 各プレイヤー開始地点周辺の安全地帯半径（マス）

// --- アイテム設定 ---------------------------------------------------
export const ITEM_TYPES = Object.freeze({
  BOMB_UP: 'bomb_up', // 💣 爆弾数+1
  FIRE_UP: 'fire_up', // 🔥 爆風+1
  SPEED_UP: 'speed_up', // 👟 移動速度アップ
  SHIELD: 'shield', // 🛡 5秒無敵
  LIFE_UP: 'life_up', // ❤️ 残機+1
  GHOST: 'ghost', // 👻 壊せるブロックを通過可能
  KICK: 'kick', // 💥 爆弾キック(蹴って移動させられる)
});

// 各アイテムの出現しやすさの重み(データ駆動: 開発ルール6)。Stage.js側で
// この重みに従って「アイテム候補プール」を組み立てる(重み2のタイプが
// 重み1のタイプの2倍出現しやすい、という単純な多重化方式)。
// 「壁抜け(GHOST)は強力なので出現量を半分にしてほしい」という要望に対応し、
// GHOSTのみ他の半分の重みにしてある。
export const ITEM_SPAWN_WEIGHTS = Object.freeze({
  [ITEM_TYPES.BOMB_UP]: 2,
  [ITEM_TYPES.FIRE_UP]: 2,
  [ITEM_TYPES.SPEED_UP]: 2,
  [ITEM_TYPES.SHIELD]: 2,
  [ITEM_TYPES.LIFE_UP]: 2,
  [ITEM_TYPES.GHOST]: 1,
  [ITEM_TYPES.KICK]: 2,
});

// 💥(KICK)アイテムを持つプレイヤーが爆弾へ向かって移動した際、爆弾を
// 何マス先まで滑らせるかの1マスあたりのアニメーション時間。
export const BOMB_KICK_SLIDE_DURATION_MS = 90;

// --- 必殺技設定 ------------------------------------------------------
export const SKILL_GAUGE_MAX = 100;
export const SKILL_GAUGE_PER_BLOCK_BREAK = 4;
export const SKILL_GAUGE_PER_KILL = 25;
export const RAGE_MODE_DURATION_MS = 8000; // 「爆裂モード」継続時間

// --- AI設定 ----------------------------------------------------------
export const AI_DIFFICULTY = Object.freeze({
  EASY: 'easy',
  NORMAL: 'normal',
  HARD: 'hard',
  EXPERT: 'expert',
});
export const MAX_AI_PLAYERS = 5;

// --- 勝敗判定・リザルト設定 -------------------------------------------------
export const EXP_PER_KILL = 100; // 撃破1件あたりの獲得経験値
export const EXP_PER_BOMB_EXPLODED = 10; // 爆破1件あたりの獲得経験値
export const EXP_PER_ITEM_COLLECTED = 20; // アイテム取得1件あたりの獲得経験値
export const EXP_WIN_BONUS = 300; // 勝利ボーナス

// --- 試合開始前カウントダウン設定 ------------------------------------------
export const COUNTDOWN_STEPS = ['3', '2', '1', 'START'];
export const COUNTDOWN_STEP_MS = 800;

// --- 入力キー設定 ------------------------------------------------------
export const KEYS = Object.freeze({
  UP: 'UP',
  DOWN: 'DOWN',
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  BOMB: 'SPACE',
  PAUSE: 'ESC',
});

// --- シーンキー ---------------------------------------------------------
export const SCENE_KEYS = Object.freeze({
  TITLE: 'TitleScene',
  LOBBY: 'LobbyScene',
  ONLINE_LOBBY: 'OnlineLobbyScene',
  RANKING: 'RankingScene',
  GAME: 'GameScene',
  RESULT: 'ResultScene',
  PAUSE: 'PauseScene',
});

// --- 描画レイヤー深度（z-index相当） -------------------------------------
export const DEPTH = Object.freeze({
  FLOOR: 0,
  ITEM: 5,
  BLOCK: 10,
  BOMB: 15,
  EXPLOSION: 20,
  PLAYER: 25,
  UI: 100,
});

// --- オンライン対戦(Supabase Realtime)設定 -------------------------------
// ローカルPVP(同一キーボードでのホットシート、HUMAN_KEY_MAPS)とは別に、
// 別々の端末・ブラウザからSupabase Realtimeのbroadcast/presence経由で
// 対戦できるオンラインPVPに対応する(NetworkSystem.js/NetworkProtocol.js)。
// アーキテクチャ: ホスト(部屋を作った側)の端末だけがゲームロジック全体
// (マップ生成・AI・爆弾・アイテム・勝敗判定)を実行する「ホスト権威型」。
// ゲスト(部屋に参加した側)はホストから届く状態(state)・イベント
// (explosion/item_pickup等)を描画するだけで、自分のキー入力はホストへ
// 送信するのみ(ローカルでは移動処理を行わない)。これにより盤面のズレ
// (デシンク)が原理的に起こらない設計にしている。
export const NETWORK_STATE_BROADCAST_INTERVAL_MS = 100; // ホスト→全員: 状態同期の送信間隔(約10Hz)
export const NETWORK_INPUT_SEND_INTERVAL_MS = 50; // ゲスト→ホスト: 入力送信間隔(約20Hz)
export const NETWORK_INIT_REQUEST_RETRY_MS = 1500; // ゲスト: match_init未受信時の再送要求間隔
export const ROOM_CODE_LENGTH = 5;
// 誤読しやすい0/O・1/Iを除いた文字だけで部屋コードを生成する。
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
// オンライン対戦は同一キーボードでのキー競合が無い(各プレイヤーが自分の
// 端末で操作する)ため、ローカルPVPのMAX_HUMAN_PLAYERS(4、物理キー制約)
// より緩く、面の数と同じ最大6人まで対応する。
export const MAX_ONLINE_PLAYERS = MAX_PLAYERS;
// マップ生成結果(ブロック種別)をネットワーク越しに送る際の1文字エンコード。
// 文字列化してデータ量を抑える(1マス1文字、1面11x11=121文字)。
export const BLOCK_TYPE_CHAR = Object.freeze({
  [BLOCK_TYPES.EMPTY]: '.',
  [BLOCK_TYPES.HARD]: '#',
  [BLOCK_TYPES.SOFT]: '+',
  [BLOCK_TYPES.ITEM]: '$',
});
export const CHAR_BLOCK_TYPE = Object.freeze(
  Object.fromEntries(Object.entries(BLOCK_TYPE_CHAR).map(([type, char]) => [char, type]))
);

// --- サイコロ6面ステージ設定 ---------------------------------------------
// バトルエリアを1枚の平面マップではなく、立方体(サイコロ)の6つの面を
// それぞれ独立した平面マップとして持ち、面の端まで移動すると隣接する面へ
// 乗り移れるようにする（詳細はCubeStage.js/CubeTopology.js参照）。
export const CUBE_FACE_NAMES = Object.freeze(['FRONT', 'BACK', 'RIGHT', 'LEFT', 'TOP', 'BOTTOM']);
export const CUBE_FACE_COLS = 11; // 1面あたりの横マス数（奇数推奨：迷路生成の都合上）
export const CUBE_FACE_ROWS = 11; // 1面あたりの縦マス数（奇数推奨）

// 面をまたいで移動した際、サイコロが転がったように見えるアニメーションの所要時間。
// CubeRenderer.jsのrotateToFace()が使う(詳細は同ファイルの解説コメント参照)。
export const CUBE_ROLL_DURATION_MS = 550;

// --- オートマッチング設定 -------------------------------------------------
// オンライン対戦の「部屋コードで作成/参加」とは別に、部屋コードのやり取り
// なしで自動的に他プレイヤーと組み合わせる「オートマッチング」用の設定。
// 実装(OnlineLobbyScene.js)は、固定の合言葉チャンネル(待合ロビー)に
// presenceで参加し、参加者が集まる(または一定時間待つ)と、参加順が一番
// 早いクライアントが実際の対戦部屋を作成して合図を送る、という
// クライアント主導の簡易マッチングになっている(専用サーバーを持たない
// 構成のため。ごく稀に複数クライアントがほぼ同時にマッチを成立させる
// 競合が発生し得る点はREADME.mdに既知の制限として明記している)。
export const AUTO_MATCH_LOBBY_CODE = 'AUTOMATCH-LOBBY-V1'; // 5文字のランダム部屋コードとは衝突しない固定チャンネル名
export const AUTO_MATCH_WAIT_MS = 8000; // 自分が待合ロビーに参加してから、他の参加者を待つ最大時間
export const AUTO_MATCH_LEADER_CONFIRM_DELAY_MS = 400; // マッチ確定前の再確認待ち時間(複数クライアントの同時確定を減らす)
// 「希望人数」(足りない分をAIで補充する基準の合計人数)は、2026-07更新で
// 固定値ではなくオートマッチングのリーダーが_showAutoMatchSettingsで選べる
// ようにしたため、旧AUTO_MATCH_MIN_PLAYERS/AUTO_MATCH_SOLO_AI_COUNTは廃止した
// (OnlineLobbyScene._becomeAutoMatchLeaderのthis.autoMatchSettings.
// participantCountを参照)。
