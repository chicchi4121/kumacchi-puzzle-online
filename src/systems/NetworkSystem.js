/**
 * NetworkSystem.js
 * ------------------------------------------------------------
 * オンライン対戦(Supabase Realtime)の接続・部屋の作成/参加・
 * メッセージの送受信を担当するシステム。
 *
 * 実際のゲームロジック(マップ生成・移動判定・爆弾・勝敗判定等)は
 * 一切ここに書かない。本クラスは「部屋(Realtimeチャンネル)への接続」
 * 「誰が参加しているか(presence)」「メッセージの送受信」という
 * トランスポート層のみを担当し、メッセージの中身の意味づけ・組み立ては
 * NetworkProtocol.js(純粋関数・Node上でテスト済み)に委譲する。
 * この責務分離により、Supabaseへの実接続が試せないこのサンドボックス
 * 環境でも、プロトコル部分は完全にテストできている。
 *
 * ---- 用語 ----
 * ・ホスト: 部屋を作った側。ゲームロジック全体を実行する権威。
 * ・ゲスト: 部屋に参加した側。ホストの状態を描画するだけ。
 * ・部屋コード: 5文字の短いコード。相手に伝えて`joinRoom()`してもらう。
 * ------------------------------------------------------------
 */
import { getSupabaseClient } from './SupabaseClient.js';
import { generateRoomCode, normalizeRoomCode } from './NetworkProtocol.js';

function makeClientId() {
  return `c${Math.random().toString(36).slice(2, 10)}`;
}

export class NetworkSystem {
  constructor() {
    this.client = null;
    this.channel = null;
    this.roomCode = null;
    this.isHost = false;
    this.connected = false;
    this.clientId = makeClientId();
    this._messageHandlers = new Set();
    this._presenceHandlers = new Set();
  }

  /** Supabaseが設定されているか(supabaseConfig.js参照)。UIの活性/非活性判定に使う */
  static async isAvailable() {
    const client = await getSupabaseClient().catch(() => null);
    return !!client;
  }

  /** 部屋を新規作成し、ホストとして接続する。成功した場合は部屋コードを返す */
  async createRoom() {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabaseが設定されていません(src/config/supabaseConfig.js)。');

    this.client = client;
    this.isHost = true;
    this.roomCode = generateRoomCode();
    await this._subscribe(this.roomCode);
    return this.roomCode;
  }

  /** 部屋コードを指定して参加者(ゲスト)として接続する */
  async joinRoom(code) {
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabaseが設定されていません(src/config/supabaseConfig.js)。');

    this.client = client;
    this.isHost = false;
    this.roomCode = normalizeRoomCode(code);
    await this._subscribe(this.roomCode);
    return this.roomCode;
  }

  async _subscribe(roomCode) {
    const channelName = `room:${roomCode}`;
    this.channel = this.client.channel(channelName, {
      config: { presence: { key: this.clientId } },
    });

    this.channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      for (const handler of this._messageHandlers) handler(payload);
    });

    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel.presenceState();
      for (const handler of this._presenceHandlers) handler(state);
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('接続がタイムアウトしました。')), 15000);
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          this.connected = true;
          await this.channel.track({ clientId: this.clientId, isHost: this.isHost, joinedAt: Date.now() });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout);
          reject(new Error(`Realtimeチャンネルへの接続に失敗しました(status=${status})。`));
        }
      });
    });
  }

  /** メッセージ受信ハンドラを登録する。戻り値の関数を呼ぶと解除できる */
  onMessage(handler) {
    this._messageHandlers.add(handler);
    return () => this._messageHandlers.delete(handler);
  }

  /** 参加者一覧(presence)が変化するたびに呼ばれるハンドラを登録する */
  onPresenceChange(handler) {
    this._presenceHandlers.add(handler);
    return () => this._presenceHandlers.delete(handler);
  }

  /** 現在の参加者一覧をpresenceState形式(key -> [{clientId,isHost,joinedAt}])で返す */
  getPresenceState() {
    return this.channel?.presenceState() ?? {};
  }

  /** メッセージを部屋の全員(自分を含む)へ送信する。NetworkProtocol.jsのbuild*関数で組み立てた値を渡す */
  send(message) {
    if (!this.channel) return;
    this.channel.send({ type: 'broadcast', event: 'msg', payload: message });
  }

  /** 接続を切って部屋から離脱する */
  async disconnect() {
    if (this.channel && this.client) {
      await this.client.removeChannel(this.channel);
    }
    this.channel = null;
    this.connected = false;
    this._messageHandlers.clear();
    this._presenceHandlers.clear();
  }
}
