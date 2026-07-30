/**
 * CubeStage.js
 * ------------------------------------------------------------
 * バトルエリアを「サイコロ状(立方体)の6面ステージ」として管理するクラス。
 * 各面はそれぞれ独立した通常のStage(2次元グリッドの迷路)であり、
 * 面の端まで移動すると隣接する面へ乗り移れる（CubeTopology.jsの
 * CROSSING_TABLEに基づく）。
 *
 * 開発ルール9(描画とロジックの分離)に従い、本クラスはPhaser/Three.js
 * いずれにも依存しない純粋なデータ構造・ロジックのみを扱う。
 *
 * 現状のスコープ（v1）:
 * - 各面は独立したミニマップとして生成する。各面の中央を、その面に
 *   割り当てられたプレイヤー1人分の安全地帯として確保する。
 * - 面の外周(perimeter、四隅を含む)は、2026-07の再修正で「端も全て他の
 *   マスと一緒にしてほしい」という要望に対応し、Stage.generate()内の
 *   通常の柱判定・ランダム配置ロジック(_decideBlockType)にそのまま従う
 *   ようにした(以前はCubeStage側で外周を強制的に全て壊せるブロックへ
 *   上書きしていたが、その処理(_openFaceWalls)は撤廃した)。柱(HARD)は
 *   col・rowが共に偶数のマスのみなので、外周のおよそ半分は柱のまま残り、
 *   残り半分は内側と同様にランダムに空白/壊せるブロック/アイテムになる。
 *   面をまたぐには、この「壊せる/空白になった外周マス」を経由する。
 * - 爆風・爆弾の誘爆は面をまたいで伝播しない（爆風の計算はExplosion.jsが
 *   各面のStageに対して行うため、自然と面内で完結する）。
 * - プレイヤーの移動のみが面をまたぐ（resolveMove）。
 * ------------------------------------------------------------
 */
import { CUBE_FACE_NAMES, CUBE_FACE_COLS, CUBE_FACE_ROWS, MAX_PLAYERS } from '../constants/GameConstants.js';
import { CROSSING_TABLE } from '../constants/CubeTopology.js';
import { Stage, buildStartCandidates } from './Stage.js';

const DIRECTION_VECTORS = Object.freeze({
  up: { dCol: 0, dRow: -1 },
  down: { dCol: 0, dRow: 1 },
  left: { dCol: -1, dRow: 0 },
  right: { dCol: 1, dRow: 0 },
});

export class CubeStage {
  /**
   * @param {number} cols - 1面あたりの横マス数
   * @param {number} rows - 1面あたりの縦マス数
   */
  constructor(cols = CUBE_FACE_COLS, rows = CUBE_FACE_ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.faces = {};
    for (const name of CUBE_FACE_NAMES) {
      this.faces[name] = new Stage(cols, rows);
    }
    this.startPositions = [];
  }

  /**
   * (col, row)が面の外周(perimeter)上にあるかどうかを判定する。
   */
  _isPerimeterCell(col, row) {
    return col === 0 || row === 0 || col === this.cols - 1 || row === this.rows - 1;
  }

  /**
   * (col, row)が面の外周セルである場合、そこを破壊すると面をまたぐ移動を
   * 起こせるようになる方向(crossDirs)の一覧を返す。辺の途中(1方向のみ)・
   * 四隅(2方向)のどちらも自動的に判定できる汎用ロジック
   * (「4つ角限定」を撤廃し、横壁のどこからでも面をまたげるようにする
   * 要望への対応。以前は四隅+approachマスのみのハードコードされた
   * 一覧(_notchList)を使っていたが、外周全体を壊せるブロックにした
   * ことで、この判定ロジックだけで四隅・辺の途中の両方をカバーできる)。
   */
  _crossDirsForCell(col, row) {
    const dirs = [];
    if (row === 0) dirs.push('up');
    if (row === this.rows - 1) dirs.push('down');
    if (col === 0) dirs.push('left');
    if (col === this.cols - 1) dirs.push('right');
    return dirs;
  }

  /**
   * 6面すべての迷路を生成し、プレイヤーの開始地点(安全地帯)を確保する。
   *
   * @param {number} playerCount - 参加人数(最大6、面の数まで)
   * @param {number} humanCount - 人間プレイヤーの人数(PVP対応)。1なら
   *   従来通り「参加者1人につき1面、各面の中央からスタート」。2以上なら
   *   人間プレイヤー全員を`HOME_FACE`(先頭の面)に集めて同じ面から一緒に
   *   スタートさせ(お互いの姿が見え、カメラも常にその面を映すため対戦
   *   しやすい)、残りのAIは1人ずつ別の面に配置する。
   */
  generate(playerCount = 1, humanCount = 1) {
    const centerCol = Math.floor(this.cols / 2);
    const centerRow = Math.floor(this.rows / 2);

    for (const name of CUBE_FACE_NAMES) {
      const stage = this.faces[name];
      // 「端も全て他のマスと一緒にして」への対応: 外周を特別扱いせず、
      // Stage.generate()の通常ロジック(柱判定・ランダム配置)だけで
      // 面全体(外周含む)を生成する(以前あった_openFaceWallsによる
      // 外周の強制開放は撤廃)。
      stage.generate(1);
    }

    const count = Math.max(1, Math.min(MAX_PLAYERS, playerCount, CUBE_FACE_NAMES.length));
    const humans = Math.max(1, Math.min(humanCount, count));

    if (humans <= 1) {
      // 従来通り: 参加者(AIも含め)1人につき1面、各面の中央が安全地帯。
      // Stage.generate()は既定では隅(buildStartCandidatesの1番目)を
      // 安全地帯にするため、サイコロステージでは各面の中央をその面の
      // 唯一の開始地点として使いたいので、中央も追加で安全地帯化し、
      // 開始地点情報を上書きする。
      for (const name of CUBE_FACE_NAMES) {
        const stage = this.faces[name];
        stage._clearSafeZone(centerCol, centerRow);
        stage.startPositions = [{ col: centerCol, row: centerRow }];
      }
      this.startPositions = CUBE_FACE_NAMES.slice(0, count).map((face) => ({
        face,
        col: centerCol,
        row: centerRow,
      }));
      return this.faces;
    }

    // PVPモード: 人間プレイヤー全員を同じ面(HOME_FACE)に集める。
    // buildStartCandidates()は四隅+上下辺中央の最大6箇所を返す
    // (Stage.jsの通常の複数人対応と同じ座標)。
    const homeFace = CUBE_FACE_NAMES[0];
    const homeStage = this.faces[homeFace];
    const homeCandidates = buildStartCandidates(homeStage.cols, homeStage.rows).slice(0, humans);
    for (const pos of homeCandidates) homeStage._clearSafeZone(pos.col, pos.row);
    homeStage.startPositions = homeCandidates;

    const positions = homeCandidates.map((pos) => ({ face: homeFace, col: pos.col, row: pos.row }));

    // 残りのAIは、人間が使っていない面に1人ずつ配置する(従来通り面の中央が安全地帯)。
    const aiCount = count - humans;
    const otherFaces = CUBE_FACE_NAMES.slice(1);
    for (let i = 0; i < aiCount; i++) {
      const face = otherFaces[i % otherFaces.length];
      const stage = this.faces[face];
      stage._clearSafeZone(centerCol, centerRow);
      stage.startPositions = [{ col: centerCol, row: centerRow }];
      positions.push({ face, col: centerCol, row: centerRow });
    }

    this.startPositions = positions;
    return this.faces;
  }

  /**
   * (face, col, row)が面の外周マスなら、それを破壊した際に連動して
   * 開けるべき「隣接する面の対応マス」の一覧を返す。それ以外のマスなら
   * 空配列を返す。
   *
   * 【不具合修正】外周マスを壊せるようにしても、面をまたいだ先(隣接面)の
   * 対応マスがSOFTのまま残っていると、そちらは「爆風が面をまたいで伝播
   * しない」設計上、自分のいる面からは絶対に壊せず、かつ👻取得済みで
   * なければ足を踏み入れることもできない(resolveMove自体は着地先を計算
   * できても、Player.tryMoveのisWalkableチェックで弾かれてしまう)。
   * つまり自分側だけ壊しても、相手側が塞がったままなら実質「その面から
   * 一切移動できない」状態になってしまう(ユーザー報告の不具合そのもの)。
   * これを解消するため、外周マスが破壊された際は、面をまたいだ先の
   * 対応マスも(壊せるブロックであれば)同時に破壊し、双方向とも即座に
   * 通行可能になるようにする(GameScene._onBombDetonateから使用)。
   */
  getMirrorCells(face, col, row) {
    const stage = this.faces[face];
    if (!stage || !this._isPerimeterCell(col, row)) return [];
    const crossDirs = this._crossDirsForCell(col, row);
    const mirrors = [];
    for (const dir of crossDirs) {
      const resolved = this.resolveMove(face, col, row, dir);
      if (resolved && resolved.crossed) {
        mirrors.push({ face: resolved.face, col: resolved.col, row: resolved.row });
      }
    }
    return mirrors;
  }

  getStartPositions() {
    return this.startPositions;
  }

  /** 面名からその面の通常のStageインスタンスを取得する */
  getFaceStage(face) {
    return this.faces[face];
  }

  getBlockType(face, col, row) {
    return this.faces[face].getBlockType(col, row);
  }

  isWalkable(face, col, row, options = {}) {
    const stage = this.faces[face];
    if (!stage) return false;
    return stage.isWalkable(col, row, options);
  }

  canPlaceBombAt(face, col, row) {
    return this.faces[face].canPlaceBombAt(col, row);
  }

  breakBlock(face, col, row) {
    return this.faces[face].breakBlock(col, row);
  }

  /**
   * 指定の面・位置からdirectionへ1マス移動しようとした場合の着地先を返す。
   * 面の内部にとどまる移動ならそのまま同じ面のcol/rowを、面の端を超える
   * 場合はCROSSING_TABLEに基づいて隣接する面の着地位置・向きを返す。
   *
   * NOTE: ここでは座標変換のみを行い、着地先が実際に通行可能かどうかは
   * 判定しない。呼び出し側(Player.tryMove等)で返り値に対して
   * isWalkable()を別途チェックすること。
   *
   * @returns {{face:string, col:number, row:number, facing:string, crossed:boolean}|null}
   */
  resolveMove(face, col, row, direction) {
    const stage = this.faces[face];
    const vector = DIRECTION_VECTORS[direction];
    if (!stage || !vector) return null;

    const targetCol = col + vector.dCol;
    const targetRow = row + vector.dRow;

    if (targetCol >= 0 && targetCol < stage.cols && targetRow >= 0 && targetRow < stage.rows) {
      return { face, col: targetCol, row: targetRow, facing: direction, crossed: false };
    }

    const crossing = CROSSING_TABLE[face]?.[direction];
    if (!crossing) return null;
    const { toFace, viaEdge, newFacing, varReversed } = crossing;
    const destStage = this.faces[toFace];
    if (!destStage) return null;

    // 面を出る際の「辺に沿った座標」(alongIdx): left/right辺ならrow、up/down辺ならcol
    const isHorizontalEdge = direction === 'left' || direction === 'right';
    const alongIdx = isHorizontalEdge ? row : col;
    const alongLenSrc = isHorizontalEdge ? stage.rows : stage.cols;

    const destAlongIsRow = viaEdge === 'left' || viaEdge === 'right';
    const alongLenDest = destAlongIsRow ? destStage.rows : destStage.cols;

    // 面のサイズが異なる場合にも対応できるよう比率でスケーリングする
    // (通常は全面同サイズなのでそのままの値になる)
    let destAlong = alongLenSrc === alongLenDest ? alongIdx : Math.round((alongIdx / (alongLenSrc - 1)) * (alongLenDest - 1));
    if (varReversed) destAlong = alongLenDest - 1 - destAlong;
    destAlong = Math.max(0, Math.min(alongLenDest - 1, destAlong));

    let destCol;
    let destRow;
    switch (viaEdge) {
      case 'left':
        destCol = 0;
        destRow = destAlong;
        break;
      case 'right':
        destCol = destStage.cols - 1;
        destRow = destAlong;
        break;
      case 'up':
        destRow = 0;
        destCol = destAlong;
        break;
      case 'down':
      default:
        destRow = destStage.rows - 1;
        destCol = destAlong;
        break;
    }

    return { face: toFace, col: destCol, row: destRow, facing: newFacing, crossed: true };
  }
}
