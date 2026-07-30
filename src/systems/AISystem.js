/**
 * AISystem.js
 * ------------------------------------------------------------
 * AI対戦プレイヤー全体の生成・難易度管理を行うシステム。
 * 個々のAIの思考ルーチンはobjects/AI.jsが担当し、本システムは
 * 「何人のAIをどの難易度で配置するか」等の統括を行う。
 * ------------------------------------------------------------
 */
import { AI_DIFFICULTY, MAX_AI_PLAYERS } from '../constants/GameConstants.js';
import { AI } from '../objects/AI.js';

export class AISystem {
  constructor() {
    this.aiControllers = [];
  }

  /**
   * @param {Array<Player>} aiPlayers
   * @param {string} difficulty
   */
  setup(aiPlayers, difficulty = AI_DIFFICULTY.NORMAL) {
    this.aiControllers = aiPlayers
      .slice(0, MAX_AI_PLAYERS)
      .map((player) => new AI(player, difficulty));
  }

  update(time, delta, worldState) {
    for (const ai of this.aiControllers) {
      ai.update(time, delta, worldState);
    }
  }
}
