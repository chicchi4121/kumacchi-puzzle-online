/**
 * SkillSystem.js
 * ------------------------------------------------------------
 * 必殺技ゲージの管理と必殺技発動を担当するシステム（Phase3実装予定）。
 * データ駆動設計により、キャラクターごとの必殺技を後から追加できる
 * よう、SKILL_DEFINITIONSに定義を追加するだけで拡張可能にしてある。
 * ------------------------------------------------------------
 */
import {
  SKILL_GAUGE_MAX,
  SKILL_GAUGE_PER_BLOCK_BREAK,
  SKILL_GAUGE_PER_KILL,
  RAGE_MODE_DURATION_MS,
} from '../constants/GameConstants.js';

// キャラクターごとの必殺技定義（将来追加しやすいようデータ駆動にしてある）
const SKILL_DEFINITIONS = {
  rage_mode: {
    name: '爆裂モード',
    durationMs: RAGE_MODE_DURATION_MS,
    apply(player) {
      player._preRageStats = { maxBombs: player.maxBombs, blastRange: player.blastRange };
      player.maxBombs = 10;
      player.blastRange = 10;
      player._blastPenetrates = true; // TODO(Phase3): Explosion側で貫通処理に対応する
    },
    revert(player) {
      if (player._preRageStats) {
        player.maxBombs = player._preRageStats.maxBombs;
        player.blastRange = player._preRageStats.blastRange;
        delete player._preRageStats;
      }
      player._blastPenetrates = false;
    },
  },
};

export class SkillSystem {
  constructor(player, skillKey = 'rage_mode') {
    this.player = player;
    this.skillKey = skillKey;
    this.gauge = 0;
    this.used = false; // 「爆裂モード」は1回だけという仕様に対応
  }

  onBlockBroken() {
    if (!this.used) this.gauge = Math.min(SKILL_GAUGE_MAX, this.gauge + SKILL_GAUGE_PER_BLOCK_BREAK);
  }

  onEnemyDefeated() {
    if (!this.used) this.gauge = Math.min(SKILL_GAUGE_MAX, this.gauge + SKILL_GAUGE_PER_KILL);
  }

  get isReady() {
    return !this.used && this.gauge >= SKILL_GAUGE_MAX;
  }

  activate(scene) {
    if (!this.isReady) return false;
    const def = SKILL_DEFINITIONS[this.skillKey];
    if (!def) return false;

    def.apply(this.player);
    this.used = true;
    this.gauge = 0;

    scene.time.delayedCall(def.durationMs, () => def.revert(this.player));
    return true;
  }
}
