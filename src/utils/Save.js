/**
 * Save.js
 * ------------------------------------------------------------
 * ブラウザLocalStorageへの保存・読込を担当するモジュール。
 * 保存内容: 設定 / キー配置 / VRM / 音量 / ランキングキャッシュ
 * データ管理をゲームロジックから分離するため、他のクラスは
 * 直接localStorageを触らずこのモジュール経由でアクセスすること。
 * ------------------------------------------------------------
 */

const STORAGE_PREFIX = 'kumacchi-bomb:';

const KEYS = Object.freeze({
  SETTINGS: `${STORAGE_PREFIX}settings`,
  KEY_BINDINGS: `${STORAGE_PREFIX}keyBindings`,
  VRM: `${STORAGE_PREFIX}vrm`,
  VOLUME: `${STORAGE_PREFIX}volume`,
  RANKING_CACHE: `${STORAGE_PREFIX}rankingCache`,
  PLAYER_NAME: `${STORAGE_PREFIX}playerName`,
});

export class Save {
  static _isAvailable() {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch (e) {
      return false;
    }
  }

  static _get(key, fallback) {
    if (!Save._isAvailable()) return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn(`[Save] 読込に失敗しました: ${key}`, e);
      return fallback;
    }
  }

  static _set(key, value) {
    if (!Save._isAvailable()) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`[Save] 保存に失敗しました: ${key}`, e);
    }
  }

  static getSettings() {
    return Save._get(KEYS.SETTINGS, { bgmVolume: 0.8, seVolume: 0.8 });
  }

  static setSettings(settings) {
    Save._set(KEYS.SETTINGS, settings);
  }

  static getKeyBindings() {
    return Save._get(KEYS.KEY_BINDINGS, null); // nullの場合はデフォルト操作を使用
  }

  static setKeyBindings(bindings) {
    Save._set(KEYS.KEY_BINDINGS, bindings);
  }

  static getVrmInfo() {
    return Save._get(KEYS.VRM, null);
  }

  static setVrmInfo(vrmInfo) {
    Save._set(KEYS.VRM, vrmInfo);
  }

  static getVolume() {
    return Save._get(KEYS.VOLUME, { bgm: 0.8, se: 0.8 });
  }

  static setVolume(volume) {
    Save._set(KEYS.VOLUME, volume);
  }

  static getRankingCache() {
    return Save._get(KEYS.RANKING_CACHE, []);
  }

  static setRankingCache(rankingList) {
    Save._set(KEYS.RANKING_CACHE, rankingList);
  }

  /** ランキング・オンライン対戦で表示する名前(未設定時は「プレイヤー」) */
  static getPlayerName() {
    return Save._get(KEYS.PLAYER_NAME, 'プレイヤー');
  }

  static setPlayerName(name) {
    Save._set(KEYS.PLAYER_NAME, name);
  }
}
