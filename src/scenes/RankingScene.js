/**
 * RankingScene.js
 * ------------------------------------------------------------
 * 対戦結果ランキングを表示する画面。RankingSystem経由でSupabaseの
 * `rankings`テーブル(supabase/schema.sql参照)から取得する。
 * Supabase未設定・取得失敗時はこの端末のローカル対戦履歴を表示する
 * (RankingSystem.fetchRanking()側でフォールバック済み)。
 *
 * 表示順は勝利数(wins)の多い順(RankingSystem.fetchRanking()が
 * プレイヤー名ごとに対戦ログを集計して返す。同数の場合は参考として
 * 累計exp降順)。
 * ------------------------------------------------------------
 */
import { SCENE_KEYS } from '../constants/GameConstants.js';
import { soundSystem } from '../systems/SoundSystem.js';
import { rankingSystem } from '../systems/RankingSystem.js';
import { isSupabaseConfigured } from '../config/supabaseConfig.js';
import { computeUIScale, scaledFontPx } from '../utils/ResponsiveUI.js';

export class RankingScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.RANKING });
  }

  async create() {
    // GameSceneはScale.RESIZEでブラウザの実サイズいっぱいに表示される
    // (main.js参照)ため、固定のSCREEN_WIDTH/HEIGHTではなくその時点の
    // 実サイズ(this.scale.width/height)を基準に配置する。
    const centerX = this.scale.width / 2;
    const screenHeight = this.scale.height;
    this._sceneActive = true;
    this.events.once('shutdown', () => {
      this._sceneActive = false;
    });

    // 「スマホでもプレイできるように」への対応: 画面の実サイズから縮小率を
    // 算出し、フォントサイズに一律で乗算する(ResponsiveUI.computeUIScale参照)。
    const s = computeUIScale(this.scale.width, this.scale.height);

    this.add.text(centerX, 40 * s, 'ランキング', { fontSize: scaledFontPx(28, s), color: '#ffffff' }).setOrigin(0.5);

    const sourceLabel = isSupabaseConfigured()
      ? 'Supabase上の全対戦結果を集計(勝利数順、上位20名)'
      : 'この端末での対戦履歴のみ(Supabase未設定・勝利数順)';
    this.add.text(centerX, 75 * s, sourceLabel, { fontSize: scaledFontPx(13, s), color: '#88ddaa' }).setOrigin(0.5);

    this.listText = this.add
      .text(centerX, 110 * s, '読み込み中...', { fontSize: scaledFontPx(14, s), color: '#ffffff', align: 'left', lineSpacing: 6 })
      .setOrigin(0.5, 0);

    const backBtn = this.add
      .text(centerX, screenHeight - 40 * s, 'タイトルに戻る', {
        fontSize: scaledFontPx(20, s),
        color: '#ffffff',
        backgroundColor: '#3a3a3a',
        padding: { x: Math.round(12 * s), y: Math.round(6 * s) },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => {
      soundSystem.playSE('button');
      this.scene.start(SCENE_KEYS.TITLE);
    });

    try {
      const rows = await rankingSystem.fetchRanking(20);
      if (!this._sceneActive) return;
      this._renderRows(rows);
    } catch (e) {
      console.error('[RankingScene] ランキングの取得に失敗しました。', e);
      if (this._sceneActive) this.listText.setText('ランキングの取得に失敗しました。');
    }
  }

  _renderRows(rows) {
    if (!rows || rows.length === 0) {
      this.listText.setText('まだ対戦記録がありません。対戦するとここに記録されます。');
      return;
    }
    const header = '順位 プレイヤー名           勝利数 試合数 撃破';
    const lines = rows.map((row, i) => {
      const name = String(row.player_name ?? row.playerName ?? 'プレイヤー').padEnd(14, '　').slice(0, 14);
      const wins = String(row.wins ?? 0).padStart(4, ' ');
      const matches = String(row.matches ?? 0).padStart(4, ' ');
      const kills = String(row.kills ?? 0).padStart(3, ' ');
      return `${String(i + 1).padStart(2, ' ')}位 ${name} ${wins} ${matches} ${kills}`;
    });
    this.listText.setText([header, ...lines].join('\n'));
  }
}
