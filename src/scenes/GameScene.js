/**
 * GameScene.js
 * ------------------------------------------------------------
 * 対戦本編を進行させるメインシーン。
 *
 * Phase1で構築した基盤（マップ生成・移動・爆弾・爆発・当たり判定）に加え、
 * Phase2で以下を実装している:
 *   ・アイテム出現・取得・効果適用（ItemSystem連携）
 *   ・AI行動（AISystem経由でAI.jsの思考ルーチンを実行、危険地帯の共有）
 *   ・詳細な勝敗判定・順位確定・撃破数等のスコア集計（BattleSystem連携）
 *   ・UI強化（順位・カウントダウン）
 *   ・BGM・効果音（SoundSystem連携）
 *
 * Phase3では以下を実装している:
 *   ・人間プレイヤーの見た目をVRMモデルの4方向(正面/背面/左/右)静止画
 *     スナップショットに差し替える機能（VRMSystem連携）
 *   ・バトルエリアをサイコロ状(立方体)の6面ステージにする機能。
 *     ゲームロジック(CubeStage/Player/Bomb/Item/Explosion/AI/BattleSystem)は
 *     従来通りPhaserに依存しない純粋なロジックとして動作させ、実際の3D描画は
 *     CubeRenderer.js(Three.js)が別canvas(#cube-canvas)に対して行う。
 *     Phaser側はHUD/入力/カウントダウン/シーン遷移のみを担当する
 *     （開発ルール9: 描画とロジックの分離を、2D/3D描画の切り替えにも応用）。
 *
 * 必殺技の発動は未対応。
 * ------------------------------------------------------------
 */
import {
  SCENE_KEYS,
  DEPTH,
  COUNTDOWN_STEPS,
  COUNTDOWN_STEP_MS,
  PLAYER_COLORS,
  PLAYER_COLOR_FILTERS,
  PLAYER_COLOR_HEX,
  HUMAN_KEY_MAPS,
  MAX_HUMAN_PLAYERS,
  MAX_ONLINE_PLAYERS,
  NETWORK_STATE_BROADCAST_INTERVAL_MS,
  NETWORK_INPUT_SEND_INTERVAL_MS,
  NETWORK_INIT_REQUEST_RETRY_MS,
  SUDDEN_DEATH_BOMB_INTERVAL_MS,
  SUDDEN_DEATH_BOMBS_PER_WAVE,
  SUDDEN_DEATH_BLAST_RANGE,
} from '../constants/GameConstants.js';
import { computeBattleLayout } from '../utils/ViewportLayout.js';
import { computeTouchControlLayout, isTouchCapable } from '../utils/TouchControlLayout.js';
import { random } from '../utils/Random.js';
import { CubeStage } from '../objects/CubeStage.js';
import { Player } from '../objects/Player.js';
import { Bomb } from '../objects/Bomb.js';
import { Explosion } from '../objects/Explosion.js';
import { Item } from '../objects/Item.js';
import { AISystem } from '../systems/AISystem.js';
import { ItemSystem } from '../systems/ItemSystem.js';
import { BattleSystem } from '../systems/BattleSystem.js';
import { soundSystem } from '../systems/SoundSystem.js';
import { vrmSystem } from '../systems/VRMSystem.js';
import { CubeRenderer } from '../systems/CubeRenderer.js';
import {
  createMirrorStage,
  buildMatchInitMessage,
  buildStateMessage,
  buildExplosionEvent,
  buildItemPickupEvent,
  buildResultEvent,
  buildMoveInputMessage,
  buildBombInputMessage,
  pickDirectionFromKeys,
  applyPlayerState,
  diffById,
} from '../systems/NetworkProtocol.js';

const DEFAULT_VRM_PATH = 'assets/vrm/kumacchi.vrm';

// 💥(KICK)アイテムによる爆弾の蹴り移動・アイテムの死亡ドロップ探索で使う
// 4方向ベクトル(CubeStage内部のDIRECTION_VECTORSと同じ値だが非公開のため
// ここに複製する)。
const DIRECTION_VECTORS = Object.freeze({
  up: { dCol: 0, dRow: -1 },
  down: { dCol: 0, dRow: 1 },
  left: { dCol: -1, dRow: 0 },
  right: { dCol: 1, dRow: 0 },
});

export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.GAME });
  }

  /**
   * @param {object} data - { mode: 'pvp'|'ai'|'online', playerCount, aiCount, humanCount, timeLimitMs, aiDifficulty, online }
   *   timeLimitMsにInfinityを渡すと「制限時間なし」になる(BattleSystemの
   *   時間切れ判定が自然に発生しなくなる)。
   *   humanCountは同時に操作する人間プレイヤーの人数(ローカルPVP/オンライン
   *   対戦対応。1なら従来通りソロ+AI)。playerCountはhumanCount以上である
   *   必要がある(LobbyScene/OnlineLobbyScene側で保証する)。
   *
   *   mode:'online'の場合、data.onlineに以下を渡す(OnlineLobbyScene参照):
   *   { network: NetworkSystem, role: 'host'|'guest', roomCode,
   *     clientToPlayerId: {clientId: playerId} (hostのみ、送信用) }
   *   オンライン対戦はホスト権威型: ホストの端末だけがゲームロジック全体
   *   (マップ生成・AI・爆弾・勝敗判定)を実行し、ゲストはホストから届く
   *   状態を描画するだけになる(NetworkProtocol.js参照)。
   */
  init(data) {
    const playerCount = data?.playerCount ?? 1;
    const isOnline = data?.mode === 'online';
    const maxHuman = isOnline ? MAX_ONLINE_PLAYERS : MAX_HUMAN_PLAYERS;
    this.config = {
      mode: data?.mode ?? 'ai',
      playerCount,
      aiCount: data?.aiCount ?? 2,
      humanCount: Math.max(1, Math.min(maxHuman, data?.humanCount ?? 1, playerCount)),
      timeLimitMs: data?.timeLimitMs ?? 180000,
      aiDifficulty: data?.aiDifficulty ?? 'normal',
      online: data?.online ?? null,
    };
  }

  /**
   * 「爆弾.pngを爆弾にしてほしい」への対応。実際にプレイヤーの目に触れる
   * のは3D(CubeRenderer/Three.js)側の描画だが、render3D=falseの場合の
   * Phaser用フォールバック(Bomb._createSprite)でも同じ画像を使えるよう、
   * ここでテクスチャキー'bombIcon'として読み込んでおく。
   */
  preload() {
    this.load.image('bombIcon', 'assets/images/bomb/bomb.png');
  }

  create() {
    // このシーンでは実際の見た目(ブロック/プレイヤー/爆弾/アイテム)を
    // CubeRenderer(Three.js)が描画するため、Bomb/Item側で独自にPhaser用の
    // スプライトを作らせないようにするフラグ。
    this.render3D = true;
    this._sceneActive = true;
    this.resultTriggered = false;

    // オンライン対戦のゲスト(参加した側)は、ホストから届くマップ・状態を
    // 受信して描画するだけの別フロー(_createGuestScene)になる。
    // ホスト・ローカル対戦(AI戦/同一キーボードPVP)は従来通り本フローを使う。
    if (this.config.mode === 'online' && this.config.online?.role === 'guest') {
      this._createGuestScene();
      return;
    }

    this.stage = new CubeStage();
    const totalParticipants = Math.min(6, this.config.playerCount + this.config.aiCount);
    this.stage.generate(totalParticipants, this.config.humanCount);

    this.bombs = [];
    this.items = [];

    this._createPlayers(totalParticipants);

    // battleSystemは_buildPlayerCards()(内部で_updateHud()を呼び、各
    // プレイヤーカードの残り時間表示のためにthis.battleSystem.timeLimitMs
    // を参照する)より前に用意しておく必要がある。以前はこの順序が逆で、
    // battleSystem未生成のままthis.battleSystem.timeLimitMsを読もうとして
    // 対戦開始のたびに必ず例外が発生し、画面が固まる(フリーズする)不具合に
    // なっていた。
    this.aiSystem = new AISystem();
    this.aiSystem.setup(
      this.players.filter((p) => p.isAI),
      this.config.aiDifficulty
    );
    this.battleSystem = new BattleSystem(this.players, {
      timeLimitMs: this.config.timeLimitMs,
      humanPlayers: this.humanPlayers,
    });
    // サドンデス(制限時間切れ後の爆弾降らせ)用の次回投下時刻管理。
    this._nextSuddenDeathDropAt = 0;

    this._createHud();
    this._buildPlayerCards();
    this._createInput();
    this._createTouchControls();

    this.events.once('shutdown', () => {
      this._sceneActive = false;
      this.cubeRenderer?.dispose();
      this._offHostNetworkMessage?.();
      if (this._onHudResizeHandler) this.scale.off('resize', this._onHudResizeHandler);
      if (this._onCubeResizeHandler) this.scale.off('resize', this._onCubeResizeHandler);
    });

    if (this.config.mode === 'online') {
      this._setupOnlineHost();
    }

    // 3D描画(Three.js)の初期化は非同期(CDN読込あり)。ゲームロジック側
    // (移動・爆弾・カウントダウン等)はこれを待たずに進行できるようにする。
    this._cubeRendererReadyPromise = this._initCubeRenderer();

    this._startCountdown();
    this._loadAllVrmAppearances();
  }

  // ==========================================================================
  // オンライン対戦(Supabase Realtime): ホスト側
  // ==========================================================================

  /**
   * ホストとして、マップ生成が終わった直後にmatch_init(マップ・出走
   * プレイヤー一覧)を全員へ送信し、以後の入力(input)メッセージを
   * 受け取れるようにする。
   */
  _setupOnlineHost() {
    const network = this.config.online.network;
    this._networkSeq = 0;
    this._networkMoveStates = new Map(); // playerId -> {up,down,left,right} (ネットワーク越しの人間プレイヤーの現在の入力状態)
    this._offHostNetworkMessage = network.onMessage((msg) => this._onHostNetworkMessage(msg));
    this._sendMatchInit();
  }

  _sendMatchInit() {
    const network = this.config.online?.network;
    if (!network) return;
    const matchConfig = {
      aiDifficulty: this.config.aiDifficulty,
      timeLimitMs: this.config.timeLimitMs,
      humanCount: this.config.humanCount,
      aiCount: this.config.aiCount,
      clientToPlayerId: this.config.online.clientToPlayerId ?? {},
    };
    network.send(buildMatchInitMessage(this.stage, this.players, matchConfig));
  }

  /** ゲストからのメッセージ(再送要求・入力)を処理する(ホストのみ) */
  _onHostNetworkMessage(msg) {
    if (!msg) return;
    if (msg.type === 'request_init') {
      this._sendMatchInit();
      return;
    }
    if (msg.type !== 'input') return;

    const clientToPlayerId = this.config.online.clientToPlayerId ?? {};
    const playerId = clientToPlayerId[msg.senderClientId];
    if (!playerId) return; // 未参加・不明なクライアントからの入力は無視する

    if (msg.mode === 'move') {
      this._networkMoveStates.set(playerId, { up: msg.up, down: msg.down, left: msg.left, right: msg.right });
    } else if (msg.mode === 'bomb') {
      const player = this.players.find((p) => p.playerId === playerId);
      if (player) this._tryPlaceBomb(player);
    }
  }

  /** 状態(state)ブロードキャストを一定間隔(NETWORK_STATE_BROADCAST_INTERVAL_MS)で送る(ホストのみ) */
  _broadcastStateIfDue(time) {
    const network = this.config.online?.network;
    if (!network) return;
    if (time - (this._lastStateBroadcastAt ?? 0) < NETWORK_STATE_BROADCAST_INTERVAL_MS) return;
    this._lastStateBroadcastAt = time;
    this._networkSeq += 1;
    network.send(
      buildStateMessage(
        this._networkSeq,
        this.battleSystem.elapsedMs,
        this.players,
        this.bombs,
        this.items,
        this.battleSystem.isOver,
        this.battleSystem.winner?.playerId ?? null
      )
    );
  }

  // ==========================================================================
  // オンライン対戦(Supabase Realtime): ゲスト側
  // ==========================================================================

  /**
   * ゲスト(部屋に参加した側)のシーン初期化。ホストからmatch_initが届く
   * までは「受信中...」を表示するだけで、マップ生成やAI・爆弾等のロジックは
   * 一切実行しない(ホスト権威型: ゲストは描画専用)。
   */
  _createGuestScene() {
    this.bombs = [];
    this.items = [];
    this.players = [];
    this._bombMirrorsById = new Map();
    this._itemMirrorsById = new Map();
    this._matchInitReceived = false;
    this.myPlayerId = null;

    this._createHud();
    this._createGuestInput();
    this._createTouchControls();

    this._guestStatusText = this.add
      .text(this._layout.stageWidth / 2, this._layout.totalHeight / 2, 'ホストの対戦情報を受信中...', {
        fontSize: '18px',
        color: '#ffffff',
        backgroundColor: '#000000aa',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.UI);

    const network = this.config.online.network;
    this._offGuestNetworkMessage = network.onMessage((msg) => this._onGuestNetworkMessage(msg));
    network.send({ type: 'request_init' });
    this._guestInitRetryTimer = this.time.addEvent({
      delay: NETWORK_INIT_REQUEST_RETRY_MS,
      loop: true,
      callback: () => {
        if (!this._matchInitReceived) network.send({ type: 'request_init' });
      },
    });

    this.events.once('shutdown', () => {
      this._sceneActive = false;
      this.cubeRenderer?.dispose();
      this._offGuestNetworkMessage?.();
      this._guestInitRetryTimer?.remove();
      if (this._onHudResizeHandler) this.scale.off('resize', this._onHudResizeHandler);
      if (this._onCubeResizeHandler) this.scale.off('resize', this._onCubeResizeHandler);
    });
  }

  /** ゲスト用の入力: 自分の端末の矢印キー+Spaceで操作し、結果はホストへ送信するのみ(ローカルでは移動しない) */
  _createGuestInput() {
    const KeyCodes = Phaser.Input.Keyboard.KeyCodes;
    this.escKey = this.input.keyboard.addKey(KeyCodes.ESC);
    this.escKey.on('down', () => {
      if (this.countdownActive) return;
      this._pauseGame();
    });

    const map = HUMAN_KEY_MAPS[0];
    this._guestKeys = {
      up: this.input.keyboard.addKey(KeyCodes[map.up]),
      down: this.input.keyboard.addKey(KeyCodes[map.down]),
      left: this.input.keyboard.addKey(KeyCodes[map.left]),
      right: this.input.keyboard.addKey(KeyCodes[map.right]),
      bomb: this.input.keyboard.addKey(KeyCodes[map.bomb]),
    };
    this._guestKeys.bomb.on('down', () => {
      if (this.countdownActive || !this.myPlayerId) return;
      this.config.online.network.send(buildBombInputMessage(this.myPlayerId));
    });
  }

  _sendGuestMoveInputIfDue(time) {
    if (!this.myPlayerId) return;
    if (time - (this._lastMoveSendAt ?? 0) < NETWORK_INPUT_SEND_INTERVAL_MS) return;
    this._lastMoveSendAt = time;
    const keys = this._guestKeys;
    // 「スマホでもプレイできるように」への対応: タッチ操作(仮想十字キー、
    // this._touchMoveState)が押されている場合も、キーボードと同じ移動
    // 入力として扱う(OR条件)。タッチ非対応デバイスではthis._touchMoveState
    // は常にすべてfalseなので、キーボードのみの従来動作と変わらない。
    const touch = this._touchMoveState;
    this.config.online.network.send(
      buildMoveInputMessage(this.myPlayerId, {
        up: keys.up.isDown || !!touch?.up,
        down: keys.down.isDown || !!touch?.down,
        left: keys.left.isDown || !!touch?.left,
        right: keys.right.isDown || !!touch?.right,
      })
    );
  }

  _onGuestNetworkMessage(msg) {
    if (!msg) return;
    if (msg.type === 'match_init') this._applyMatchInit(msg);
    else if (msg.type === 'state') this._applyStateMessage(msg);
    else if (msg.type === 'event') this._applyNetworkEvent(msg);
  }

  /** ホストから届いたマップ・出走プレイヤー一覧から、ゲスト側の描画用シーンを組み立てる(初回のみ) */
  _applyMatchInit(msg) {
    if (this._matchInitReceived) return; // 再送されても2重に組み立てない
    this._matchInitReceived = true;
    this._guestInitRetryTimer?.remove();
    this._guestStatusText?.destroy();

    this.stage = createMirrorStage(msg.stage);
    this.config.aiDifficulty = msg.config?.aiDifficulty ?? this.config.aiDifficulty;
    this.config.timeLimitMs = msg.config?.timeLimitMs ?? this.config.timeLimitMs;
    this.myPlayerId = msg.config?.clientToPlayerId?.[this.config.online.network.clientId] ?? null;

    this.players = (msg.roster ?? []).map(
      (r) =>
        new Player(this, this.stage, r.face, r.col, r.row, {
          colorIndex: r.colorIndex,
          isAI: r.isAI,
          playerId: r.playerId,
        })
    );
    this.humanPlayer = this.players.find((p) => p.playerId === this.myPlayerId) ?? this.players[0] ?? null;
    this.humanPlayers = this.humanPlayer ? [this.humanPlayer] : [];

    // BattleSystem本体は持たず、HUD/勝敗表示に必要な最小限のフィールドだけを
    // 持つミラーを用意する(実際の勝敗判定はホストが行い、stateメッセージで
    // 結果を受け取るだけ)。getLiveRankはv1では簡略化しnullを返す(最終結果は
    // 試合終了時のresultイベントで正しく表示される)。
    // 【重要】_buildPlayerCards()より前に用意すること。_buildPlayerCards()は
    // 内部で_updateHud()を呼び、各プレイヤーカードの残り時間表示のために
    // this.battleSystem.timeLimitMsを参照するため、順序が逆だと対戦開始の
    // たびに必ず例外が発生し画面が固まる(フリーズする)不具合になる
    // (host/ローカル側のcreate()でも同じ理由で順序を修正済み)。
    this.battleSystem = {
      elapsedMs: 0,
      timeLimitMs: this.config.timeLimitMs,
      isOver: false,
      winner: null,
      getLiveRank: () => null,
    };
    this._buildPlayerCards();

    this._cubeRendererReadyPromise = this._initCubeRenderer();
    this._startCountdown();
    this._loadAllVrmAppearances();
  }

  _applyStateMessage(msg) {
    if (!this._matchInitReceived) return;
    if (msg.seq != null && this._lastStateSeq != null && msg.seq <= this._lastStateSeq) return; // 順序が入れ替わった古いパケットは無視
    this._lastStateSeq = msg.seq;

    const now = this.time.now;
    for (const state of msg.players ?? []) {
      const player = this.players.find((p) => p.playerId === state.id);
      if (player) applyPlayerState(player, state, now);
    }

    const prevBombs = Array.from(this._bombMirrorsById.values());
    const { added: addedBombs, removed: removedBombs } = diffById(prevBombs, msg.bombs ?? []);
    for (const b of removedBombs) {
      this.cubeRenderer?.removeBomb(this._bombMirrorsById.get(b.id));
      this._bombMirrorsById.delete(b.id);
    }
    for (const b of addedBombs) {
      const mirror = { id: b.id, face: b.face, col: b.col, row: b.row, detonated: false };
      this._bombMirrorsById.set(b.id, mirror);
      this.cubeRenderer?.addBomb(mirror);
    }
    // 💥(KICK)で蹴られた爆弾は同じidのまま位置(col/row)だけが変わるため、
    // diffById(追加/削除の検出のみ)には現れない。既存の爆弾ミラーの位置も
    // 毎回上書きしておくことで、ゲスト側でも蹴られた爆弾の移動が反映される
    // (見た目のスライド補間はしない簡易版。ホスト側のBomb.slideTo()による
    // なめらかな補間に比べると簡素だが、~100ms間隔の同期なので実用上問題ない)。
    for (const b of msg.bombs ?? []) {
      const mirror = this._bombMirrorsById.get(b.id);
      if (mirror) {
        mirror.face = b.face;
        mirror.col = b.col;
        mirror.row = b.row;
      }
    }
    this.bombs = Array.from(this._bombMirrorsById.values());

    const prevItems = Array.from(this._itemMirrorsById.values());
    const { added: addedItems, removed: removedItems } = diffById(prevItems, msg.items ?? []);
    for (const it of removedItems) {
      this.cubeRenderer?.removeItem(this._itemMirrorsById.get(it.id));
      this._itemMirrorsById.delete(it.id);
    }
    for (const it of addedItems) {
      const mirror = { id: it.id, face: it.face, col: it.col, row: it.row, type: it.type };
      this._itemMirrorsById.set(it.id, mirror);
      this.cubeRenderer?.addItem(mirror);
    }
    this.items = Array.from(this._itemMirrorsById.values());

    this.battleSystem.elapsedMs = msg.elapsedMs ?? this.battleSystem.elapsedMs;
    this.battleSystem.isOver = !!msg.isOver;
    if (msg.isOver && msg.winnerId != null && !this.battleSystem.winner) {
      this.battleSystem.winner = this.players.find((p) => p.playerId === msg.winnerId) ?? null;
    }
  }

  /** ホストからの単発イベント(explosion/item_pickup/result)を反映する */
  _applyNetworkEvent(msg) {
    if (msg.kind === 'explosion') {
      this.cubeRenderer?.showExplosion(msg.face, msg.tiles ?? [], this.time.now);
      soundSystem.playSE(msg.isChainReaction ? 'chain_explosion' : 'explosion');
      for (const b of msg.broken ?? []) this.cubeRenderer?.removeBlockAt(msg.face, b.col, b.row);
      for (const m of msg.mirrorBroken ?? []) this.cubeRenderer?.removeBlockAt(m.face, m.col, m.row);
    } else if (msg.kind === 'item_pickup') {
      soundSystem.playSE('item_get');
    } else if (msg.kind === 'result') {
      this._handleGuestResult(msg);
    }
  }

  _handleGuestResult(msg) {
    if (this.resultTriggered) return;
    this.resultTriggered = true;
    this.battleSystem.isOver = true;
    this.battleSystem.winner = this.players.find((p) => p.playerId === msg.winnerId) ?? null;
    const humanWon = this.humanPlayer && this.humanPlayer.playerId === msg.winnerId;
    soundSystem.playSE(humanWon ? 'victory' : 'defeat');
    soundSystem.stopBGM();

    this.time.delayedCall(1500, () => {
      const myIds = this.humanPlayer ? [this.humanPlayer.playerId] : [];
      this.scene.start(SCENE_KEYS.RESULT, {
        winner: this.battleSystem.winner,
        mode: this.config.mode,
        humanPlayerIds: myIds,
        // ゲストは自分の1人分だけをランキング送信対象にする(ホストも
        // 別途自分の1人分だけ送るため、これで参加者全員が重複なく1回ずつ
        // 送信される。update()内のrankingPlayerIdsのコメントも参照)。
        rankingPlayerIds: myIds,
        players: msg.players ?? [],
        finalRanks: msg.finalRanks ?? {},
      });
    });
  }

  /** ゲスト側のメインループ: 自分の入力を送りつつ、受信済みの状態を描画するだけ(ロジックは一切実行しない) */
  _updateGuest(time) {
    if (!this._matchInitReceived) return;
    this._sendGuestMoveInputIfDue(time);
    this._updateHud();
    if (this.cubeRenderer?.ready) {
      this.cubeRenderer.syncPlayers(this.players, time);
      if (this.humanPlayer) this.cubeRenderer.rotateToFace(this.humanPlayer.face, time);
      this.cubeRenderer.render(time);
    }
  }

  /**
   * サイコロ6面ステージの3D描画(Three.js)を初期化する。
   * #cube-canvas(index.html参照)にThree.jsのWebGLRendererを構築し、
   * 現在のCubeStageの内容から立方体シーンを組み立てる。
   * CDN読込を含むため失敗しうる。失敗してもゲームロジック自体は継続できる
   * （3Dの見た目が表示されないだけになる）よう、例外を握りつぶして
   * コンソールに記録するに留める。
   */
  async _initCubeRenderer() {
    const canvas = document.getElementById('cube-canvas');
    if (!canvas) {
      console.error('[GameScene] #cube-canvas が見つかりません。3D描画は行われません。');
      return;
    }
    this.cubeRenderer = new CubeRenderer(canvas);
    try {
      await this.cubeRenderer.init(this.stage);
      // シーン終了時に確実に解除できるよう、ハンドラをフィールドに保持しておく
      // (以前はscale.offで解除しておらず、対戦を何度もリプレイするとリスナーが
      // 蓄積する軽微なリークがあった。_sceneActiveガードで実害は無かったが、
      // 素直にoffで解除する)。
      this._onCubeResizeHandler = () => this.cubeRenderer?.resize();
      this.scale.on('resize', this._onCubeResizeHandler);
      // 起動直後の初期表示なので、アニメーションさせず即座にその面を正面に向ける
      // (rotateToFace()だと「何もしていないのに立方体が回る」ように見えてしまう)。
      if (this.humanPlayer) this.cubeRenderer.snapToFace(this.humanPlayer.face);
      console.log('[GameScene] サイコロ6面ステージの3D描画(Three.js)を初期化しました。');
    } catch (e) {
      console.error(
        '[GameScene] 3D描画(Three.js)の初期化に失敗しました。CDNへの到達やindex.htmlのimport map設定をご確認ください。',
        e
      );
    }
  }

  /**
   * 全プレイヤーの見た目をVRMモデルの4方向(正面/背面/左/右)スナップショットに
   * 差し替える。
   *
   * - プレイヤー1(自分/humanPlayers[0]): タイトル画面でカスタムVRMが
   *   アップロードされていればそれを、無ければ同梱のデフォルトVRM
   *   (assets/vrm/kumacchi.vrm)を使用する。
   * - それ以外の全員(AI、およびPVPの2人目以降の人間プレイヤー): 「敵キャラを
   *   全部このキャラにしてほしい」という要望に対応し、同梱のデフォルトVRM
   *   (地の色は赤)を各プレイヤーのPLAYER_COLORS配色(赤/青/黄/緑/黒/白)に
   *   合わせて色調補正(PLAYER_COLOR_FILTERS)した見た目にする。VRMを色ごとに
   *   再レンダリングするのはコストが高いため、デフォルトVRMは1回だけ
   *   レンダリングし、色調補正はCanvas2Dのfilterで軽量に行う
   *   (VRMSystem.tintSnapshotSet)。
   *
   * 読込・描画に失敗した場合は何もせず、デフォルトの色付き四角のままにする
   * （開発ルール8: VRM対応の有無がゲームロジックに影響しないこと）。
   *
   * 進行状況・失敗時のエラーは画面右上に小さく表示する（ブラウザの
   * 開発者コンソールを開かなくても状態がわかるようにするため）。
   */
  async _loadAllVrmAppearances() {
    const statusText = this.add
      .text(this._layout.stageWidth - 10, 10, 'VRM読み込み中...', {
        fontSize: '13px',
        color: '#88ddaa',
        backgroundColor: '#000000aa',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH.UI);
    this._vrmStatusText = statusText;

    const setStatus = (label, color) => {
      if (!this._sceneActive) return;
      statusText.setText(label);
      statusText.setColor(color);
    };

    const progressLabels = {
      'loading-modules': 'VRM: ライブラリ読込中...',
      parsing: 'VRM: 解析中...',
      rendering: 'VRM: 描画中...',
      'rendered-down': 'VRM: 正面を描画中...',
      'rendered-up': 'VRM: 背面を描画中...',
      'rendered-left': 'VRM: 左向きを描画中...',
      'rendered-right': 'VRM: 右向きを描画中...',
      done: 'VRM: 読み込み完了',
    };
    const onProgress = (stage) => setStatus(progressLabels[stage] ?? 'VRM読み込み中...', '#88ddaa');

    try {
      // 敵キャラ(AI・2人目以降の人間プレイヤー)の見た目のベースとして、
      // 同梱のデフォルトVRMは常に読み込む(自分がカスタムVRMを使っていても、
      // 敵キャラは常に「kumacchi」キャラの色違いにするため)。
      console.log(`[GameScene] 敵キャラ用にデフォルトVRM(${DEFAULT_VRM_PATH})を読み込みます。`);
      let enemyBaseSnapshotSet = null;
      const response = await fetch(DEFAULT_VRM_PATH);
      if (response.ok) {
        const defaultArrayBuffer = await response.arrayBuffer();
        enemyBaseSnapshotSet = await vrmSystem.renderSnapshotSet(defaultArrayBuffer, 128, onProgress);
      } else {
        console.error(
          `[GameScene] デフォルトVRMの読み込みに失敗しました (HTTP ${response.status})。敵キャラは色付き四角のままになります。`
        );
      }

      // プレイヤー1(自分): カスタムVRMがあればそれを使う。無ければ、上で
      // 読み込んだデフォルトVRMのスナップショットをそのまま使い回す
      // (同じファイルを2回レンダリングしない)。
      let primarySnapshotSet = enemyBaseSnapshotSet;
      if (vrmSystem.customArrayBuffer) {
        console.log(`[GameScene] アップロード済みVRM(${vrmSystem.customFileName})を使用します。`);
        primarySnapshotSet = await vrmSystem.renderSnapshotSet(vrmSystem.customArrayBuffer, 128, onProgress);
      }

      if (!this._sceneActive) return;

      // 3D描画側(CubeRenderer)の初期化が終わるまで待ってからテクスチャを渡す
      await this._cubeRendererReadyPromise;
      if (!this._sceneActive || !this.cubeRenderer?.ready) {
        setStatus('VRM: 3D描画が未初期化のため反映を保留しました', '#ffcc66');
        return;
      }

      // snapshotSet: { down: {idle,walkA,walkB}, up: {...}, left: {...}, right: {...} }
      // (VRMSystemの「手足を振るようにしてほしい」対応により、各方向が
      // ポーズ違いの複数canvasを持つ入れ子構造になった)。ここではその構造を
      // 保ったまま、canvas各枚をThree.jsテクスチャに変換するだけ。
      const buildTextureSet = (snapshotSet) => {
        const textureSet = {};
        for (const facing of Object.keys(snapshotSet)) {
          const poses = snapshotSet[facing];
          const poseTextures = {};
          for (const poseName of Object.keys(poses)) {
            poseTextures[poseName] = this.cubeRenderer.createCanvasTexture(poses[poseName]);
          }
          textureSet[facing] = poseTextures;
        }
        return textureSet;
      };

      if (primarySnapshotSet && this.humanPlayer?.isAlive) {
        this.cubeRenderer.setPlayerTextures(this.humanPlayer.playerId, buildTextureSet(primarySnapshotSet));
        // 「自分の画像アイコンも情報と一緒に表示してほしい」への対応:
        // 右側パネルの自分のカードにも同じスナップショット(正面・静止ポーズ)を使う。
        if (primarySnapshotSet.down?.idle) {
          this._setPlayerCardIcon(this.humanPlayer.playerId, primarySnapshotSet.down.idle);
        }
      }

      if (enemyBaseSnapshotSet) {
        for (const player of this.players) {
          if (player === this.humanPlayer || !player.isAlive) continue;
          const colorName = PLAYER_COLORS[player.colorIndex % PLAYER_COLORS.length];
          const filterCss = PLAYER_COLOR_FILTERS[colorName] ?? 'none';
          const tintedSet = vrmSystem.tintSnapshotSet(enemyBaseSnapshotSet, filterCss);
          this.cubeRenderer.setPlayerTextures(player.playerId, buildTextureSet(tintedSet));
          // 「敵プレイヤーの画像アイコンも表示してほしい」への対応:
          // 右側パネルの各プレイヤーカードにも色調補正済みスナップショット(静止ポーズ)を使う。
          if (tintedSet.down?.idle) this._setPlayerCardIcon(player.playerId, tintedSet.down.idle);
        }
      }

      setStatus('VRM: 表示中', '#88ddaa');
      this.time.delayedCall(2000, () => statusText?.destroy());
    } catch (e) {
      console.error('[GameScene] VRMの読み込みに失敗したため、デフォルト表示のままにします。', e);
      setStatus(`VRM読み込み失敗: ${e.message ?? e}`, '#ff8888');
    }
  }

  /**
   * CubeStage.generate(totalParticipants, humanCount)は開始地点配列の先頭
   * humanCount件を人間プレイヤー用(PVP時は全員同じ面)、残りをAI用として
   * 順に並べて返すため、そのままインデックスで人間/AIを判定できる。
   */
  _createPlayers(totalParticipants) {
    const startPositions = this.stage.getStartPositions();
    this.players = [];

    for (let i = 0; i < totalParticipants; i++) {
      const pos = startPositions[i] ?? startPositions[0];
      const isHuman = i < this.config.humanCount;
      const player = new Player(this, this.stage, pos.face, pos.col, pos.row, {
        colorIndex: i,
        isAI: !isHuman,
        playerId: i + 1,
      });
      this.players.push(player);
    }

    // humanPlayers[0]が「プレイヤー1」= カメラが常に追従する基準プレイヤー。
    // PVP(humanCount>=2)ではhumanPlayers全員が同じ面から一緒にスタートする
    // ため、プレイヤー1を映しておけば他の人間プレイヤーも同じ面にいる限り
    // 画面に映る(v1の割り切り: 誰かが単独で他の面へ渡った場合、カメラは
    // 引き続きプレイヤー1の面だけを映す)。
    this.humanPlayers = this.players.filter((p) => !p.isAI);
    this.humanPlayer = this.humanPlayers[0];
  }

  /**
   * 対戦画面のHUDを構築する。
   *
   * 「画面の上下はブラウザの大きさに合わせて、右側の空いている部分に
   * 各プレイヤーの情報を表示してほしい」との要望に対応し、画面右側に
   * 固定幅のパネル(this._panelContainer)を確保して各プレイヤーの
   * カード(アイコン+ステータス)を並べ、3Dバトルステージ(#cube-canvas)は
   * 残りの左側領域だけに表示させる(実際のサイズ計算はViewportLayout.js/
   * main.jsと共有)。パネル自体はここで箱だけ作り、実際の各プレイヤーの
   * カードは_buildPlayerCards()で(this.playersが確定してから)作る
   * (オンライン対戦のゲストは、この時点ではまだ人数が確定していないため)。
   */
  _createHud() {
    this._layout = computeBattleLayout(this.scale.width, this.scale.height);

    // 全体の残り時間・生存人数など、対局全体のステータスはステージ側
    // 左上に小さく表示する(各プレイヤー個別の情報は右側パネルへ移した)。
    this.hudText = this.add.text(10, 10, '', {
      fontSize: '15px',
      color: '#ffffff',
      lineSpacing: 4,
    });
    this.hudText.setDepth(DEPTH.UI);

    this._panelContainer = this.add.container(this._layout.stageWidth, 0);
    this._panelContainer.setDepth(DEPTH.UI);
    this._panelBg = this.add.rectangle(0, 0, this._layout.panelWidth, this._layout.totalHeight, 0x14181c, 0.92).setOrigin(0, 0);
    this._panelTitle = this.add
      .text(this._layout.panelWidth / 2, 14, 'プレイヤー', { fontSize: '16px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5, 0);
    this._panelContainer.add([this._panelBg, this._panelTitle]);
    this._playerCards = new Map();

    // ウィンドウサイズが変わるたびにステージ幅・パネル幅を再計算し、
    // パネル・カウントダウン・VRM読込状況テキストの位置を追従させる。
    // (シーン終了時にscale.offで確実に解除できるよう、ハンドラをフィールドに保持)
    this._onHudResizeHandler = (gameSize) => this._onGameResize(gameSize);
    this.scale.on('resize', this._onHudResizeHandler);
  }

  /** ウィンドウのリサイズに追従して、対戦画面右側パネル・中央寄せ要素の位置を再計算する */
  _onGameResize(gameSize) {
    if (!this._sceneActive) return;
    this._layout = computeBattleLayout(gameSize.width, gameSize.height);
    this._panelContainer?.setPosition(this._layout.stageWidth, 0);
    this._panelBg?.setSize(this._layout.panelWidth, this._layout.totalHeight);
    this._panelTitle?.setPosition(this._layout.panelWidth / 2, 14);
    this._vrmStatusText?.setPosition(this._layout.stageWidth - 10, 10);
    this._guestStatusText?.setPosition(this._layout.stageWidth / 2, this._layout.totalHeight / 2);
    if (this.countdownText) {
      this.countdownText.setPosition(this._layout.stageWidth / 2, this._layout.totalHeight / 2);
    }
    if (this._touchControls) {
      const layout = computeTouchControlLayout(this._layout.stageWidth, this._layout.totalHeight);
      this._touchControls.upBtn.setPosition(layout.up.x, layout.up.y);
      this._touchControls.downBtn.setPosition(layout.down.x, layout.down.y);
      this._touchControls.leftBtn.setPosition(layout.left.x, layout.left.y);
      this._touchControls.rightBtn.setPosition(layout.right.x, layout.right.y);
      this._touchControls.bombBtn.setPosition(layout.bomb.x, layout.bomb.y);
      this._touchControls.pauseBtn.setPosition(layout.pause.x, layout.pause.y);
    }
  }

  /**
   * this.players確定後(または人数変化後)に、右側パネルの各プレイヤー
   * カード(アイコン+名前+ステータス)を作り直す。ホスト/ローカルは
   * create()から、ゲストはmatch_init受信直後(_applyMatchInit)から
   * それぞれ呼ばれる(呼ばれるタイミングでthis.playersの人数が異なる
   * ため、カード自体もその都度作り直す)。
   */
  _buildPlayerCards() {
    if (!this._panelContainer) return;
    for (const card of this._playerCards.values()) {
      for (const el of card.elements) el.destroy();
    }
    this._playerCards.clear();

    // 「スマホでもプレイできるように」への対応: 狭い画面(this._layout.
    // compactPanel)では、アイコン+名前を横並びにする従来レイアウトだと
    // パネル幅(MIN_HUD_PANEL_WIDTH程度)に収まらないため、アイコンを
    // 縦方向中心に配置し名前・ステータスをその下に積む縦積みレイアウトに
    // 切り替える(_createPlayerCard参照)。カードの高さもそれに合わせて
    // 縮める。
    const compact = !!this._layout.compactPanel;
    const cardHeight = compact ? 78 : 96;
    const startY = 44;
    this.players.forEach((player, index) => {
      const card = this._createPlayerCard(player, startY + index * cardHeight, cardHeight, compact);
      this._panelContainer.add(card.elements);
      this._playerCards.set(player.playerId, card);
    });
    this._updateHud();
  }

  /**
   * 1人分のプレイヤーカード(アイコン+名前+ステータステキスト)を作る。
   * 画像アイコンは後からVRM読込完了時に差し替わる(_setPlayerCardIcon参照)。
   * @param {boolean} compact - 狭いパネル向けの縦積みレイアウトにするか
   */
  _createPlayerCard(player, y, height, compact = false) {
    const panelWidth = this._layout.panelWidth;
    const colorName = PLAYER_COLORS[player.colorIndex % PLAYER_COLORS.length];
    const fillColor = PLAYER_COLOR_HEX[colorName] ?? 0x888888;

    let iconSize;
    let iconCenterX;
    let iconCenterY;
    let nameText;
    let statusText;

    if (compact) {
      iconSize = 32;
      iconCenterX = panelWidth / 2;
      iconCenterY = y + 6 + iconSize / 2;
      nameText = this.add
        .text(panelWidth / 2, iconCenterY + iconSize / 2 + 3, this._playerCardLabel(player), {
          fontSize: '10px',
          color: '#ffffff',
          fontStyle: 'bold',
          align: 'center',
        })
        .setOrigin(0.5, 0);
      statusText = this.add
        .text(panelWidth / 2, iconCenterY + iconSize / 2 + 15, '', {
          fontSize: '9px',
          color: '#dddddd',
          align: 'center',
          lineSpacing: 2,
        })
        .setOrigin(0.5, 0);
    } else {
      iconSize = 56;
      const iconX = 14;
      iconCenterX = iconX + iconSize / 2;
      iconCenterY = y + 8 + iconSize / 2;
      nameText = this.add
        .text(iconX + iconSize + 10, y + 4, this._playerCardLabel(player), {
          fontSize: '13px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0);
      statusText = this.add
        .text(iconX + iconSize + 10, y + 24, '', {
          fontSize: '12px',
          color: '#dddddd',
          lineSpacing: 3,
        })
        .setOrigin(0, 0);
    }

    const iconBg = this.add.circle(iconCenterX, iconCenterY, iconSize / 2, fillColor);
    iconBg.setStrokeStyle(2, 0xffffff, 0.7);
    const divider = this.add.rectangle(panelWidth / 2, y + height - 4, Math.max(0, panelWidth - 20), 1, 0xffffff, 0.15);

    return {
      player,
      iconBg,
      iconImage: null,
      nameText,
      statusText,
      elements: [iconBg, nameText, statusText, divider],
      iconCenterX,
      iconCenterY,
      iconSize,
    };
  }

  /** プレイヤーカードに表示する名前ラベル(自分/他プレイヤー/AIを判別する) */
  _playerCardLabel(player) {
    if (player.isAI) return `AI (P${player.playerId})`;
    const isPrimarySelf = player === this.humanPlayer;
    const idx = (this.humanPlayers ?? []).indexOf(player);
    const label = `プレイヤー${idx >= 0 ? idx + 1 : player.playerId}`;
    return isPrimarySelf ? `${label} (あなた)` : label;
  }

  /**
   * プレイヤーのVRMアイコン(down向きスナップショット)をカードに反映する。
   * _loadAllVrmAppearances()からプレイヤーごとのcanvasスナップショットが
   * 用意できたタイミングで呼ばれる。「自分・敵プレイヤーの画像アイコンも
   * 情報と一緒に表示してほしい」という要望への対応。
   * @param {number} playerId
   * @param {HTMLCanvasElement} canvas - down向きスナップショット
   */
  _setPlayerCardIcon(playerId, canvas) {
    const card = this._playerCards?.get(playerId);
    if (!card || !this._sceneActive) return;
    const textureKey = `player-icon-${playerId}`;
    if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
    this.textures.addCanvas(textureKey, canvas);

    card.iconImage?.destroy();
    const image = this.add.image(card.iconCenterX, card.iconCenterY, textureKey);
    image.setDisplaySize(card.iconSize - 6, card.iconSize - 6);
    card.iconImage = image;
    card.iconBg.setFillStyle(card.iconBg.fillColor, 0.35); // 背景の色付き円はアイコンの縁取りとして薄く残す
    this._panelContainer.add(image);
  }

  /**
   * 人間プレイヤー1人につき1つ、HUMAN_KEY_MAPS(GameConstants.js)の
   * キー配列を順番に割り当てる(ローカルPVP対応: 同一キーボードでの
   * ホットシート対戦。プレイヤー1=矢印キー+Space、プレイヤー2=WASD+F、
   * プレイヤー3=IJKL+U、プレイヤー4=テンキー)。
   * ポーズ(ESC)は全員共通の1つのキーのままにする(誰が押しても一時停止)。
   *
   * オンライン対戦のホストは、ローカルキーで操作するのは自分の1人分
   * (humanPlayers[0])だけにする。2人目以降(ネットワーク越しの参加者)は
   * ホストの物理キーボードとは無関係なので、_networkMoveStates(相手から
   * 届いた入力状態)を_handleMovementInputで併せて処理する。
   */
  _createInput() {
    const KeyCodes = Phaser.Input.Keyboard.KeyCodes;
    this.escKey = this.input.keyboard.addKey(KeyCodes.ESC);
    this.escKey.on('down', () => {
      if (this.countdownActive) return;
      this._pauseGame();
    });

    const isOnlineHost = this.config.mode === 'online';
    const localHumanPlayers = isOnlineHost ? this.humanPlayers.slice(0, 1) : this.humanPlayers;

    this._humanInputs = localHumanPlayers.map((player, index) => {
      const map = HUMAN_KEY_MAPS[index] ?? HUMAN_KEY_MAPS[HUMAN_KEY_MAPS.length - 1];
      const keys = {
        up: this.input.keyboard.addKey(KeyCodes[map.up]),
        down: this.input.keyboard.addKey(KeyCodes[map.down]),
        left: this.input.keyboard.addKey(KeyCodes[map.left]),
        right: this.input.keyboard.addKey(KeyCodes[map.right]),
        bomb: this.input.keyboard.addKey(KeyCodes[map.bomb]),
      };
      keys.bomb.on('down', () => {
        if (this.countdownActive) return;
        this._tryPlaceBomb(player);
      });
      return { player, keys };
    });
  }

  /**
   * このブラウザ/デバイスがタッチ操作に対応しているかどうか。
   * window/navigatorが存在しない環境(Node上のテスト等)では常にfalseを
   * 返す(TouchControlLayout.isTouchCapable参照)。
   */
  _isTouchCapable() {
    const win = typeof window !== 'undefined' ? window : null;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    return isTouchCapable(win, nav);
  }

  /**
   * 「スマホでもプレイできるようにしてほしい」への対応。
   * 従来この対戦画面は矢印キー+Space(キーボード)専用の操作しか無く、
   * タッチ操作の手段が一切無かったため、スマホでは事実上プレイ不可能
   * だった。タッチ対応デバイス(_isTouchCapable)でのみ、画面左下に
   * 十字キー風の4方向ボタン、右下に爆弾設置ボタン、右上に一時停止
   * ボタンを半透明のオーバーレイとして表示し、指のタッチ操作で
   * キーボードと同じ移動・爆弾設置ができるようにする。
   *
   * 4方向ボタンの押下状態はthis._touchMoveStateに保持し、
   * _handleMovementInput()(ローカル/ホスト側)・_sendGuestMoveInputIfDue()
   * (ゲスト側)の両方で、既存のキーボード入力状態とOR条件で合わせて
   * 判定する(どちらか一方が押されていれば移動する)。this._touchMoveState
   * 自体はタッチ非対応デバイスでも常に(すべてfalseで)用意しておくことで、
   * 参照側で毎回タッチ対応かどうかを気にしなくて済むようにしてある。
   */
  _createTouchControls() {
    this._touchMoveState = { up: false, down: false, left: false, right: false };
    this._touchControls = null;
    if (!this._isTouchCapable()) return;

    const layout = computeTouchControlLayout(this._layout.stageWidth, this._layout.totalHeight);

    const makeDirButton = (pos, label, dir) => {
      const btn = this.add
        .text(pos.x, pos.y, label, {
          fontSize: '26px',
          color: '#ffffff',
          backgroundColor: '#3a3a3a',
          padding: { x: 14, y: 10 },
        })
        .setOrigin(0.5)
        .setAlpha(0.6)
        .setDepth(DEPTH.UI)
        .setInteractive({ useHandCursor: true });
      const press = () => {
        this._touchMoveState[dir] = true;
        btn.setAlpha(0.9);
      };
      const release = () => {
        this._touchMoveState[dir] = false;
        btn.setAlpha(0.6);
      };
      btn.on('pointerdown', press);
      btn.on('pointerup', release);
      btn.on('pointerout', release);
      return btn;
    };

    const upBtn = makeDirButton(layout.up, '▲', 'up');
    const downBtn = makeDirButton(layout.down, '▼', 'down');
    const leftBtn = makeDirButton(layout.left, '◀', 'left');
    const rightBtn = makeDirButton(layout.right, '▶', 'right');

    const bombBtn = this.add
      .text(layout.bomb.x, layout.bomb.y, '💣', {
        fontSize: '30px',
        backgroundColor: '#5a2a2a',
        padding: { x: 16, y: 12 },
      })
      .setOrigin(0.5)
      .setAlpha(0.65)
      .setDepth(DEPTH.UI)
      .setInteractive({ useHandCursor: true });
    const bombRelease = () => bombBtn.setAlpha(0.65);
    bombBtn.on('pointerdown', () => {
      bombBtn.setAlpha(0.95);
      this._handleTouchBombPress();
    });
    bombBtn.on('pointerup', bombRelease);
    bombBtn.on('pointerout', bombRelease);

    const pauseBtn = this.add
      .text(layout.pause.x, layout.pause.y, '⏸', {
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#3a3a3a',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setAlpha(0.7)
      .setDepth(DEPTH.UI)
      .setInteractive({ useHandCursor: true });
    pauseBtn.on('pointerdown', () => {
      if (!this.countdownActive) this._pauseGame();
    });

    this._touchControls = { upBtn, downBtn, leftBtn, rightBtn, bombBtn, pauseBtn };
  }

  /**
   * タッチ操作の爆弾ボタンが押された時の処理。ローカル(ホスト自身を含む)
   * では最初の人間プレイヤー(_humanInputs[0]、タッチ操作の対象は常に
   * この1人分のみとする)に対して直接_tryPlaceBombを呼び、オンライン
   * 対戦のゲストではキーボードのSpaceキーと同じくホストへbomb入力
   * メッセージを送信するだけにする(ゲストはホスト権威型で描画専用のため)。
   */
  _handleTouchBombPress() {
    if (this.countdownActive) return;
    if (this.config.mode === 'online' && this.config.online?.role === 'guest') {
      if (!this.myPlayerId) return;
      this.config.online.network.send(buildBombInputMessage(this.myPlayerId));
      return;
    }
    const player = this._humanInputs?.[0]?.player;
    if (player) this._tryPlaceBomb(player);
  }

  /** 試合開始前の「3・2・1・START」カウントダウン演出。終了までプレイヤー/AIの行動を止める */
  _startCountdown() {
    this.countdownActive = true;
    // 画面レイアウトのブラウザ追従(2026-07更新)により、中央位置は固定値
    // (旧SCREEN_WIDTH/SCREEN_HEIGHT)ではなく、右側パネル分を除いた
    // 3Dステージ表示領域(this._layout)の中央を使う(_onGameResizeが
    // リサイズ時にこのcountdownTextを追従させる際も同じ基準を使っている)。
    const centerX = this._layout.stageWidth / 2;
    const centerY = this._layout.totalHeight / 2;

    this.countdownText = this.add
      .text(centerX, centerY, '', { fontSize: '64px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(DEPTH.UI);

    COUNTDOWN_STEPS.forEach((label, i) => {
      this.time.delayedCall(i * COUNTDOWN_STEP_MS, () => {
        this.countdownText.setText(label);
        soundSystem.playSE(label === 'START' ? 'countdown_go' : 'countdown_tick');
      });
    });

    this.time.delayedCall(COUNTDOWN_STEPS.length * COUNTDOWN_STEP_MS, () => {
      this.countdownText.destroy();
      this.countdownActive = false;
      soundSystem.playBGM('game');
    });
  }

  _pauseGame() {
    this.scene.launch(SCENE_KEYS.PAUSE);
    this.scene.pause();
  }

  /** 指定の面・タイルに未爆発の爆弾があるかどうか（移動阻害・設置阻害の判定に使用） */
  _isTileOccupiedByBomb(face, col, row) {
    return this.bombs.some((b) => !b.detonated && b.face === face && b.col === col && b.row === row);
  }

  /**
   * 「新しいアイテム時限装置機能アイテムを追加してほしい」への対応:
   * ⏱(TIMER)取得済みプレイヤーが、新しく爆弾を置けない状況(既に上限数
   * 置いている・自分の爆弾の上に立っている等)で爆弾ボタンを押した場合は、
   * 新規設置の代わりに自分が既に置いている爆弾を全て今すぐ起爆する
   * (リモート起爆。導火線(BOMB_FUSE_MS)任せにせず自分のタイミングで
   * 爆発させられる)。⏱未取得なら、これまで通り単に何もしない。
   */
  _tryPlaceBomb(player) {
    if (!player || !player.isAlive) return;

    const canPlaceHere =
      player.canPlaceBomb() &&
      !this._isTileOccupiedByBomb(player.face, player.col, player.row) &&
      this.stage.canPlaceBombAt(player.face, player.col, player.row);

    if (!canPlaceHere) {
      if (player.hasRemoteDetonator) this._tryRemoteDetonate(player);
      return;
    }

    const bomb = new Bomb(this, player.face, player.col, player.row, {
      ownerId: player.playerId,
      blastRange: player.blastRange,
      onDetonate: (b) => this._onBombDetonate(b),
    });
    this.bombs.push(bomb);
    this.cubeRenderer?.addBomb(bomb);
    player.onBombPlaced();
    soundSystem.playSE('bomb_place');
  }

  /**
   * ⏱(TIMER)によるリモート起爆本体。playerが所有する、まだ爆発していない
   * 全ての爆弾(蹴られてスライド中のものも含む)を即座に起爆する。
   * 1つも無ければ何もしない。誘爆と同じ`detonate()`をそのまま呼ぶだけ
   * なので、導火線タイマーの解除・爆風計算・ネットワーク同期(オンライン
   * 対戦時の explosion イベント送信)は全て既存の`_onBombDetonate`の
   * 仕組みがそのまま面倒を見る。
   */
  _tryRemoteDetonate(player) {
    const ownBombs = this.bombs.filter((b) => b.ownerId === player.playerId && !b.detonated);
    if (ownBombs.length === 0) return;
    for (const bomb of ownBombs) {
      bomb.detonate();
    }
    soundSystem.playSE('bomb_place');
  }

  _onBombDetonate(bomb) {
    const isChainReaction = bomb._chainTriggered === true;
    const faceStage = this.stage.getFaceStage(bomb.face);
    const { tiles, broken } = Explosion.computeBlastTiles(faceStage, bomb.col, bomb.row, bomb.blastRange);
    this.cubeRenderer?.showExplosion(bomb.face, tiles, this.time.now);
    this.cubeRenderer?.removeBomb(bomb);
    soundSystem.playSE(isChainReaction ? 'chain_explosion' : 'explosion');

    const owner = this.players.find((p) => p.playerId === bomb.ownerId);
    if (owner) owner.stats.bombsExploded++;

    // 「アイテムは爆弾で壊れるようにしてほしい」への対応:
    // 爆風が届いたマスに既に置かれていたアイテムを破壊する。ここで判定に
    // 使うのは「この爆発で壊れたブロックからアイテムが出現する前」の
    // this.itemsのスナップショットにする必要がある。そうしないと、直後の
    // 破壊ブロック処理で新しく出現したアイテム(壊れたブロックの中身)を
    // その場で即座に壊してしまう(=アイテム入りブロックを壊しても何も
    // 手に入らなくなる)事故が起きるため、必ずブロック破壊ループより前に
    // このスナップショット判定を行う(以前はループの後で行っており、同一
    // 爆発で出現した直後のアイテムまで巻き込んで即座に破壊してしまう
    // 回帰不具合になっていた)。
    const itemsDestroyedByBlast = this.items.filter(
      (it) => it.face === bomb.face && tiles.some((t) => t.col === it.col && t.row === it.row)
    );
    if (itemsDestroyedByBlast.length > 0) {
      const destroyedSet = new Set(itemsDestroyedByBlast);
      for (const item of itemsDestroyedByBlast) {
        this.cubeRenderer?.removeItem(item);
        item.destroy();
      }
      this.items = this.items.filter((it) => !destroyedSet.has(it));
    }

    // 破壊されたブロックの見た目を更新し、アイテム入りブロックだった場合はアイテムを出現させる
    // (オンライン対戦のホストの場合、ゲストへ送るexplosionイベントに含める
    // ため、実際に破壊が確定したマスをmirrorBrokenForBroadcastへ集める)
    const mirrorBrokenForBroadcast = [];
    for (const b of broken) {
      this.cubeRenderer?.removeBlockAt(bomb.face, b.col, b.row);
      if (b.spawnItem && b.itemType) {
        const item = new Item(this, bomb.face, b.col, b.row, b.itemType);
        this.items.push(item);
        this.cubeRenderer?.addItem(item);
      }
      // 面の隅・approachマスを壊した場合は、面をまたいだ先(隣接面)の対応する
      // マスも連動して破壊する。爆風は面をまたいで伝播しないため、これが無いと
      // 隣接面側の対応マスが壊せる壁のまま残り、👻無しでは絶対に足を踏み入れ
      // られず、結果的にその面から一切移動できなくなってしまう(不具合修正)。
      for (const mirror of this.stage.getMirrorCells(bomb.face, b.col, b.row)) {
        const mirrorResult = this.stage.breakBlock(mirror.face, mirror.col, mirror.row);
        if (mirrorResult.destroyed) {
          this.cubeRenderer?.removeBlockAt(mirror.face, mirror.col, mirror.row);
          mirrorBrokenForBroadcast.push({ face: mirror.face, col: mirror.col, row: mirror.row });
          if (mirrorResult.spawnItem && mirrorResult.itemType) {
            const mirrorItem = new Item(this, mirror.face, mirror.col, mirror.row, mirrorResult.itemType);
            this.items.push(mirrorItem);
            this.cubeRenderer?.addItem(mirrorItem);
          }
        }
      }
    }

    // オンライン対戦のホストは、ゲスト側でも爆風エフェクト・ブロック破壊を
    // 即座に反映できるよう単発イベントとして送る(周期的なstate同期だけだと
    // 爆風の一瞬の見た目や破壊タイミングが揃わないため)。
    if (this.config.mode === 'online') {
      this.config.online.network.send(
        buildExplosionEvent(bomb, tiles, broken, mirrorBrokenForBroadcast, isChainReaction)
      );
    }

    // 爆風が届いたマス(同じ面のみ)にいるプレイヤーへダメージ
    for (const player of this.players) {
      if (!player.isAlive || player.face !== bomb.face) continue;
      const hit = tiles.some((t) => t.col === player.col && t.row === player.row);
      if (!hit) continue;

      const wasAlive = player.isAlive;
      const hadGrace = player.hasBombGrace;
      const tookRealDamage = player.takeDamage();
      // 「一人1回まで爆弾に当たっても大丈夫」の猶予を消費して助かった場合の合図音
      if (!tookRealDamage && hadGrace && !player.hasBombGrace) {
        soundSystem.playSE('bomb_grace');
      }
      if (wasAlive && !player.isAlive) {
        this.battleSystem.notifyPlayerDied(player);
        if (owner && owner !== player) owner.stats.kills++;
        // 「キャラクターを倒したら、取ったアイテムを落とすようにしてほしい」への対応
        this._dropItemsOnDeath(player);
      }
    }

    // 爆風が届いたマス(同じ面のみ)にある他の爆弾を誘爆させる（連鎖爆発）
    for (const other of this.bombs) {
      if (other === bomb || other.detonated || other.face !== bomb.face) continue;
      const hit = tiles.some((t) => t.col === other.col && t.row === other.row);
      if (hit) {
        other._chainTriggered = true;
        other.detonate();
      }
    }

    // 爆弾リストの掃除とプレイヤーの所持数を戻す
    this.bombs = this.bombs.filter((b) => !b.detonated);
    owner?.onBombResolved();
  }

  /**
   * 「制限時間を過ぎたら終わりではなく、制限時間が過ぎて０になったら
   * 残り一人になるまで爆弾が沢山降ってくるようにしてほしい」への対応。
   * BattleSystem.suddenDeathがtrueになった後、一定間隔(SUDDEN_DEATH_
   * BOMB_INTERVAL_MS)ごとに、生存者がいる各面へ環境爆弾(誰の所有でもない、
   * ownerId:null の爆弾。プレイヤーの所持数制限とは無関係で何個でも降る)を
   * 降らせる。オンライン対戦のゲスト側はupdate()内でこのメソッドに到達する
   * 前に_updateGuest(time)がreturnするため、常にホスト/ローカル権威側のみ
   * で実行される(通常の爆弾追加と同じ仕組み(this.bombs.push +
   * cubeRenderer.addBomb)で見た目もゲストへ自然に伝わる)。
   */
  _updateSuddenDeathBombRain(time) {
    if (!this.battleSystem.suddenDeath || this.battleSystem.isOver) return;
    if (time < this._nextSuddenDeathDropAt) return;
    this._nextSuddenDeathDropAt = time + SUDDEN_DEATH_BOMB_INTERVAL_MS;
    this._spawnSuddenDeathBombs();
  }

  /** 生存者がいる面それぞれに対し、1波あたりSUDDEN_DEATH_BOMBS_PER_WAVE個の環境爆弾を降らせる */
  _spawnSuddenDeathBombs() {
    const livingFaces = new Set(this.players.filter((p) => p.isAlive).map((p) => p.face));
    for (const face of livingFaces) {
      for (let i = 0; i < SUDDEN_DEATH_BOMBS_PER_WAVE; i++) {
        this._trySpawnEnvironmentBomb(face);
      }
    }
  }

  /** 指定の面から、爆弾を置ける(空白かつ未設置の)マスをランダムに1つ選んで環境爆弾を設置する */
  _trySpawnEnvironmentBomb(face) {
    const faceStage = this.stage.getFaceStage(face);
    if (!faceStage) return;

    const candidates = [];
    for (let row = 0; row < faceStage.rows; row++) {
      for (let col = 0; col < faceStage.cols; col++) {
        if (!faceStage.canPlaceBombAt(col, row)) continue;
        if (this._isTileOccupiedByBomb(face, col, row)) continue;
        candidates.push({ col, row });
      }
    }
    if (candidates.length === 0) return;

    const { col, row } = random.pick(candidates);
    const bomb = new Bomb(this, face, col, row, {
      ownerId: null,
      blastRange: SUDDEN_DEATH_BLAST_RANGE,
      onDetonate: (b) => this._onBombDetonate(b),
    });
    this.bombs.push(bomb);
    this.cubeRenderer?.addBomb(bomb);
  }

  /**
   * 「キャラクターを倒したら、取ったアイテムを落とすようにしてほしい」への対応。
   * 死亡したプレイヤーがそれまでに取得したアイテム種別ぶん、死亡地点付近の
   * 空きマスにアイテムを再出現させる。死亡地点そのものは直前の爆風で
   * 埋まっている可能性が高いため、_findNearbyEmptyTilesで周辺を探索する。
   * オンライン対戦でも、新規アイテムの出現は既存の周期的state同期
   * (buildStateMessage)でゲスト側へ自然に伝わるため、専用の通信メッセージは
   * 不要（NetworkProtocol.jsのitem追加/削除diffの仕組みをそのまま利用）。
   * @param {Player} player
   */
  _dropItemsOnDeath(player) {
    const itemTypes = player.collectedItemTypes ?? [];
    player.collectedItemTypes = [];
    if (itemTypes.length === 0) return;

    const tiles = this._findNearbyEmptyTiles(player.face, player.col, player.row, itemTypes.length);
    itemTypes.forEach((itemType, i) => {
      const tile = tiles[i];
      if (!tile) return; // 周辺に空きマスが足りない場合はその分は諦める(通常はほぼ起きない)
      const item = new Item(this, player.face, tile.col, tile.row, itemType);
      this.items.push(item);
      this.cubeRenderer?.addItem(item);
    });
  }

  /**
   * 指定の面のoriginCol/originRowを起点に、幅優先探索(BFS)で近い順に
   * 「アイテムを置ける空きマス」をcount個見つける。壁(HARD/SOFT/ITEM)は
   * 越えて探索しない(通行可能=EMPTYなマスのみを辿る)ため、行き止まりに
   * 死亡した場合は見つかる数が少なくなることがある。
   * @param {string} face
   * @param {number} originCol
   * @param {number} originRow
   * @param {number} count
   * @returns {Array<{col:number,row:number}>}
   */
  _findNearbyEmptyTiles(face, originCol, originRow, count) {
    const results = [];
    if (count <= 0) return results;

    const isOccupied = (col, row) =>
      this._isTileOccupiedByBomb(face, col, row) ||
      this.items.some((it) => it.face === face && it.col === col && it.row === row) ||
      this.players.some((p) => p.isAlive && p.face === face && p.col === col && p.row === row);

    const visited = new Set([`${originCol},${originRow}`]);
    if (this.stage.canPlaceBombAt(face, originCol, originRow) && !isOccupied(originCol, originRow)) {
      results.push({ col: originCol, row: originRow });
    }

    let frontier = [{ col: originCol, row: originRow }];
    let guard = 0;
    while (frontier.length > 0 && results.length < count && guard < 2000) {
      const nextFrontier = [];
      for (const { col, row } of frontier) {
        for (const dir of Object.values(DIRECTION_VECTORS)) {
          const nCol = col + dir.dCol;
          const nRow = row + dir.dRow;
          const key = `${nCol},${nRow}`;
          if (visited.has(key)) continue;
          visited.add(key);
          guard++;
          if (!this.stage.canPlaceBombAt(face, nCol, nRow)) continue; // 壁はここで探索を打ち切る
          if (results.length < count && !isOccupied(nCol, nRow)) {
            results.push({ col: nCol, row: nRow });
          }
          nextFrontier.push({ col: nCol, row: nRow });
        }
      }
      frontier = nextFrontier;
    }
    return results;
  }

  /** 現在フィールドに存在する爆弾の爆風予測範囲を集計する（AIの危険地帯回避に使用） */
  _computeDangerTiles() {
    const dangerTiles = new Set();
    for (const bomb of this.bombs) {
      if (bomb.detonated) continue;
      const faceStage = this.stage.getFaceStage(bomb.face);
      const { tiles } = Explosion.computeBlastTiles(faceStage, bomb.col, bomb.row, bomb.blastRange, {
        dryRun: true,
      });
      for (const t of tiles) dangerTiles.add(`${bomb.face}:${t.col},${t.row}`);
    }
    return dangerTiles;
  }

  /**
   * プレイヤーが乗っているマスにアイテムがあれば取得・効果適用する。
   *
   * 【修正】以前は`player.isMoving`が真の間は取得判定をスキップしていたが、
   * Player.tryMove()はマス移動を開始した瞬間にcol/rowを移動先へ即座に
   * 更新し(isMovingは見た目の補間演出のためだけの状態)、キーを押し続けて
   * 連続移動している間は「isMovingがfalseに戻った直後のフレームで
   * 即座に次のtryMoveが呼ばれてisMovingが再度trueになる」ため、
   * アイテムの上に乗った瞬間を取得判定側が捉えられず「ちょうど止まった
   * 場合しか拾えない」という不具合になっていた。col/rowは移動中も既に
   * 移動先を指しているため、isMovingの状態に関わらずcol/row一致だけで
   * 判定すれば「アイテムの上を通っただけで取れる」ようになる。
   */
  _handleItemPickup() {
    if (this.items.length === 0) return;

    for (const player of this.players) {
      if (!player.isAlive) continue;
      const index = this.items.findIndex((it) => it.face === player.face && it.col === player.col && it.row === player.row);
      if (index === -1) continue;

      const item = this.items[index];
      ItemSystem.applyItem(player, item.type, this);
      player.stats.itemsCollected++;
      // 「キャラクターを倒したら取ったアイテムを落とす」ための記録
      // (_dropItemsOnDeath参照)。
      player.collectedItemTypes.push(item.type);
      this.cubeRenderer?.removeItem(item);
      item.destroy();
      this.items.splice(index, 1);
      soundSystem.playSE('item_get');

      if (this.config.mode === 'online') {
        this.config.online.network.send(buildItemPickupEvent(item, player.playerId));
      }
    }
  }

  update(time, delta) {
    if (this.countdownActive) return;

    if (this.config.mode === 'online' && this.config.online?.role === 'guest') {
      this._updateGuest(time);
      return;
    }

    this._handleMovementInput();

    const dangerTiles = this._computeDangerTiles();
    this.aiSystem.update(time, delta, {
      stage: this.stage,
      bombs: this.bombs,
      players: this.players,
      items: this.items,
      dangerTiles,
      placeBomb: (player) => this._tryPlaceBomb(player),
    });

    this._handleItemPickup();

    this.battleSystem.update(delta);
    this._updateSuddenDeathBombRain(time);
    this._updateHud();

    if (this.cubeRenderer?.ready) {
      this.cubeRenderer.syncPlayers(this.players, time);
      if (this.humanPlayer) this.cubeRenderer.rotateToFace(this.humanPlayer.face, time);
      this.cubeRenderer.render(time);
    }

    if (this.config.mode === 'online') this._broadcastStateIfDue(time);

    if (this.battleSystem.isOver && !this.resultTriggered) {
      this.resultTriggered = true;
      // PVP(人間複数)では「人間の誰かが勝ったか」で勝利/敗北SEを選ぶ
      const humanWon = (this.humanPlayers ?? []).includes(this.battleSystem.winner);
      soundSystem.playSE(humanWon ? 'victory' : 'defeat');
      soundSystem.stopBGM();

      // rankingPlayerIds: ランキング(RankingSystem)に対戦結果を送信すべき
      // 「このブラウザ(クライアント)が実際に操作していたプレイヤー」のID。
      // ai/ローカルPVPでは1つの端末が試合全体を実行するのでhumanPlayerIds
      // とそのまま同じでよいが、オンライン対戦ではホスト・各ゲストが
      // それぞれ独立にResultSceneへ遷移するため、humanPlayerIds(=試合参加者
      // 全員の人間プレイヤーID)をそのまま使うと、全員分のランキング行が
      // クライアントの数だけ重複送信されてしまう。オンライン対戦時は
      // 「自分の1人分」だけに絞る。
      const rankingPlayerIds =
        this.config.mode === 'online'
          ? [this.humanPlayers?.[0]?.playerId].filter((id) => id != null)
          : (this.humanPlayers ?? []).map((p) => p.playerId);

      const resultPayload = {
        winner: this.battleSystem.winner,
        mode: this.config.mode,
        humanPlayerIds: (this.humanPlayers ?? []).map((p) => p.playerId),
        rankingPlayerIds,
        players: this.players.map((p) => ({
          playerId: p.playerId,
          isAI: p.isAI,
          stats: { ...p.stats },
        })),
        finalRanks: Object.fromEntries(this.battleSystem.finalRanks),
      };

      // オンライン対戦のホストは、ゲスト側も同じタイミングでリザルトへ
      // 遷移できるよう結果をブロードキャストする。
      if (this.config.mode === 'online') {
        this.config.online.network.send(
          buildResultEvent(this.battleSystem.winner?.playerId ?? null, resultPayload.players, resultPayload.finalRanks)
        );
      }

      this.time.delayedCall(1500, () => {
        this.scene.start(SCENE_KEYS.RESULT, resultPayload);
      });
    }
  }

  /**
   * 人間プレイヤーぶん移動入力を処理する。ローカル(ホスト自身を含む)は
   * 割り当てキー(_humanInputs)を毎フレーム参照し、オンライン対戦で
   * ネットワーク越しに参加している人間プレイヤーは、直近に届いた入力状態
   * (_networkMoveStates、_onHostNetworkMessage参照)を参照する。
   */
  _handleMovementInput() {
    this._humanInputs?.forEach(({ player, keys }, index) => {
      if (!player.isAlive) return;
      // 「スマホでもプレイできるように」への対応: タッチ操作(仮想十字キー)
      // は常に最初の人間プレイヤー(index===0)だけを操作対象とする
      // (ローカルPVPで複数人が同じ端末を触る場合でも、タッチはこの1人分
      // のみ。2人目以降は従来通りキーボードのみ)。this._touchMoveStateは
      // タッチ非対応デバイスでは常にすべてfalseなので、キーボードのみの
      // 従来動作と変わらない。
      const touch = index === 0 ? this._touchMoveState : null;
      if (keys.up.isDown || touch?.up) {
        this._moveOrKick(player, 'up');
      } else if (keys.down.isDown || touch?.down) {
        this._moveOrKick(player, 'down');
      } else if (keys.left.isDown || touch?.left) {
        this._moveOrKick(player, 'left');
      } else if (keys.right.isDown || touch?.right) {
        this._moveOrKick(player, 'right');
      }
    });

    if (this._networkMoveStates) {
      for (const [playerId, keysState] of this._networkMoveStates) {
        const player = this.players.find((p) => p.playerId === playerId);
        if (!player || !player.isAlive) continue;
        const direction = pickDirectionFromKeys(keysState);
        if (direction) this._moveOrKick(player, direction);
      }
    }
  }

  /**
   * 「爆弾を蹴れるアイテムを追加してほしい」への対応。
   * まず通常通りPlayer.tryMove()を試み、成功すればそれで終わり。
   * 移動できなかった場合で、かつプレイヤーが💥(KICK)を持っていれば、
   * 進もうとした先が「同じ面の未爆発の爆弾のマス」かどうかを
   * CubeStage.resolveMove()で覗き見て判定し、該当すれば爆弾を
   * その方向へ滑らせる(_tryKickBomb)。蹴った瞬間はまだ爆弾がそのマスに
   * 残っているため、プレイヤー自身の移動は次フレーム以降(爆弾が
   * どいた後)に持ち越しになる(自然な「まず蹴る→間を置いて進む」動作)。
   * @param {Player} player
   * @param {'up'|'down'|'left'|'right'} direction
   */
  _moveOrKick(player, direction) {
    const isBlockedByBomb = (face, col, row) => this._isTileOccupiedByBomb(face, col, row);
    const moved = player.tryMove(direction, isBlockedByBomb);
    if (moved || !player.canKickBombs || player.isMoving) return moved;

    const resolved = this.stage.resolveMove(player.face, player.col, player.row, direction);
    if (!resolved) return false;
    if (!this.stage.isWalkable(resolved.face, resolved.col, resolved.row, { canPassSoftBlock: player.canPassSoftBlock })) {
      return false;
    }
    // 面をまたいだ先の爆弾はキック対象外(Bomb.slideTo参照: 蹴りは同一面内のみ)。
    if (resolved.face !== player.face) return false;

    const bomb = this.bombs.find(
      (b) => !b.detonated && !b._isSliding && b.face === resolved.face && b.col === resolved.col && b.row === resolved.row
    );
    if (!bomb) return false;

    this._tryKickBomb(bomb, direction);
    return false;
  }

  /**
   * 爆弾を指定方向へ1マスずつ滑らせ、壁・他の爆弾・他プレイヤーにぶつかる
   * 直前まで進める。1マスも動かせなかった場合は何もしない。
   * @param {Bomb} bomb
   * @param {'up'|'down'|'left'|'right'} direction
   * @returns {boolean} 1マス以上スライドできた場合true
   */
  _tryKickBomb(bomb, direction) {
    const vec = DIRECTION_VECTORS[direction];
    if (!vec) return false;

    let col = bomb.col;
    let row = bomb.row;
    let moved = 0;
    let guard = 0;
    while (guard < 64) {
      guard++;
      const nCol = col + vec.dCol;
      const nRow = row + vec.dRow;
      if (!this.stage.canPlaceBombAt(bomb.face, nCol, nRow)) break;
      if (this._isTileOccupiedByBomb(bomb.face, nCol, nRow)) break;
      if (this.players.some((p) => p.isAlive && p.face === bomb.face && p.col === nCol && p.row === nRow)) break;
      col = nCol;
      row = nRow;
      moved++;
    }
    if (moved === 0) return false;

    bomb.slideTo(col, row, this.time.now, moved);
    return true;
  }

  /**
   * 残り時間の表示用文字列。「制限時間なし」(timeLimitMs=Infinity)なら∞と表示する。
   * this.battleSystemがまだ用意されていない(生成順序の事故など)場合に備え、
   * 例外を投げず'-'を返すだけにしてある(このメソッドはHUD更新のたびに
   * 呼ばれるため、ここで例外が出ると対戦開始そのものが固まってしまう)。
   */
  _formatRemainingTime() {
    if (!this.battleSystem) return '-';
    if (!Number.isFinite(this.battleSystem.timeLimitMs)) return '∞';
    const remainingMs = Math.max(0, this.battleSystem.timeLimitMs - this.battleSystem.elapsedMs);
    return `${Math.ceil(remainingMs / 1000)}s`;
  }

  /**
   * 全体の状況(生存人数・残り時間)をステージ左上に、各プレイヤーの
   * 詳細(残機・爆弾・爆風・所持効果・順位)は右側パネルの各カードに表示する。
   * 「各プレイヤーの情報や自分の情報を表示させてほしい」という要望に対応し、
   * 人間・AI問わず全プレイヤーぶんのカードを毎フレーム更新する。
   */
  _updateHud() {
    const alive = this.players?.filter((p) => p.isAlive).length ?? 0;
    const remainingLabel = this._formatRemainingTime();
    this.hudText?.setText(`生存: ${alive}/${this.players?.length ?? 0}   残り時間: ${remainingLabel}`);

    for (const player of this.players ?? []) {
      const card = this._playerCards?.get(player.playerId);
      if (card) this._refreshPlayerCard(card, player);
    }
  }

  /** 1枚のプレイヤーカードの表示内容(残機・爆弾・所持効果・生死)を最新のPlayer状態に合わせて更新する */
  _refreshPlayerCard(card, player) {
    if (!player.isAlive) {
      card.statusText.setText('撃破されました');
      card.nameText.setAlpha(0.45);
      card.statusText.setAlpha(0.45);
      card.iconBg.setAlpha(0.35);
      card.iconImage?.setAlpha(0.35);
      return;
    }
    card.nameText.setAlpha(1);
    card.statusText.setAlpha(1);
    card.iconBg.setAlpha(1);
    card.iconImage?.setAlpha(1);

    const badges = [];
    if (player.speedMultiplier > 1) badges.push('👟');
    if (player.canPassSoftBlock) badges.push('👻');
    if (player.canKickBombs) badges.push('💥');
    if (player.isInvincible) badges.push('🛡');
    // 「一人1回まで爆弾に当たっても大丈夫」の猶予をまだ持っているかどうかも
    // 各プレイヤーの情報として一覧できるようにする。
    if (player.hasBombGrace) badges.push('🛟');
    const badgeStr = badges.length ? ` ${badges.join('')}` : '';

    const liveRank = this.battleSystem?.getLiveRank ? this.battleSystem.getLiveRank(player) : null;
    card.statusText.setText(
      `❤️${player.lives}  💣${player.activeBombCount}/${player.maxBombs}  🔥${player.blastRange}${badgeStr}\n` +
        `面:${player.face}  順位:${liveRank ?? '-'}`
    );
  }
}
