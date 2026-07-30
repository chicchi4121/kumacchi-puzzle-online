/**
 * AI.js
 * ------------------------------------------------------------
 * AI対戦プレイヤーの思考ルーチン。
 * 「爆弾回避」「アイテム取得」「プレイヤー追跡」「積極的なブロック破壊」
 * 「撃破チャンスの活用」「閉じ込め戦術」を難易度別のパラメータ
 * (AI_PROFILES)に基づいて実行する。
 * 「必殺技使用」はPhase3で必殺技システム本体が実装された後に対応する。
 *
 * サイコロ6面ステージ対応: 全ての移動判断はCubeStage.resolveMove()を
 * 経由するため、面の端に到達すると自然に隣接する面へも移動候補が広がる
 * (=AIは徘徊中に自発的に他の面へ渡っていく)。ただし追跡・撃破チャンス・
 * 閉じ込め戦術は現状のスコープ(v1)では「同じ面にいる敵/アイテムのみ」を
 * 対象とする（面をまたいだ経路探索は将来の拡張課題）。
 *
 * NOTE: 壊せない壁(HARD)は通り抜けできない。壊せる壁(SOFT/ITEM)は
 * 👻(GHOST)取得済み(player.canPassSoftBlock)の場合のみ通り抜けできる。
 * そのためAIは基本的に壊せるブロックを積極的に爆破して進路を切り開く
 * 必要がある。理由は以下の通り:
 * (1) GHOST未取得の間はSOFT/ITEMブロックが実際の障害物になるため、
 *     移動ルートを確保するには破壊が必須
 * (2) 爆風は壁で止まる/壊せるブロックに当たると止まるため、爆風を
 *     敵に届かせるには進路上のブロックを壊しておく価値がある
 * (3) ブロック破壊そのものがスコア(撃破数と並ぶ集計対象)になる
 *
 * データ駆動設計（開発ルール6）: 難易度ごとの挙動差はAI_PROFILESの
 * パラメータ調整のみで表現し、ロジック本体は難易度に依存しないようにしてある。
 * ------------------------------------------------------------
 */
import { AI_DIFFICULTY, BLOCK_TYPES } from '../constants/GameConstants.js';
import { random } from '../utils/Random.js';
import { Explosion } from './Explosion.js';

// 難易度ごとの行動パラメータ（データ駆動）
// 「AIのレベルを少し下げてほしい」という要望への対応(2026-07)で、4段階
// 全ての難易度を一律で少しだけ弱める方向に調整した(判断間隔を少し延ばす
// =反応を少し遅く、mistakeChance(回避を試みない確率)を少し増やす、
// bombChance/killShotChance/chaseChance(積極性)を少し下げる)。各難易度間の
// 相対的な強さの順序(EASY<NORMAL<HARD<EXPERT)は変えていない。
const AI_PROFILES = Object.freeze({
  [AI_DIFFICULTY.EASY]: {
    decisionIntervalMs: 600, // 判断の間隔（長いほど反応が遅い）
    // 危険地帯にいても回避に失敗する確率。
    // (自爆しすぎ対策で全難易度引き下げ済み。_findSafeDirection自体のBFS化で
    //  「回避を試みたのに失敗する」ケースは大幅に減ったため、mistakeChanceは
    //  純粋に「そもそも回避を試みない」割合として機能する)
    mistakeChance: 0.3,
    bombChance: 0.28, // ブロック破壊(徘徊/進路上)を試みる確率
    killShotChance: 0.4, // 撃破チャンスを実行に移す確率
    chaseChance: 0.22, // プレイヤーを追跡する確率（それ以外は徘徊/アイテム優先）
  },
  [AI_DIFFICULTY.NORMAL]: {
    decisionIntervalMs: 420,
    mistakeChance: 0.16,
    bombChance: 0.45,
    killShotChance: 0.58,
    chaseChance: 0.45,
  },
  [AI_DIFFICULTY.HARD]: {
    decisionIntervalMs: 260,
    mistakeChance: 0.07,
    bombChance: 0.6,
    killShotChance: 0.75,
    chaseChance: 0.65,
  },
  [AI_DIFFICULTY.EXPERT]: {
    decisionIntervalMs: 150,
    mistakeChance: 0.03,
    bombChance: 0.75,
    killShotChance: 0.88,
    chaseChance: 0.8,
  },
});

const DIRECTIONS = [
  { name: 'up', dCol: 0, dRow: -1 },
  { name: 'down', dCol: 0, dRow: 1 },
  { name: 'left', dCol: -1, dRow: 0 },
  { name: 'right', dCol: 1, dRow: 0 },
];

/** 面をまたいでも一意になるタイルキー("FRONT:3,4"のような形式) */
function tileKey(face, col, row) {
  return `${face}:${col},${row}`;
}

/** マンハッタン距離。異なる面同士の座標を比較しても意味を持たないため、
 * 呼び出し側で必ず同じ面同士であることを確認してから使うこと。 */
function manhattan(a, b) {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

export class AI {
  /**
   * @param {Player} player - このAIが操作するPlayerインスタンス
   * @param {string} difficulty - AI_DIFFICULTYのいずれか
   */
  constructor(player, difficulty = AI_DIFFICULTY.NORMAL) {
    this.player = player;
    this.difficulty = difficulty;
    this.profile = AI_PROFILES[difficulty] ?? AI_PROFILES[AI_DIFFICULTY.NORMAL];
    this._nextDecisionAt = 0;
  }

  /**
   * 毎フレーム呼び出される。実際の意思決定は難易度に応じた間隔でのみ行う
   * （decisionIntervalMsごと）。移動自体はPlayer.tryMove()の完了を
   * 待つ必要があるため、意思決定のたびに1マス分の移動判断を行う。
   *
   * @param {number} time
   * @param {number} delta
   * @param {object} worldState - { stage: CubeStage, bombs, players, items, dangerTiles: Set<string>, placeBomb: (player)=>void }
   */
  update(time, delta, worldState) {
    const { player } = this;
    if (!player.isAlive || player.isMoving) return;
    if (time < this._nextDecisionAt) return;
    this._nextDecisionAt = time + this.profile.decisionIntervalMs;

    const { stage, bombs, players, items, dangerTiles, placeBomb } = worldState;
    const here = { face: player.face, col: player.col, row: player.row };
    const isBlockedByBomb = (face, c, r) => this._isBlockedByBomb(bombs, face, c, r);

    // --- 1. 爆弾回避：自分がいるマスが危険地帯なら安全なマスへ逃げる ---
    const inDanger = dangerTiles.has(tileKey(here.face, here.col, here.row));
    const willMistake = random.next() < this.profile.mistakeChance;

    if (inDanger && !willMistake) {
      const fleeDir = this._findSafeDirection(player, stage, bombs, dangerTiles);
      if (fleeDir) {
        player.tryMove(fleeDir, isBlockedByBomb);
        return;
      }
    }

    const canAct = player.canPlaceBomb() && !inDanger;
    // v1のスコープ: 追跡・撃破チャンス・閉じ込め戦術は「同じ面にいる敵」のみを対象とする
    const enemies = players.filter((p) => p.isAlive && p !== player && p.face === player.face);
    const nearestEnemy = this._findNearest(here, enemies);

    // --- 2. 撃破チャンス：直線上の敵に爆風が届き、設置後も逃げ場があるなら迷わず爆弾を置く ---
    if (canAct && nearestEnemy && random.next() < this.profile.killShotChance) {
      const canHit = this._canBlastReach(stage, here, nearestEnemy, player.blastRange);
      if (canHit && this._hasEscapeRoute(stage, bombs, here, player.blastRange, dangerTiles, player.canPassSoftBlock)) {
        placeBomb(player);
        return;
      }
    }

    // --- 3. 閉じ込め戦術：隣接する敵の逃げ道が(他の爆弾で)塞がっているなら爆弾で仕留める ---
    const trappableEnemy = this._findTrappableEnemy(player, players, stage, bombs);
    if (trappableEnemy && canAct) {
      placeBomb(player);
      return;
    }

    // --- 4. アイテム取得 or プレイヤー追跡：目標を決める(v1では同じ面のもののみ) ---
    const sameFaceItems = items.filter((it) => it.face === player.face);
    const nearestItem = this._findNearest(here, sameFaceItems);
    let target = null;
    if (nearestItem && (!nearestEnemy || random.next() > this.profile.chaseChance)) {
      target = nearestItem;
    } else if (nearestEnemy) {
      target = nearestEnemy;
    }

    if (target) {
      // 進路上に壊せるブロックがあるなら積極的に爆破して、爆風が通る道・
      // 追跡ルートを切り開く（GHOST未取得なら移動そのものに必須、逃げ場がある時のみ実行）
      if (canAct && this._hasAdjacentBreakableTowards(stage, here, target) && random.next() < this.profile.bombChance) {
        if (this._hasEscapeRoute(stage, bombs, here, player.blastRange, dangerTiles, player.canPassSoftBlock)) {
          placeBomb(player);
          return;
        }
      }

      const dir = this._chooseDirectionTowards(here, target, stage, bombs, dangerTiles, willMistake, player.canPassSoftBlock);
      if (dir) {
        player.tryMove(dir, isBlockedByBomb);
        return;
      }
    }

    // --- 5. 目的地が無い場合は徘徊しつつ、隣接する壊せるブロックがあれば積極的に爆破する ---
    // (徘徊はCubeStage.resolveMove経由なので、面の端にいると隣接面への移動も候補に入り、
    //  結果としてAIは自発的に他の面へも渡っていく)
    if (canAct && this._hasAnyAdjacentBreakable(stage, here) && random.next() < this.profile.bombChance) {
      if (this._hasEscapeRoute(stage, bombs, here, player.blastRange, dangerTiles, player.canPassSoftBlock)) {
        placeBomb(player);
        return;
      }
    }

    const wanderDir = this._chooseRandomWalkableDirection(here, stage, bombs, dangerTiles, player.canPassSoftBlock);
    if (wanderDir) {
      player.tryMove(wanderDir, isBlockedByBomb);
    }
  }

  _isBlockedByBomb(bombs, face, col, row) {
    return bombs.some((b) => !b.detonated && b.face === face && b.col === col && b.row === row);
  }

  /**
   * 危険地帯から逃げるための最初の一歩の方向を選ぶ。
   *
   * 【重要な修正・自爆しすぎ問題への対応】爆弾は十字型に爆風が伝播し、
   * 爆弾のあるマス自身も爆風に含まれるため、爆弾のちょうど真上や爆風の
   * 軸線上にいる場合、隣接する4マスは(blastRange>=1なら)ほぼ必ず爆風の
   * 届く範囲に入っている。そのため「隣接マスがdangerTilesに含まれて
   * いないか」だけを見る1マス先読みでは、そもそも安全な隣接マスが
   * 見つからず常に「逃げ場なし」と誤判定してしまい、AIがその場に
   * 立ち尽くして自爆する主な原因になっていた
   * (_hasEscapeRouteで既に対応済みだった「隣接4マスは爆風に含まれる」
   * という同じ構造的な問題が、実際に「今すぐどちらへ動くか」を決める
   * こちらの関数には反映されていなかった)。
   * 隣接マスに安全な場所が無い場合は、角を曲がって回り込めば爆風の外に
   * 出られることが多いため、数マス先まで幅優先探索(BFS)して、安全な
   * マスへ辿り着く経路の「最初の一歩」の方向を返すようにした。
   */
  _findSafeDirection(player, stage, bombs, dangerTiles) {
    const canPassSoftBlock = player.canPassSoftBlock;
    const startKey = tileKey(player.face, player.col, player.row);
    const visited = new Set([startKey]);

    // 深さ0(隣接マス): 安全な方向が複数あれば毎回同じ方向へ偏らないようランダムに選ぶ
    const immediateSafe = [];
    let frontier = [];
    for (const dir of DIRECTIONS) {
      const resolved = stage.resolveMove(player.face, player.col, player.row, dir.name);
      if (!resolved) continue;
      if (!stage.isWalkable(resolved.face, resolved.col, resolved.row, { canPassSoftBlock })) continue;
      if (this._isBlockedByBomb(bombs, resolved.face, resolved.col, resolved.row)) continue;
      const key = tileKey(resolved.face, resolved.col, resolved.row);
      if (visited.has(key)) continue;
      visited.add(key);
      if (!dangerTiles.has(key)) {
        immediateSafe.push(dir.name);
      } else {
        frontier.push({ face: resolved.face, col: resolved.col, row: resolved.row, firstDir: dir.name });
      }
    }
    if (immediateSafe.length > 0) {
      return immediateSafe[Math.floor(random.next() * immediateSafe.length)];
    }

    // 隣接マスに逃げ場が無ければ、数マス先までBFSで辿って安全なマスを探す
    const maxDepth = 6;
    for (let depth = 1; depth < maxDepth && frontier.length > 0; depth++) {
      const found = [];
      const nextFrontier = [];
      for (const pos of frontier) {
        for (const dir of DIRECTIONS) {
          const resolved = stage.resolveMove(pos.face, pos.col, pos.row, dir.name);
          if (!resolved) continue;
          if (!stage.isWalkable(resolved.face, resolved.col, resolved.row, { canPassSoftBlock })) continue;
          if (this._isBlockedByBomb(bombs, resolved.face, resolved.col, resolved.row)) continue;
          const key = tileKey(resolved.face, resolved.col, resolved.row);
          if (visited.has(key)) continue;
          visited.add(key);
          if (!dangerTiles.has(key)) {
            found.push(pos.firstDir);
          } else {
            nextFrontier.push({ face: resolved.face, col: resolved.col, row: resolved.row, firstDir: pos.firstDir });
          }
        }
      }
      if (found.length > 0) {
        return found[Math.floor(random.next() * found.length)];
      }
      frontier = nextFrontier;
    }
    return null; // 本当にどこにも逃げ場が無い(周囲を完全に囲まれている等)
  }

  /**
   * 隣接している敵がいて、かつその敵の逃げ道が少ない場合にtrueを返す（閉じ込め戦術）。
   * NOTE: 壊せない壁(HARD)は逃げ道にならず、壊せる壁(SOFT/ITEM)は敵自身が
   * GHOST(👻)取得済みの場合のみ逃げ道になる。v1では同じ面にいる敵のみ対象。
   */
  _findTrappableEnemy(player, players, stage, bombs) {
    const enemies = players.filter((p) => p.isAlive && p !== player && p.face === player.face);
    for (const enemy of enemies) {
      const dist = manhattan(player, enemy);
      if (dist !== 1) continue; // 隣接していない

      let openEscapeRoutes = 0;
      for (const dir of DIRECTIONS) {
        const resolved = stage.resolveMove(enemy.face, enemy.col, enemy.row, dir.name);
        if (!resolved) continue;
        if (
          stage.isWalkable(resolved.face, resolved.col, resolved.row, { canPassSoftBlock: enemy.canPassSoftBlock }) &&
          !this._isBlockedByBomb(bombs, resolved.face, resolved.col, resolved.row)
        ) {
          openEscapeRoutes++;
        }
      }
      // 逃げ道が1つ以下（自分がいる方向を除けばほぼ塞がっている）なら閉じ込めるチャンス
      if (openEscapeRoutes <= 1) return enemy;
    }
    return null;
  }

  /**
   * 座標(face/col/row)を持つオブジェクトの配列から最も近いものを返す。
   * 面をまたいだ距離比較はできないため、`from`と同じ面のものだけを対象にする
   * （v1のスコープ: 面をまたいだ経路探索・追跡は行わない）。
   */
  _findNearest(from, candidates) {
    if (!candidates || candidates.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (c.face !== from.face) continue;
      const d = manhattan(from, c);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * `from`に爆弾を置いた場合、`to`まで爆風が届くかどうかを判定する。
   * 同じ面・同じ行/列に並んでいて、距離がblastRange以内、かつ間に壁
   * (HARD/SOFT/ITEM問わず)が挟まっていないことが条件（爆風は最初に
   * 当たったブロックで止まるため、間に何かあると届かない）。
   * 爆風は面をまたいで伝播しないため、fromとtoが異なる面なら常にfalse。
   */
  _canBlastReach(stage, from, to, range) {
    if (from.face !== to.face) return false;
    if (from.col !== to.col && from.row !== to.row) return false;
    const dist = manhattan(from, to);
    if (dist === 0 || dist > range) return false;

    const stepCol = Math.sign(to.col - from.col);
    const stepRow = Math.sign(to.row - from.row);
    for (let step = 1; step < dist; step++) {
      const col = from.col + stepCol * step;
      const row = from.row + stepRow * step;
      if (stage.getBlockType(from.face, col, row) !== BLOCK_TYPES.EMPTY) return false;
    }
    return true;
  }

  /**
   * `from`に今まさに爆弾を置いたとして、爆発(約3秒後)までにその爆風(dry-run)にも
   * 既存の危険地帯にも他の爆弾にも当たらないマスへ辿り着けるかを確認する
   * （自爆防止チェック）。
   *
   * NOTE: 壊せない壁(HARD)は通行不可・壊せる壁(SOFT/ITEM)は👻取得済みのみ通行可、
   * という仕様のもとでは、爆弾位置に隣接するマス(距離1)は「爆風が届く方向で
   * かつ間に何も無い」ため通行可能である限りほぼ確実に爆風範囲に含まれてしまう
   * （十字型の爆風は隣接4マスを必ず含むため）。そのため隣接マスだけを見る
   * 1マス先読みでは常に「逃げ場なし」と誤判定してしまう。
   * 実際のボンバーマンでは、爆風が十字型にしか伸びないことを利用して、
   * 角を曲がって斜め方向へ回り込むことで爆風範囲の外に逃げられる
   * （detonateまで数秒あるため、複数マス移動する猶予がある）。
   * これを反映するため、隣接マスだけでなく数マス先までの幅優先探索(BFS)で
   * 「爆風にも危険地帯にも入らないマスへ到達できるか」を判定する。
   * 爆風は面をまたいで伝播しないため、BFSの途中で隣接する面へ渡れた時点
   * (resolveMoveがcrossed:trueを返す移動)で即座に安全と判定してよい。
   */
  _hasEscapeRoute(stage, bombs, from, range, dangerTiles, canPassSoftBlock = false) {
    const faceStage = stage.getFaceStage(from.face);
    const { tiles } = Explosion.computeBlastTiles(faceStage, from.col, from.row, range, { dryRun: true });
    const futureBlast = new Set(tiles.map((t) => tileKey(from.face, t.col, t.row)));

    const maxDepth = range + 2; // 爆風範囲+αだけ先まで辿れれば、角を曲がって逃げ切れるはず
    const visited = new Set([tileKey(from.face, from.col, from.row)]);
    let frontier = [{ face: from.face, col: from.col, row: from.row }];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier = [];
      for (const pos of frontier) {
        for (const dir of DIRECTIONS) {
          const resolved = stage.resolveMove(pos.face, pos.col, pos.row, dir.name);
          if (!resolved) continue;
          const key = tileKey(resolved.face, resolved.col, resolved.row);
          if (visited.has(key)) continue;
          if (!stage.isWalkable(resolved.face, resolved.col, resolved.row, { canPassSoftBlock })) continue;
          if (this._isBlockedByBomb(bombs, resolved.face, resolved.col, resolved.row)) continue;
          visited.add(key);
          if (!futureBlast.has(key) && !dangerTiles.has(key)) {
            return true;
          }
          nextFrontier.push({ face: resolved.face, col: resolved.col, row: resolved.row });
        }
      }
      frontier = nextFrontier;
    }
    return false;
  }

  /** 目標へ向かう主要な方向の隣に、壊せるブロック(SOFT/ITEM)があるかどうか(同じ面前提) */
  _hasAdjacentBreakableTowards(stage, here, target) {
    if (here.face !== target.face) return false;
    const dCol = target.col - here.col;
    const dRow = target.row - here.row;
    const preferredDirs = Math.abs(dCol) >= Math.abs(dRow)
      ? [{ dCol: dCol > 0 ? 1 : -1, dRow: 0 }, { dCol: 0, dRow: dRow > 0 ? 1 : -1 }]
      : [{ dCol: 0, dRow: dRow > 0 ? 1 : -1 }, { dCol: dCol > 0 ? 1 : -1, dRow: 0 }];

    return preferredDirs.some((d) => {
      const type = stage.getBlockType(here.face, here.col + d.dCol, here.row + d.dRow);
      return type === BLOCK_TYPES.SOFT || type === BLOCK_TYPES.ITEM;
    });
  }

  /** 隣接4マスのいずれかに壊せるブロック(SOFT/ITEM)があるかどうか */
  _hasAnyAdjacentBreakable(stage, here) {
    return DIRECTIONS.some((dir) => {
      const type = stage.getBlockType(here.face, here.col + dir.dCol, here.row + dir.dRow);
      return type === BLOCK_TYPES.SOFT || type === BLOCK_TYPES.ITEM;
    });
  }

  /**
   * 目標に近づく方向を選ぶ。危険地帯は基本的に避けるが、ミス発生時(willMistake)は
   * 危険を考慮せず最短方向へ進んでしまう（難易度が低いほど発生しやすい）。
   */
  _chooseDirectionTowards(here, target, stage, bombs, dangerTiles, willMistake, canPassSoftBlock = false) {
    const dCol = target.col - here.col;
    const dRow = target.row - here.row;

    // 移動距離が大きい軸を優先し、ダメなら他方の軸を試す
    const preferredOrder = Math.abs(dCol) >= Math.abs(dRow)
      ? [dCol > 0 ? 'right' : 'left', dRow > 0 ? 'down' : 'up']
      : [dRow > 0 ? 'down' : 'up', dCol > 0 ? 'right' : 'left'];

    for (const dirName of preferredOrder) {
      const resolved = stage.resolveMove(here.face, here.col, here.row, dirName);
      if (!resolved) continue;
      if (!stage.isWalkable(resolved.face, resolved.col, resolved.row, { canPassSoftBlock })) continue;
      if (this._isBlockedByBomb(bombs, resolved.face, resolved.col, resolved.row)) continue;
      if (!willMistake && dangerTiles.has(tileKey(resolved.face, resolved.col, resolved.row))) continue;
      return dirName;
    }
    return null;
  }

  _chooseRandomWalkableDirection(here, stage, bombs, dangerTiles, canPassSoftBlock = false) {
    const candidates = [];
    for (const dir of DIRECTIONS) {
      const resolved = stage.resolveMove(here.face, here.col, here.row, dir.name);
      if (!resolved) continue;
      if (!stage.isWalkable(resolved.face, resolved.col, resolved.row, { canPassSoftBlock })) continue;
      if (this._isBlockedByBomb(bombs, resolved.face, resolved.col, resolved.row)) continue;
      if (dangerTiles.has(tileKey(resolved.face, resolved.col, resolved.row))) continue;
      candidates.push(dir.name);
    }
    return candidates.length > 0 ? candidates[Math.floor(random.next() * candidates.length)] : null;
  }
}
