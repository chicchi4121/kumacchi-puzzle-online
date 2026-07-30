/**
 * OnlineLobbyScene.js
 * ------------------------------------------------------------
 * オンライン対戦(Supabase Realtime)の部屋作成・参加を行う画面。
 *
 * ローカル対戦(LobbyScene.js、同一キーボードでのAI戦/ホットシートPVP)とは
 * 別の入口として、TitleScene.jsから「オンライン対戦」で遷移してくる。
 *
 * ・「部屋を作る」→ホストとして部屋(Realtimeチャンネル)を作成し、5文字の
 *   部屋コードを表示する。参加者(ゲスト)が増えるとリアルタイムに一覧へ
 *   反映される(presence)。AI人数・難易度・制限時間を選んで「対戦開始」を
 *   押すと、参加者全員に開始の合図を送ってGameSceneへ遷移する。
 * ・「部屋に参加する」→ホストから伝えられた部屋コードを入力して接続する。
 *   ホストが対戦を開始するまで待機し、合図を受け取ったら自動的にGameScene
 *   へ遷移する。
 * ・「オートマッチング」→部屋コードのやり取りなしに、固定の待合ロビー
 *   チャンネルへ参加するだけで自動的に他プレイヤーと組み合わせる
 *   (詳細は本ファイル後半のオートマッチング関連メソッド、および
 *   NetworkProtocol.js/GameConstants.jsのAUTO_MATCH_*関連コメント参照)。
 *
 * Supabase未設定(src/config/supabaseConfig.js)の場合はその旨を表示し、
 * ローカル対戦は従来通りプレイできる(開発ルール8と同じフォールバック設計)。
 * ------------------------------------------------------------
 */
import {
  SCENE_KEYS,
  MAX_PLAYERS,
  MAX_ONLINE_PLAYERS,
  AUTO_MATCH_LOBBY_CODE,
  AUTO_MATCH_WAIT_MS,
  AUTO_MATCH_LEADER_CONFIRM_DELAY_MS,
} from '../constants/GameConstants.js';
import { soundSystem } from '../systems/SoundSystem.js';
import { NetworkSystem } from '../systems/NetworkSystem.js';
import {
  buildStartGameMessage,
  presenceStateToParticipants,
  buildClientToPlayerId,
  normalizeRoomCode,
  pickAutoMatchGroup,
  isAutoMatchLeader,
  buildAutoMatchFoundMessage,
} from '../systems/NetworkProtocol.js';
import { DIFFICULTY_ORDER, DIFFICULTY_LABEL, TIME_LIMIT_OPTIONS_SEC } from './LobbyScene.js';
import { computeUIScale, scaledFontPx } from '../utils/ResponsiveUI.js';

export class OnlineLobbyScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.ONLINE_LOBBY });
  }

  init() {
    this.network = null;
    this.role = null; // 'host' | 'guest'
    this.settings = {
      aiCount: 1,
      difficultyIndex: DIFFICULTY_ORDER.indexOf('normal'),
      timeLimitIndex: TIME_LIMIT_OPTIONS_SEC.indexOf(180),
    };
    // 「マッチング時、最初にマッチングする人(=オートマッチングのリーダーに
    // なる人)が人数・制限時間・AI難易度を選べるようにしてほしい」という
    // 要望に対応した設定(_showAutoMatchSettings参照)。participantCountは
    // 「人間+AIの合計希望人数」で、実際に集まった人間の人数がこれに満たない
    // 場合は残りをAIで補充する(_becomeAutoMatchLeader参照)。
    this.autoMatchSettings = {
      participantCount: 4,
      difficultyIndex: DIFFICULTY_ORDER.indexOf('normal'),
      timeLimitIndex: TIME_LIMIT_OPTIONS_SEC.indexOf(180),
    };
  }

  async create() {
    const centerX = this.scale.width / 2;
    this._sceneActive = true;
    // 「スマホでもプレイできるように」への対応: スマホ(幅360〜430px前後)
    // では、これまで固定ピクセルオフセット(centerX±220等)で配置していた
    // ボタン・設定行のラベルや+/-ボタンが画面外に切れてしまっていた。
    // 画面の実サイズから縮小率を算出し、以降のボタン・設定行の配置
    // オフセット/フォントサイズに一律で乗算することで画面内に収める
    // (ResponsiveUI.computeUIScale参照。デスクトップの標準的な画面
    // サイズでは縮小率が1になり、従来の座標と完全に一致する)。
    this._uiScale = computeUIScale(this.scale.width, this.scale.height);

    this.add.text(centerX, 50 * this._uiScale, 'オンライン対戦', { fontSize: scaledFontPx(28, this._uiScale), color: '#ffffff' }).setOrigin(0.5);

    this.bodyContainer = this.add.container(0, 0);
    this._showChecking();

    const available = await NetworkSystem.isAvailable().catch(() => false);
    if (!this._sceneActive) return;
    if (!available) {
      this._showUnavailable();
      return;
    }
    this._showModeSelect();

    this.events.once('shutdown', () => {
      this._sceneActive = false;
      this._cleanupNetwork();
    });
  }

  _clearBody() {
    this.bodyContainer.removeAll(true);
  }

  _showChecking() {
    this._clearBody();
    const s = this._uiScale ?? 1;
    const text = this.add
      .text(this.scale.width / 2, 200 * s, 'Supabaseの接続状況を確認中...', { fontSize: scaledFontPx(16, s), color: '#cccccc' })
      .setOrigin(0.5);
    this.bodyContainer.add(text);
  }

  _showUnavailable() {
    this._clearBody();
    const centerX = this.scale.width / 2;
    const s = this._uiScale ?? 1;
    const lines = [
      'Supabaseが設定されていないため、オンライン対戦は利用できません。',
      '',
      'src/config/supabaseConfig.js に、あなたのSupabaseプロジェクトの',
      'Project URL と anon(publishable) key を設定してください。',
      '(supabase/schema.sql をSQL Editorで実行する手順もREADME.mdを参照)',
    ];
    const text = this.add
      .text(centerX, 200 * s, lines.join('\n'), { fontSize: scaledFontPx(15, s), color: '#ffcc66', align: 'center' })
      .setOrigin(0.5);
    const backText = this._createButton(centerX, 340 * s, 'タイトルに戻る', () => this.scene.start(SCENE_KEYS.TITLE));
    this.bodyContainer.add([text, backText]);
  }

  _showModeSelect() {
    this._clearBody();
    const centerX = this.scale.width / 2;
    const s = this._uiScale ?? 1;
    // 「オートマッチングで探してる相手に入る方の項目も作ってほしい」への
    // 対応: 従来はオートマッチングのボタンを押すと必ず希望人数・難易度・
    // 制限時間を選ぶ設定画面(条件を決めて探す側)に進んでいたが、既に
    // 誰かが探している対戦にそのまま参加したいだけの人にとっては、この
    // 設定画面は不要な手間になる。オートマッチング配下に「検索する」と
    // 「参加する」を分けたサブメニュー(_showAutoMatchEntry)を用意した。
    const autoMatchBtn = this._createButton(centerX, 160 * s, 'オートマッチング(自動で対戦相手を探す)', () => this._showAutoMatchEntry());
    const createBtn = this._createButton(centerX, 225 * s, '部屋を作る(ホスト)', () => this._createRoom());
    const joinBtn = this._createButton(centerX, 290 * s, '部屋に参加する(コード入力)', () => this._promptJoinRoom());
    const backBtn = this._createButton(centerX, 375 * s, 'タイトルに戻る', () => this.scene.start(SCENE_KEYS.TITLE));
    this.bodyContainer.add([autoMatchBtn, createBtn, joinBtn, backBtn]);
  }

  /**
   * オートマッチングのサブメニュー。「検索する(自分で希望人数・難易度・
   * 制限時間を決めて対戦相手を探す側)」と「参加する(誰かが既に探している
   * 対戦にそのまま入る側)」を分けて表示する。
   *
   * 実際の待合ロビー(_startAutoMatch以降)の仕組みは両者で全く同じ
   * (固定の待合ロビーチャンネルへ参加するだけで、参加が一番早い人が
   * 自動的にリーダー=対戦部屋の作成役になる)。「参加する」を選んだ人は
   * 単に自分の希望条件を設定する手間を省いて即座に待合ロビーへ加わる
   * だけで、そのまま既存の参加者と合流する(もし自分が結果的にリーダーに
   * なった場合は、このシーンのデフォルト設定=this.autoMatchSettingsの
   * 初期値がそのまま使われる)。
   */
  _showAutoMatchEntry() {
    this._clearBody();
    const centerX = this.scale.width / 2;
    const s = this._uiScale ?? 1;
    // 「オートマッチング設定の文字が文字化けしている」への対応の一環として、
    // このヒント文にもwordWrapを付ける(狭い画面で折り返さず画面外まで伸びて
    // 表示が崩れるのを防ぐ)。
    const wrapWidth = Math.max(220, this.scale.width * 0.85);
    const titleY = 100 * s;
    this.add.text(centerX, titleY, 'オートマッチング', { fontSize: scaledFontPx(18, s), color: '#ffffff' }).setOrigin(0.5);
    const hintY = 135 * s;
    const hintLabel = this.add
      .text(centerX, hintY, '自分で条件を決めて探すか、既に探している相手にそのまま参加するか選べます', {
        fontSize: scaledFontPx(12, s),
        color: '#aaaaaa',
        align: 'center',
        wordWrap: { width: wrapWidth },
      })
      .setOrigin(0.5);

    // ヒント文が折り返して複数行になった場合でもボタンと重ならないよう、
    // 固定オフセットではなくヒント文の実測の高さ(hintLabel.height。wordWrap
    // 込みの実測値)を基準にボタン位置を決める。テスト環境(fake Phaser)では
    // heightが未定義になるため、その場合は十分に余裕を持たせた既定値に
    // フォールバックする。
    const hintBottom = hintY + (hintLabel.height || 40 * s) / 2;
    const btnGap = 55 * s;
    const searchBtnY = hintBottom + 30 * s;
    const joinBtnY = searchBtnY + btnGap;
    const backBtnY = joinBtnY + btnGap;

    const searchBtn = this._createButton(centerX, searchBtnY, '検索する(人数・難易度・制限時間を決めて探す)', () => this._showAutoMatchSettings());
    const joinBtn = this._createButton(centerX, joinBtnY, '参加する(今探している相手にそのまま入る)', () => this._startAutoMatch());
    const backBtn = this._createButton(centerX, backBtnY, '戻る', () => this._showModeSelect());

    this.bodyContainer.add([hintLabel, searchBtn, joinBtn, backBtn]);
  }

  // ---- オートマッチング -----------------------------------------------------
  // 部屋コードのやり取りなしに、固定の待合ロビーチャンネルへ全員が参加し、
  // 参加が一番早い人が実際の対戦部屋を作成して他の参加者を招き入れる方式
  // (詳細はNetworkProtocol.jsのオートマッチング関連関数のコメント、および
  // GameConstants.jsのAUTO_MATCH_*設定のコメントを参照)。

  /**
   * オートマッチングを開始する前に、希望人数・AI難易度・制限時間を選べる
   * 設定画面を表示する。「最初にマッチングする人(=待合ロビーに一番早く
   * 参加する人)が人数選択・制限時間設定・AI難易度設定をできるようにして
   * ほしい」という要望への対応。実際の待合ロビーの参加順で「リーダー」に
   * 選ばれた1人の設定だけが実際のマッチ設定として採用される
   * (_becomeAutoMatchLeader参照。他の参加者がここで選んだ設定は、その人が
   * リーダーにならなかった場合は使われない)。
   */
  _showAutoMatchSettings() {
    this._clearBody();
    const centerX = this.scale.width / 2;
    const s = this._uiScale ?? 1;
    // 「オートマッチング設定の文字が文字化けしている」への対応:
    // このヒント文はwordWrapを指定していなかったため、狭い画面では
    // 1行のまま画面外まで伸びて表示が崩れ、文字化けしたように見えて
    // いた。wordWrapで画面幅に収まるよう折り返すようにする。
    const wrapWidth = Math.max(220, this.scale.width * 0.85);
    const titleY = 100 * s;
    this.add.text(centerX, titleY, 'オートマッチング設定', { fontSize: scaledFontPx(18, s), color: '#ffffff' }).setOrigin(0.5);
    const hintY = 132 * s;
    const hintLabel = this.add
      .text(
        centerX,
        hintY,
        'ここで選んだ内容は、あなたが対戦部屋を作る役(先着順)になった場合に使われます。\n(集まった人数が希望人数に足りない場合、不足分はAIで補充されます)',
        {
          fontSize: scaledFontPx(12, s),
          color: '#aaaaaa',
          align: 'center',
          wordWrap: { width: wrapWidth },
        }
      )
      .setOrigin(0.5);

    // ヒント文は狭い画面では折り返して行数が増える(最大4行程度)ため、
    // 固定オフセットのままだと画面幅によっては次の希望人数の行と重なって
    // しまう。固定値ではなくヒント文の実測の高さ(hintLabel.height。wordWrap
    // 込みの実測値)を基準に、以降の行の位置を動的に決める。テスト環境
    // (fake Phaser)ではheightが未定義になるため、その場合は行数が最大に
    // なった場合でも重ならない程度の既定値にフォールバックする。
    const hintBottom = hintY + (hintLabel.height || 56 * s) / 2;
    const rowGap = 42 * s;

    // 「オートマッチングの参加人数設定の人数を選ぶ項目の文字が大きすぎて
    // 見えなくなっている」への対応: 従来は値の表示に"4人(不足分はAIで
    // 補充)"のような長い文字列を使っており、+/-ボタンの間の限られた幅に
    // 収まらず文字がボタンと重なって読めなくなっていた。値表示は短い
    // "4人"のみにし、AI補充についての説明は上のヒント文に移した。
    const participantY = hintBottom + rowGap;
    const participantRow = this._createStepperRow(
      centerX,
      participantY,
      '希望人数',
      () => `${this.autoMatchSettings.participantCount}人`,
      {
        onDecrease: () => {
          this.autoMatchSettings.participantCount = Math.max(2, this.autoMatchSettings.participantCount - 1);
        },
        onIncrease: () => {
          this.autoMatchSettings.participantCount = Math.min(MAX_ONLINE_PLAYERS, this.autoMatchSettings.participantCount + 1);
        },
      }
    );

    const difficultyY = participantY + rowGap;
    const difficultyRow = this._createStepperRow(
      centerX,
      difficultyY,
      'AI難易度',
      () => DIFFICULTY_LABEL[DIFFICULTY_ORDER[this.autoMatchSettings.difficultyIndex]],
      {
        onDecrease: () => {
          this.autoMatchSettings.difficultyIndex = Math.max(0, this.autoMatchSettings.difficultyIndex - 1);
        },
        onIncrease: () => {
          this.autoMatchSettings.difficultyIndex = Math.min(DIFFICULTY_ORDER.length - 1, this.autoMatchSettings.difficultyIndex + 1);
        },
      }
    );

    const timeLimitY = difficultyY + rowGap;
    const timeLimitRow = this._createStepperRow(
      centerX,
      timeLimitY,
      '制限時間',
      () =>
        TIME_LIMIT_OPTIONS_SEC[this.autoMatchSettings.timeLimitIndex] === null
          ? '制限時間なし'
          : `${TIME_LIMIT_OPTIONS_SEC[this.autoMatchSettings.timeLimitIndex]}秒`,
      {
        onDecrease: () => {
          this.autoMatchSettings.timeLimitIndex = Math.max(0, this.autoMatchSettings.timeLimitIndex - 1);
        },
        onIncrease: () => {
          this.autoMatchSettings.timeLimitIndex = Math.min(TIME_LIMIT_OPTIONS_SEC.length - 1, this.autoMatchSettings.timeLimitIndex + 1);
        },
      }
    );

    const searchBtnY = timeLimitY + rowGap + 15 * s;
    const backBtnY = searchBtnY + 50 * s;
    const searchBtn = this._createButton(centerX, searchBtnY, '検索開始', () => this._startAutoMatch());
    const backBtn = this._createButton(centerX, backBtnY, '戻る', () => this._showAutoMatchEntry());

    this.bodyContainer.add([
      hintLabel,
      participantRow.label,
      participantRow.valueText,
      participantRow.minusBtn,
      participantRow.plusBtn,
      difficultyRow.label,
      difficultyRow.valueText,
      difficultyRow.minusBtn,
      difficultyRow.plusBtn,
      timeLimitRow.label,
      timeLimitRow.valueText,
      timeLimitRow.minusBtn,
      timeLimitRow.plusBtn,
      searchBtn,
      backBtn,
    ]);
  }

  async _startAutoMatch() {
    this._clearBody();
    const centerX = this.scale.width / 2;
    const s = this._uiScale ?? 1;
    this._autoMatchStatusText = this.add
      .text(centerX, 180 * s, 'オートマッチング中...\n他のプレイヤーを探しています', { fontSize: scaledFontPx(16, s), color: '#cccccc', align: 'center' })
      .setOrigin(0.5);
    const cancelBtn = this._createButton(centerX, 260 * s, 'キャンセル', () => this._cancelAutoMatch());
    this.bodyContainer.add([this._autoMatchStatusText, cancelBtn]);

    this._autoMatchResolved = false;
    this._autoMatchNetwork = new NetworkSystem();
    try {
      await this._autoMatchNetwork.joinRoom(AUTO_MATCH_LOBBY_CODE);
    } catch (e) {
      console.error('[OnlineLobbyScene] オートマッチングの待合ロビーへの接続に失敗しました。', e);
      if (this._sceneActive) this._autoMatchStatusText?.setText(`オートマッチングに失敗しました: ${e.message ?? e}`);
      return;
    }
    if (!this._sceneActive || this._autoMatchResolved) return;

    this._autoMatchJoinedAt = Date.now();
    this._offAutoMatchMessage = this._autoMatchNetwork.onMessage((msg) => {
      if (msg?.type === 'auto_match_found') this._onAutoMatchFound(msg);
    });
    this._offAutoMatchPresence = this._autoMatchNetwork.onPresenceChange(() => {
      this._refreshAutoMatchStatus();
      this._checkAutoMatchLeader(false);
    });
    this._autoMatchTimeoutEvent = this.time.delayedCall(AUTO_MATCH_WAIT_MS, () => this._checkAutoMatchLeader(true));
    this._refreshAutoMatchStatus();
    this._checkAutoMatchLeader(false);
  }

  _refreshAutoMatchStatus() {
    if (!this._autoMatchStatusText || !this._autoMatchNetwork) return;
    const count = presenceStateToParticipants(this._autoMatchNetwork.getPresenceState()).length || 1;
    this._autoMatchStatusText.setText(
      `オートマッチング中...(現在${count}人待機中/希望${this.autoMatchSettings.participantCount}人)\n他のプレイヤーが参加するのを待っています`
    );
  }

  /**
   * マッチ成立条件(希望人数に達した、または待機時間切れ)を満たしていれば、
   * 自分がリーダー(グループの先頭=参加が一番早い人)かどうかを確認し、
   * リーダーであれば実際の対戦部屋を作成する。
   *
   * 「希望人数」は_showAutoMatchSettingsで自分が選んだ値(this.
   * autoMatchSettings.participantCount)を使う。自分がリーダーになった
   * 場合だけこの値が実際に使われる(自分がリーダーでなければ
   * isAutoMatchLeaderでfalseになりそのまま何もしない)ため、他の参加者の
   * 希望人数設定と食い違っていても問題ない。
   * @param {boolean} timeoutReached - 待機時間切れによる呼び出しか
   */
  _checkAutoMatchLeader(timeoutReached) {
    if (this._autoMatchResolved || !this._autoMatchNetwork) return;
    const participants = presenceStateToParticipants(this._autoMatchNetwork.getPresenceState());
    if (participants.length === 0) return;
    const desiredCount = this.autoMatchSettings.participantCount;
    const group = pickAutoMatchGroup(participants, desiredCount);
    const isFull = group.length >= desiredCount;
    const elapsed = Date.now() - (this._autoMatchJoinedAt ?? Date.now());
    const waitedEnough = timeoutReached || elapsed >= AUTO_MATCH_WAIT_MS;
    // 希望人数に達していれば即座に、そうでなければ待機時間が切れるまでは
    // 何もしない(待機時間切れの時点で人数が足りない場合は
    // _becomeAutoMatchLeader()側でAIを補充して対戦を成立させる)。
    if (!isFull && !waitedEnough) return;
    if (!isAutoMatchLeader(participants, this._autoMatchNetwork.clientId, desiredCount)) return;
    this._becomeAutoMatchLeader(group);
  }

  async _becomeAutoMatchLeader(group) {
    if (this._autoMatchResolved) return;
    this._autoMatchResolved = true; // 先に確定させ、presence再同期による重複実行を防ぐ

    // 複数クライアントがほぼ同時にリーダーだと判断してしまう競合を減らすため、
    // 少し待ってから改めて「まだ誰もマッチを成立させていないか」を確認する。
    await new Promise((resolve) => this.time.delayedCall(AUTO_MATCH_LEADER_CONFIRM_DELAY_MS, resolve));
    if (!this._sceneActive || this._handedOffToGame) return;

    // 「最初にマッチングする人(=リーダーになった自分)が人数選択・制限時間・
    // AI難易度を選べるようにしてほしい」への対応: 自分がこの画面で選んだ
    // 希望人数に対して、実際に集まった人間の人数が足りない分だけAIで補充する。
    const humanCount = Math.max(1, group.length);
    const desiredTotal = Math.max(humanCount, Math.min(MAX_PLAYERS, this.autoMatchSettings.participantCount));
    const aiCount = Math.max(0, desiredTotal - humanCount);
    const aiDifficulty = DIFFICULTY_ORDER[this.autoMatchSettings.difficultyIndex];
    const timeLimitSec = TIME_LIMIT_OPTIONS_SEC[this.autoMatchSettings.timeLimitIndex];
    const timeLimitMs = timeLimitSec === null ? Infinity : timeLimitSec * 1000;

    let gameNetwork;
    let roomCode;
    try {
      gameNetwork = new NetworkSystem();
      roomCode = await gameNetwork.createRoom();
    } catch (e) {
      console.error('[OnlineLobbyScene] オートマッチングでの対戦部屋作成に失敗しました。', e);
      if (this._sceneActive) this._autoMatchStatusText?.setText(`オートマッチングに失敗しました: ${e.message ?? e}`);
      return;
    }
    if (!this._sceneActive) return;

    const clientToPlayerId = buildClientToPlayerId(group.map((p, i) => ({ ...p, isHost: i === 0 })));
    const matchedClientIds = group.map((p) => p.clientId);
    const matchConfig = { humanCount, aiCount, aiDifficulty, timeLimitMs, clientToPlayerId };
    this._autoMatchNetwork.send(buildAutoMatchFoundMessage(roomCode, matchedClientIds, matchConfig));

    this._teardownAutoMatchLobby();
    await this._autoMatchNetwork?.disconnect();

    this._handedOffToGame = true;
    this.network = gameNetwork;
    this.scene.start(SCENE_KEYS.GAME, {
      mode: 'online',
      playerCount: humanCount + aiCount,
      humanCount,
      aiCount,
      aiDifficulty,
      timeLimitMs,
      online: { network: gameNetwork, role: 'host', roomCode, clientToPlayerId },
    });
  }

  _onAutoMatchFound(msg) {
    if (this._autoMatchResolved) return;
    if (!msg?.matchedClientIds?.includes(this._autoMatchNetwork?.clientId)) return; // 今回は含まれない -> 次回のマッチングを待つ
    this._autoMatchResolved = true;
    this._joinAutoMatchedRoom(msg);
  }

  async _joinAutoMatchedRoom(msg) {
    this._teardownAutoMatchLobby();
    await this._autoMatchNetwork?.disconnect();
    if (!this._sceneActive) return;

    let gameNetwork;
    try {
      gameNetwork = new NetworkSystem();
      await gameNetwork.joinRoom(msg.roomCode);
    } catch (e) {
      console.error('[OnlineLobbyScene] オートマッチング先の部屋への接続に失敗しました。', e);
      if (this._sceneActive) this._autoMatchStatusText?.setText(`接続に失敗しました: ${e.message ?? e}`);
      return;
    }
    if (!this._sceneActive) return;

    this._handedOffToGame = true;
    this.scene.start(SCENE_KEYS.GAME, {
      mode: 'online',
      playerCount: msg.config.humanCount,
      humanCount: msg.config.humanCount,
      aiCount: msg.config.aiCount,
      aiDifficulty: msg.config.aiDifficulty,
      timeLimitMs: msg.config.timeLimitMs,
      online: { network: gameNetwork, role: 'guest', roomCode: msg.roomCode },
    });
  }

  _teardownAutoMatchLobby() {
    this._offAutoMatchMessage?.();
    this._offAutoMatchPresence?.();
    this._autoMatchTimeoutEvent?.remove(false);
    this._offAutoMatchMessage = null;
    this._offAutoMatchPresence = null;
    this._autoMatchTimeoutEvent = null;
  }

  _cancelAutoMatch() {
    this._autoMatchResolved = true;
    this._teardownAutoMatchLobby();
    this._autoMatchNetwork?.disconnect();
    this._autoMatchNetwork = null;
    this._showModeSelect();
  }

  // ---- ホスト: 部屋作成 ----------------------------------------------------

  async _createRoom() {
    this._clearBody();
    const centerX = this.scale.width / 2;
    const s = this._uiScale ?? 1;
    const statusText = this.add.text(centerX, 150 * s, '部屋を作成中...', { fontSize: scaledFontPx(16, s), color: '#cccccc' }).setOrigin(0.5);
    this.bodyContainer.add(statusText);

    try {
      this.network = new NetworkSystem();
      const roomCode = await this.network.createRoom();
      this.role = 'host';
      if (!this._sceneActive) return;
      this._showHostRoom(roomCode);
    } catch (e) {
      console.error('[OnlineLobbyScene] 部屋の作成に失敗しました。', e);
      statusText.setText(`部屋の作成に失敗しました: ${e.message ?? e}`);
    }
  }

  _showHostRoom(roomCode) {
    this._clearBody();
    const centerX = this.scale.width / 2;
    const s = this._uiScale ?? 1;

    const codeLabel = this.add
      .text(centerX, 110 * s, `部屋コード: ${roomCode}`, { fontSize: scaledFontPx(26, s), color: '#ffe066' })
      .setOrigin(0.5);
    const hintLabel = this.add
      .text(centerX, 145 * s, 'このコードを対戦相手に伝えてください', { fontSize: scaledFontPx(13, s), color: '#aaaaaa' })
      .setOrigin(0.5);

    this.participantsText = this.add
      .text(centerX, 190 * s, '', { fontSize: scaledFontPx(14, s), color: '#ffffff', align: 'center' })
      .setOrigin(0.5, 0);

    const aiRow = this._createStepperRow(
      centerX,
      270 * s,
      'AI追加人数',
      () => `${this.settings.aiCount}人`,
      {
        onDecrease: () => {
          this.settings.aiCount = Math.max(0, this.settings.aiCount - 1);
        },
        onIncrease: () => {
          const maxAi = Math.max(0, MAX_PLAYERS - this._humanCount());
          this.settings.aiCount = Math.min(maxAi, this.settings.aiCount + 1);
        },
      }
    );

    const difficultyRow = this._createStepperRow(
      centerX,
      315 * s,
      'AI難易度',
      () => DIFFICULTY_LABEL[DIFFICULTY_ORDER[this.settings.difficultyIndex]],
      {
        onDecrease: () => {
          this.settings.difficultyIndex = Math.max(0, this.settings.difficultyIndex - 1);
        },
        onIncrease: () => {
          this.settings.difficultyIndex = Math.min(DIFFICULTY_ORDER.length - 1, this.settings.difficultyIndex + 1);
        },
      }
    );

    const timeLimitRow = this._createStepperRow(
      centerX,
      360 * s,
      '制限時間',
      () =>
        TIME_LIMIT_OPTIONS_SEC[this.settings.timeLimitIndex] === null
          ? '制限時間なし'
          : `${TIME_LIMIT_OPTIONS_SEC[this.settings.timeLimitIndex]}秒`,
      {
        onDecrease: () => {
          this.settings.timeLimitIndex = Math.max(0, this.settings.timeLimitIndex - 1);
        },
        onIncrease: () => {
          this.settings.timeLimitIndex = Math.min(TIME_LIMIT_OPTIONS_SEC.length - 1, this.settings.timeLimitIndex + 1);
        },
      }
    );

    const startBtn = this._createButton(centerX, 420 * s, '対戦開始', () => this._startAsHost());
    const backBtn = this._createButton(centerX, 470 * s, 'やめる', () => this.scene.start(SCENE_KEYS.TITLE));

    this.bodyContainer.add([
      codeLabel,
      hintLabel,
      this.participantsText,
      aiRow.label,
      aiRow.valueText,
      aiRow.minusBtn,
      aiRow.plusBtn,
      difficultyRow.label,
      difficultyRow.valueText,
      difficultyRow.minusBtn,
      difficultyRow.plusBtn,
      timeLimitRow.label,
      timeLimitRow.valueText,
      timeLimitRow.minusBtn,
      timeLimitRow.plusBtn,
      startBtn,
      backBtn,
    ]);

    this._offPresence = this.network.onPresenceChange(() => this._refreshParticipants());
    this._refreshParticipants();
  }

  _humanCount() {
    return presenceStateToParticipants(this.network?.getPresenceState() ?? {}).length || 1;
  }

  _refreshParticipants() {
    const participants = presenceStateToParticipants(this.network.getPresenceState());
    const count = Math.max(1, participants.length);
    const maxAi = Math.max(0, MAX_PLAYERS - count);
    this.settings.aiCount = Math.min(this.settings.aiCount, maxAi);
    const label = participants
      .map((p, i) => (p.isHost ? `P${i + 1}(ホスト・あなた)` : `P${i + 1}`))
      .join(' / ');
    this.participantsText?.setText(`参加者(${count}/${MAX_ONLINE_PLAYERS}人): ${label || '(取得中...)'}`);
  }

  async _startAsHost() {
    const participants = presenceStateToParticipants(this.network.getPresenceState());
    const humanCount = Math.max(1, Math.min(MAX_ONLINE_PLAYERS, participants.length || 1));
    const aiCount = Math.max(0, Math.min(MAX_PLAYERS - humanCount, this.settings.aiCount));
    const clientToPlayerId = buildClientToPlayerId(participants.length ? participants : [{ clientId: this.network.clientId, isHost: true, joinedAt: 0 }]);
    const timeLimitSec = TIME_LIMIT_OPTIONS_SEC[this.settings.timeLimitIndex];

    const matchConfig = {
      humanCount,
      aiCount,
      aiDifficulty: DIFFICULTY_ORDER[this.settings.difficultyIndex],
      timeLimitMs: timeLimitSec === null ? Infinity : timeLimitSec * 1000,
      clientToPlayerId,
    };

    soundSystem.playSE('button');
    this.network.send(buildStartGameMessage(matchConfig));
    this._offPresence?.();
    this._handedOffToGame = true;
    this.scene.start(SCENE_KEYS.GAME, {
      mode: 'online',
      playerCount: matchConfig.humanCount,
      humanCount: matchConfig.humanCount,
      aiCount: matchConfig.aiCount,
      aiDifficulty: matchConfig.aiDifficulty,
      timeLimitMs: matchConfig.timeLimitMs,
      online: { network: this.network, role: 'host', roomCode: this.network.roomCode, clientToPlayerId },
    });
  }

  // ---- ゲスト: 部屋参加 -----------------------------------------------------

  _promptJoinRoom() {
    const input = window.prompt('ホストから伝えられた部屋コードを入力してください');
    if (!input) return;
    this._joinRoom(normalizeRoomCode(input));
  }

  async _joinRoom(roomCode) {
    this._clearBody();
    const centerX = this.scale.width / 2;
    const s = this._uiScale ?? 1;
    const statusText = this.add
      .text(centerX, 200 * s, `部屋(${roomCode})に接続中...`, { fontSize: scaledFontPx(16, s), color: '#cccccc' })
      .setOrigin(0.5);
    this.bodyContainer.add(statusText);

    try {
      this.network = new NetworkSystem();
      await this.network.joinRoom(roomCode);
      this.role = 'guest';
      if (!this._sceneActive) return;
      statusText.setText(`部屋(${roomCode})に接続しました。\nホストが対戦を開始するのを待っています...`);
      this._offGuestMessage = this.network.onMessage((msg) => {
        if (msg?.type === 'start_game') this._onHostStartedGame(msg);
      });
      const backBtn = this._createButton(centerX, 300 * s, 'やめる', () => this.scene.start(SCENE_KEYS.TITLE));
      this.bodyContainer.add(backBtn);
    } catch (e) {
      console.error('[OnlineLobbyScene] 部屋への接続に失敗しました。', e);
      statusText.setText(`接続に失敗しました。部屋コードをご確認ください。\n(${e.message ?? e})`);
      const backBtn = this._createButton(centerX, 300 * s, 'タイトルに戻る', () => this.scene.start(SCENE_KEYS.TITLE));
      this.bodyContainer.add(backBtn);
    }
  }

  _onHostStartedGame(msg) {
    this._offGuestMessage?.();
    this._handedOffToGame = true;
    this.scene.start(SCENE_KEYS.GAME, {
      mode: 'online',
      playerCount: msg.humanCount,
      humanCount: msg.humanCount,
      aiCount: msg.aiCount,
      aiDifficulty: msg.aiDifficulty,
      timeLimitMs: msg.timeLimitMs,
      online: { network: this.network, role: 'guest', roomCode: this.network.roomCode },
    });
  }

  // ---- 共通UI部品 -----------------------------------------------------------

  _createButton(x, y, label, onClick) {
    const s = this._uiScale ?? 1;
    const text = this.add
      .text(x, y, label, {
        fontSize: scaledFontPx(20, s),
        color: '#ffffff',
        backgroundColor: '#3a3a3a',
        padding: { x: Math.round(16 * s), y: Math.round(8 * s) },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    text.on('pointerover', () => text.setStyle({ backgroundColor: '#55606e' }));
    text.on('pointerout', () => text.setStyle({ backgroundColor: '#3a3a3a' }));
    text.on('pointerdown', () => {
      soundSystem.playSE('button');
      onClick();
    });
    return text;
  }

  /**
   * ラベル・現在値・+-ボタンからなる1行の設定項目を作成する。
   * 「スマホでもプレイできるように」への対応: 従来はx±220px等の固定
   * オフセットで、幅の狭いスマホ画面(360〜430px前後)ではラベルや+/-
   * ボタンが画面外に切れてしまっていた。this._uiScale(画面の実サイズ
   * から算出した縮小率、ResponsiveUI.computeUIScale参照)を全オフセット
   * に一律で乗算することで、狭い画面では行全体が縮小されて画面内に
   * 収まるようにする。
   */
  _createStepperRow(x, y, labelText, getValueLabel, { onDecrease, onIncrease }) {
    const s = this._uiScale ?? 1;
    const label = this.add.text(x - 220 * s, y, labelText, { fontSize: scaledFontPx(16, s), color: '#ffffff' }).setOrigin(0, 0.5);
    const valueText = this.add.text(x + 30 * s, y, getValueLabel(), { fontSize: scaledFontPx(16, s), color: '#ffe066' }).setOrigin(0.5);
    const refresh = () => valueText.setText(getValueLabel());

    const minusBtn = this._createStepperButton(x - 60 * s, y, '-', () => {
      onDecrease();
      refresh();
    });
    const plusBtn = this._createStepperButton(x + 150 * s, y, '+', () => {
      onIncrease();
      refresh();
    });

    return { label, valueText, minusBtn, plusBtn, refresh };
  }

  _createStepperButton(x, y, label, onClick) {
    const s = this._uiScale ?? 1;
    const btn = this.add
      .text(x, y, label, {
        fontSize: scaledFontPx(18, s),
        color: '#ffffff',
        backgroundColor: '#3a3a3a',
        padding: { x: Math.round(10 * s), y: Math.round(2 * s) },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => {
      soundSystem.playSE('button');
      onClick();
    });
    return btn;
  }

  _cleanupNetwork() {
    // オートマッチングの待合ロビー接続は、GameSceneへ引き継がれる対戦部屋
    // (gameNetwork)とは別物なので、ゲームへ遷移したかどうかに関わらず
    // 常にここで後片付けする(遷移が完了していれば既に切断済みで無害)。
    this._teardownAutoMatchLobby();
    this._autoMatchNetwork?.disconnect();
    // GameSceneへ遷移した場合(_handedOffToGame)は対戦部屋のnetworkをそのまま
    // 使い続けるため切断しない(GameScene側がライフサイクルを引き継ぐ)。
    // ロビー画面を離れて対戦を開始しなかった場合(タイトルに戻る等)のみ
    // ここで破棄する。
    if (this._handedOffToGame) return;
    this.network?.disconnect();
  }
}
