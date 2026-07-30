/**
 * ResultScene.js
 * ------------------------------------------------------------
 * 対戦終了後のリザルト画面。
 * 順位・撃破数・爆破数・取得アイテム数・獲得経験値を実データで表示する。
 * 経験値計算式はEXP_PER_*定数（GameConstants.js）で一元管理している。
 *
 * RankingSystem経由でSupabaseへ対戦結果を送信する(Supabase未設定時は
 * この端末のローカル履歴にのみ保存される。RankingSystem.js参照)。
 * ------------------------------------------------------------
 */
import {
  SCENE_KEYS,
  EXP_PER_KILL,
  EXP_PER_BOMB_EXPLODED,
  EXP_PER_ITEM_COLLECTED,
  EXP_WIN_BONUS,
} from '../constants/GameConstants.js';
import { soundSystem } from '../systems/SoundSystem.js';
import { rankingSystem } from '../systems/RankingSystem.js';
import { Save } from '../utils/Save.js';
import { computeUIScale, scaledFontPx } from '../utils/ResponsiveUI.js';

export class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.RESULT });
  }

  init(data) {
    this.winnerPlayerId = data?.winner?.playerId ?? null;
    this.mode = data?.mode ?? 'ai';
    // PVP(人間2人以上)では勝敗判定・「あなた」表示の対象が複数人になりうるため配列で保持する。
    this.humanPlayerIds = data?.humanPlayerIds ?? (data?.humanPlayerId != null ? [data.humanPlayerId] : []);
    // ランキング(Supabase)へ実際に送信すべき対象。オンライン対戦では
    // 「このブラウザが操作していた自分の1人分」だけに絞る(GameScene参照。
    // humanPlayerIdsをそのまま使うと、ホスト・各ゲストが同じ試合の結果を
    // それぞれ独立に送信してしまい、参加者全員分が重複記録されてしまう)。
    this.rankingPlayerIds = data?.rankingPlayerIds ?? this.humanPlayerIds;
    this.players = data?.players ?? [];
    this.finalRanks = data?.finalRanks ?? {};
  }

  create() {
    // GameSceneはScale.RESIZEでブラウザの実サイズいっぱいに表示されるため
    // (main.js/GameScene.js参照)、固定のSCREEN_WIDTH/HEIGHTではなく、
    // その時点の実サイズ(this.scale.width/height)を基準に中央揃えする。
    const centerX = this.scale.width / 2;
    const screenHeight = this.scale.height;
    const isHumanWinner = this.winnerPlayerId !== null && this.humanPlayerIds.includes(this.winnerPlayerId);
    const isPvp = this.humanPlayerIds.length > 1;
    soundSystem.playSE(this.players.length > 0 ? (isHumanWinner ? 'victory' : 'defeat') : 'button');

    // 「スマホでもプレイできるように」への対応: リザルトテーブルは
    // centerX±260px前後の固定オフセットで列を並べていたため、スマホの
    // 狭い画面(360〜430px前後)では左端の列が画面外に切れてしまっていた。
    // 画面の実サイズから縮小率を算出し、列オフセット・フォントサイズに
    // 一律で乗算することで画面内に収める(ResponsiveUI.computeUIScale参照)。
    this._uiScale = computeUIScale(this.scale.width, this.scale.height);
    const s = this._uiScale;

    this.add.text(centerX, 50 * s, 'リザルト', { fontSize: scaledFontPx(32, s), color: '#ffffff' }).setOrigin(0.5);

    // PVPでは「あなた」という単一人称が成立しないため、勝者が人間なら
    // その旨だけを添える（例:「勝者: プレイヤー2（プレイヤー）」）。
    const winnerLabel = this.winnerPlayerId
      ? `勝者: プレイヤー${this.winnerPlayerId}${isHumanWinner ? (isPvp ? '（プレイヤー）' : '（あなた）') : ''}`
      : '引き分け';
    this.add.text(centerX, 95 * s, winnerLabel, { fontSize: scaledFontPx(22, s), color: '#ffe066' }).setOrigin(0.5);

    this._renderTable(centerX, 140 * s);

    this.rankingStatusText = this.add
      .text(centerX, screenHeight - 90 * s, 'ランキングに記録中...', {
        fontSize: scaledFontPx(14, s),
        color: '#888888',
      })
      .setOrigin(0.5);
    this._submitRankingResults();

    const backText = this.add
      .text(centerX, screenHeight - 40 * s, 'タイトルに戻る', {
        fontSize: scaledFontPx(20, s),
        color: '#ffffff',
        backgroundColor: '#3a3a3a',
        padding: { x: Math.round(12 * s), y: Math.round(6 * s) },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    backText.on('pointerdown', () => {
      soundSystem.playSE('button');
      soundSystem.stopBGM();
      this.scene.start(SCENE_KEYS.TITLE);
    });
  }

  /**
   * ランキングに、このブラウザが操作していた人間プレイヤーぶんの結果を
   * 送信する(rankingPlayerIds参照)。失敗してもゲーム進行には影響しない
   * (開発ルール8と同じ考え方。RankingSystem内部でローカル保存にも
   * フォールバックする)。
   */
  async _submitRankingResults() {
    if (!this.rankingPlayerIds || this.rankingPlayerIds.length === 0) {
      this.rankingStatusText?.setText('');
      return;
    }

    const baseName = Save.getPlayerName();
    // ローカルPVP(同一ブラウザで複数人)のみ、同じ名前が並ばないよう
    // 「(P2)」のように操作枠番号を付ける。オンライン対戦は各自別ブラウザ
    // なので付けない。
    const isLocalMultiHuman = this.mode !== 'online' && this.humanPlayerIds.length > 1;

    try {
      for (const playerId of this.rankingPlayerIds) {
        const player = this.players.find((p) => p.playerId === playerId);
        if (!player) continue;
        const rank = this.finalRanks[playerId] ?? this.finalRanks[String(playerId)] ?? null;
        const isWinner = playerId === this.winnerPlayerId;
        const exp = this._calcExp(player.stats, isWinner);
        const slotIndex = this.humanPlayerIds.indexOf(playerId);
        const playerName = isLocalMultiHuman && slotIndex >= 0 ? `${baseName}(P${slotIndex + 1})` : baseName;

        await rankingSystem.submitResult({
          playerName,
          mode: this.mode,
          rank,
          kills: player.stats.kills,
          bombsExploded: player.stats.bombsExploded,
          itemsCollected: player.stats.itemsCollected,
          exp,
          isHuman: true,
        });
      }
      this.rankingStatusText?.setText('ランキングに記録しました');
    } catch (e) {
      console.warn('[ResultScene] ランキングへの送信に失敗しました(ローカルには保存済みです)。', e);
      this.rankingStatusText?.setText('ランキング送信に失敗しました(ローカルには保存済み)');
    }
  }

  _calcExp(stats, isWinner) {
    return (
      stats.kills * EXP_PER_KILL +
      stats.bombsExploded * EXP_PER_BOMB_EXPLODED +
      stats.itemsCollected * EXP_PER_ITEM_COLLECTED +
      (isWinner ? EXP_WIN_BONUS : 0)
    );
  }

  _renderTable(centerX, startY) {
    const s = this._uiScale ?? 1;
    const rows = this.players
      .map((p) => ({
        ...p,
        rank: this.finalRanks[p.playerId] ?? this.finalRanks[String(p.playerId)] ?? '-',
        exp: this._calcExp(p.stats, p.playerId === this.winnerPlayerId),
      }))
      .sort((a, b) => (a.rank === '-' ? 99 : a.rank) - (b.rank === '-' ? 99 : b.rank));

    const header = ['順位', 'プレイヤー', '撃破', '爆破', 'アイテム', '経験値'];
    // 「スマホでもプレイできるように」への対応: 列オフセットにthis._uiScale
    // を乗算し、狭い画面では表全体を縮小して画面内に収める。
    const colX = [-260, -190, -60, 10, 80, 170].map((v) => v * s);

    header.forEach((label, i) => {
      this.add
        .text(centerX + colX[i], startY, label, { fontSize: scaledFontPx(14, s), color: '#aaaaaa' })
        .setOrigin(0, 0.5);
    });

    rows.forEach((row, i) => {
      const y = startY + (28 + i * 26) * s;
      const isHuman = this.humanPlayerIds.includes(row.playerId);
      const nameLabel = `プレイヤー${row.playerId}${row.isAI ? '(AI)' : ''}${isHuman ? ' ★' : ''}`;
      const color = isHuman ? '#ffe066' : '#ffffff';
      const values = [`${row.rank}位`, nameLabel, row.stats.kills, row.stats.bombsExploded, row.stats.itemsCollected, row.exp];

      values.forEach((value, colIdx) => {
        this.add
          .text(centerX + colX[colIdx], y, String(value), { fontSize: scaledFontPx(15, s), color })
          .setOrigin(0, 0.5);
      });
    });
  }
}
