/**
 * SoundSystem.js
 * ------------------------------------------------------------
 * BGM・効果音の再生を担当するシステム。
 *
 * 開発ルール9「描画・物理・AI・UI・サウンド・データ管理を完全に分離する
 * こと」に基づき、Phaserには依存せずWeb Audio API/HTMLAudioElementのみで
 * 完結させている。
 *
 * 効果音(SE)は、実音源が用意されるまでのプレースホルダーとして
 * オシレーター合成のままにしている(SE_DEFINITIONS参照)。
 *
 * BGMは、ユーザーから提供された実音源ファイル(assets/audio/bgm/配下)を
 * <audio>要素で再生する方式に切り替えた(以前はオシレーターによる簡易な
 * 合成音のループだった)。
 * ・タイトル画面: assets/audio/bgm/opening.mp3を1曲固定で再生。
 * ・対戦画面: 「対戦毎にランダムで流れるようにしてほしい」という要望に
 *   対応し、assets/audio/bgm/battle1〜5.mp3の中から対戦開始のたびに
 *   ランダムに1曲選んで再生する(BGM_FILES/playBGM参照)。
 * ------------------------------------------------------------
 */
import { Save } from '../utils/Save.js';

// 効果音定義（データ駆動）: 1つの効果音は複数の音符(note)の連なりとして表現する。
// TODO(将来): assets/audio/se/ に実音源が用意されたら、ここを
// { file: 'bomb_place.mp3' } のような形式に差し替える。
const SE_DEFINITIONS = Object.freeze({
  bomb_place: [{ freq: 220, duration: 0.1, type: 'square', gain: 0.35 }],
  explosion: [{ freq: 180, duration: 0.28, type: 'sawtooth', sweepTo: 45, gain: 0.4 }],
  chain_explosion: [{ freq: 240, duration: 0.24, type: 'sawtooth', sweepTo: 60, gain: 0.38 }],
  item_get: [
    { freq: 440, duration: 0.08, type: 'sine', gain: 0.3 },
    { freq: 660, duration: 0.14, type: 'sine', gain: 0.3, delay: 0.08 },
  ],
  // 「一人1回まで爆弾に当たっても大丈夫」の猶予を消費して助かった際の合図音
  bomb_grace: [
    { freq: 880, duration: 0.06, type: 'triangle', gain: 0.28 },
    { freq: 990, duration: 0.1, type: 'triangle', gain: 0.28, delay: 0.06 },
  ],
  victory: [
    { freq: 523.25, duration: 0.16, type: 'triangle', gain: 0.3 },
    { freq: 659.25, duration: 0.16, type: 'triangle', gain: 0.3, delay: 0.16 },
    { freq: 783.99, duration: 0.32, type: 'triangle', gain: 0.3, delay: 0.32 },
  ],
  defeat: [
    { freq: 392, duration: 0.22, type: 'triangle', gain: 0.3 },
    { freq: 311.13, duration: 0.22, type: 'triangle', gain: 0.3, delay: 0.22 },
    { freq: 261.63, duration: 0.4, type: 'triangle', gain: 0.3, delay: 0.44 },
  ],
  button: [{ freq: 800, duration: 0.05, type: 'square', gain: 0.2 }],
  countdown_tick: [{ freq: 660, duration: 0.1, type: 'square', gain: 0.3 }],
  countdown_go: [{ freq: 990, duration: 0.28, type: 'square', gain: 0.35 }],
});

// BGM定義: キーごとに再生候補となる音源ファイルのパスの配列。
// 「対戦毎にランダムで流れるようにしてほしい」への対応で、gameキーには
// 複数のファイルを列挙しておき、playBGM()呼び出しのたびにこの中から
// ランダムに1つを選んで再生する(titleは1曲のみなので常に同じ曲になる)。
const BGM_FILES = Object.freeze({
  title: ['assets/audio/bgm/opening.mp3'],
  game: [
    'assets/audio/bgm/battle1.mp3',
    'assets/audio/bgm/battle2.mp3',
    'assets/audio/bgm/battle3.mp3',
    'assets/audio/bgm/battle4.mp3',
    'assets/audio/bgm/battle5.mp3',
  ],
});

export class SoundSystem {
  constructor() {
    this.ctx = null;
    this.masterSeGain = null;
    this.masterBgmGain = null;
    this.currentBgmKey = null;
    this._bgmAudio = null; // BGM再生用の<audio>要素(SEはWeb Audio、BGMはHTMLAudioElementと再生経路が別)

    const savedVolume = Save.getVolume();
    this.bgmVolume = savedVolume.bgm ?? 0.8;
    this.seVolume = savedVolume.se ?? 0.8;
  }

  /** AudioContextはユーザー操作(クリック等)後でないと開始できないブラウザが多いため遅延生成する */
  _ensureContext() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return; // 非対応環境では何もしない

    this.ctx = new AudioCtx();
    this.masterSeGain = this.ctx.createGain();
    this.masterSeGain.gain.value = this.seVolume;
    this.masterSeGain.connect(this.ctx.destination);

    this.masterBgmGain = this.ctx.createGain();
    this.masterBgmGain.gain.value = this.bgmVolume;
    this.masterBgmGain.connect(this.ctx.destination);
  }

  /**
   * @param {'bgm'|'se'} type
   * @param {number} value - 0.0〜1.0
   */
  setVolume(type, value) {
    const clamped = Math.max(0, Math.min(1, value));
    this._ensureContext();
    if (type === 'bgm') {
      this.bgmVolume = clamped;
      if (this.masterBgmGain) this.masterBgmGain.gain.value = clamped;
      if (this._bgmAudio) this._bgmAudio.volume = clamped;
    } else {
      this.seVolume = clamped;
      if (this.masterSeGain) this.masterSeGain.gain.value = clamped;
    }
    Save.setVolume({ bgm: this.bgmVolume, se: this.seVolume });
  }

  getVolume() {
    return { bgm: this.bgmVolume, se: this.seVolume };
  }

  playSE(key) {
    this._ensureContext();
    if (!this.ctx) return;
    const notes = SE_DEFINITIONS[key];
    if (!notes) {
      console.warn(`[SoundSystem] 未定義の効果音キー: ${key}`);
      return;
    }
    for (const note of notes) this._playTone(note, this.masterSeGain);
  }

  _playTone({ freq, duration, type = 'sine', sweepTo = null, delay = 0, gain = 0.3 }, destination) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;

    const start = ctx.currentTime + delay;
    osc.frequency.setValueAtTime(freq, start);
    if (sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(sweepTo, 1), start + duration);
    }

    // クリックノイズ防止のための簡易エンベロープ（アタック→リリース）
    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.linearRampToValueAtTime(gain, start + 0.01);
    gainNode.gain.linearRampToValueAtTime(0.0001, start + duration);

    osc.connect(gainNode);
    gainNode.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /**
   * BGMを再生する。
   * @param {'title'|'game'} key
   *
   * 「ファイルのオープニング.mp3をオープニング画面のBGMにしてほしい。
   * バトルBGM.zipを対戦毎にランダムで流れるようにしてほしい」への対応。
   * titleは1曲のみ(常に同じファイル)、gameはBGM_FILES.gameの中から
   * 呼び出されるたびに毎回ランダムに1曲選び直す(同じ曲が続けて選ばれる
   * こともある単純なランダム選択。「前回と同じ曲は避ける」といった重み
   * 付けは行っていない)。
   */
  playBGM(key) {
    const files = BGM_FILES[key];
    if (!files || files.length === 0) return;
    if (typeof Audio === 'undefined') return; // Node上のテスト等、<audio>非対応環境では何もしない
    this.stopBGM();

    const file = files[Math.floor(Math.random() * files.length)];
    this.currentBgmKey = key;
    this._bgmAudio = new Audio(file);
    this._bgmAudio.loop = true;
    this._bgmAudio.volume = this.bgmVolume;
    this._bgmAudio.play().catch((e) => {
      // ブラウザの自動再生制限(ユーザー操作前は再生できない等)で失敗する
      // ことがあるが、ゲーム進行自体は継続できるよう握りつぶす。
      console.warn('[SoundSystem] BGMの再生に失敗しました。', e);
    });
  }

  stopBGM() {
    this.currentBgmKey = null;
    if (this._bgmAudio) {
      this._bgmAudio.pause();
      this._bgmAudio.currentTime = 0;
      this._bgmAudio = null;
    }
  }
}

// アプリ全体で1つのAudioContextを共有するシングルトン
export const soundSystem = new SoundSystem();
