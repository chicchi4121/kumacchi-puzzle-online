/**
 * TitleScene.js
 * ------------------------------------------------------------
 * タイトル画面。「ゲーム開始」「ランキング」「設定」「VRM変更」への
 * 導線を表示する。
 *
 * 「ゲーム開始」→LobbyScene: 参加人数・人間プレイヤー数(ローカルPVP、
 * 同一キーボードでのホットシート対戦)・AI難易度・制限時間を選んで対戦する。
 * 「オンライン対戦」→OnlineLobbyScene: Supabase Realtime経由で別々の
 * 端末・ブラウザから対戦する(部屋の作成・コード入力での参加)。
 * 「ランキング」→RankingScene: Supabase(未設定時はこの端末のローカル
 * 履歴)から対戦結果ランキングを表示する。
 *
 * Phase2では「設定」画面（BGM/SE音量調整、Save.js経由で永続化）を実装する。
 * Phase3の第一歩として「VRM変更」でのVRMファイルアップロードにも対応した
 * （アップロード後の実際の見た目差し替えはGameScene側でVRMSystem経由で行う）。
 * ファイル本体はサイズの都合上このブラウザタブ内でのみ保持し、LocalStorage
 * にはファイル名のみ保存する（Save.js）。
 * ------------------------------------------------------------
 */
import { SCENE_KEYS } from '../constants/GameConstants.js';
import { soundSystem } from '../systems/SoundSystem.js';
import { vrmSystem } from '../systems/VRMSystem.js';
import { Save } from '../utils/Save.js';
import { computeUIScale, scaledFontPx } from '../utils/ResponsiveUI.js';

const VRM_FILE_INPUT_ID = 'kumacchi-vrm-file-input';

// 「トップ画面.pngをトップ画面にしてほしい」への対応: 従来はテキストのみ
// だったタイトルを、アップロードされたロゴ画像(くまっちBOM!のキャラ
// イラスト付きロゴ)に差し替える。画像自体に既にタイトル文字が描かれて
// いるため、旧来のテキストタイトルは削除し、この画像をその代わりとして
// 表示する。
const TITLE_LOGO_KEY = 'titleLogo';
const TITLE_LOGO_PATH = 'assets/images/title/title_logo.png';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.TITLE });
  }

  preload() {
    this.load.image(TITLE_LOGO_KEY, TITLE_LOGO_PATH);
  }

  create() {
    // GameSceneはScale.RESIZEでブラウザの実サイズいっぱいに表示される
    // (main.js参照)ため、固定のSCREEN_WIDTH/HEIGHTではなくその時点の
    // 実サイズ(this.scale.width/height)を基準に中央揃えする。
    const centerX = this.scale.width / 2;
    soundSystem.playBGM('title');
    // 「スマホでもプレイできるように」への対応: 画面の実サイズから縮小率を
    // 算出し、以降のy座標・フォントサイズに一律で乗算する
    // (ResponsiveUI.computeUIScale参照)。
    this._uiScale = computeUIScale(this.scale.width, this.scale.height);
    const s = this._uiScale;

    // ロゴ画像(正方形)を画面上部中央に表示する。画面幅に対して大きくなり
    // すぎないよう、幅の上限も設ける(スマホの縦長画面での見切れ防止)。
    const logoCenterY = 110 * s;
    const maxLogoDisplayWidth = Math.min(260 * s, this.scale.width * 0.82);
    if (this.textures.exists(TITLE_LOGO_KEY)) {
      const logo = this.add.image(centerX, logoCenterY, TITLE_LOGO_KEY).setOrigin(0.5);
      const scaleFactor = maxLogoDisplayWidth / logo.width;
      logo.setScale(scaleFactor);
    } else {
      // 画像の読み込みに失敗した場合は、従来のテキストタイトルにフォールバックする。
      this.add.text(centerX, logoCenterY, 'くまっちボム！', { fontSize: scaledFontPx(40, s), color: '#ffffff' }).setOrigin(0.5);
    }

    // ロゴ画像はテキストタイトルより縦に大きいため、以降のメニュー項目は
    // ロゴの下に十分な余白を空けて配置する(以前のテキストタイトル時の
    // 各項目位置に、ロゴ分の追加オフセットを加えたもの)。
    const menuTop = 215 * s;

    this._createMenuButton(centerX, menuTop, 'ゲーム開始', () => {
      soundSystem.playSE('button');
      this.scene.start(SCENE_KEYS.LOBBY);
    });

    this._createMenuButton(centerX, menuTop + 55 * s, 'オンライン対戦', () => {
      soundSystem.playSE('button');
      this.scene.start(SCENE_KEYS.ONLINE_LOBBY);
    });

    this._createMenuButton(centerX, menuTop + 110 * s, 'ランキング', () => {
      soundSystem.playSE('button');
      this.scene.start(SCENE_KEYS.RANKING);
    });

    this._createMenuButton(centerX, menuTop + 165 * s, '設定', () => {
      soundSystem.playSE('button');
      this._toggleSettingsPanel();
    });

    this._createMenuButton(centerX, menuTop + 220 * s, 'VRM変更', () => {
      soundSystem.playSE('button');
      this._openVrmFilePicker();
    });

    this.vrmStatusText = this.add
      .text(centerX, menuTop + 253 * s, this._getVrmStatusLabel(), { fontSize: scaledFontPx(13, s), color: '#88ddaa' })
      .setOrigin(0.5);

    this.add
      .text(centerX, this.scale.height - 30 * s, '操作: ↑↓←→/仮想十字キー 移動 / Space/💣ボタン 爆弾設置 / Esc/⏸ ポーズ', {
        fontSize: scaledFontPx(14, s),
        color: '#aaaaaa',
      })
      .setOrigin(0.5);

    this._createSettingsPanel(centerX, menuTop + 285 * s);
  }

  _getVrmStatusLabel() {
    if (vrmSystem.hasCustomVrm()) return `使用中のVRM: ${vrmSystem.customFileName}`;
    const saved = Save.getVrmInfo();
    if (saved?.fileName) return `使用中のVRM: ${saved.fileName}（再アップロードが必要です）`;
    return '使用中のVRM: デフォルト（くまっち）';
  }

  /**
   * ブラウザのファイル選択ダイアログを開き、選択された.vrmファイルを
   * VRMSystemに渡す。Phaserはcanvas描画のため、ネイティブのファイル
   * ダイアログは隠しHTML要素(<input type="file">)経由で呼び出す。
   */
  _openVrmFilePicker() {
    let input = document.getElementById(VRM_FILE_INPUT_ID);
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.vrm';
      input.id = VRM_FILE_INPUT_ID;
      input.style.display = 'none';
      document.body.appendChild(input);
    }

    // 前回と同じファイルを選び直しても'change'が発火するようにリセットしておく
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const arrayBuffer = await file.arrayBuffer();
        vrmSystem.setCustomVrm(arrayBuffer, file.name);
        Save.setVrmInfo({ fileName: file.name });
        this.vrmStatusText.setText(this._getVrmStatusLabel());
      } catch (e) {
        console.warn('[TitleScene] VRMファイルの読み込みに失敗しました。', e);
        this.vrmStatusText.setText('VRMファイルの読み込みに失敗しました');
      }
    };
    input.click();
  }

  _createMenuButton(x, y, label, onClick, disabled = false) {
    const s = this._uiScale ?? 1;
    const text = this.add
      .text(x, y, label, {
        fontSize: scaledFontPx(22, s),
        color: disabled ? '#666666' : '#ffffff',
        backgroundColor: disabled ? '#222222' : '#3a3a3a',
        padding: { x: Math.round(16 * s), y: Math.round(8 * s) },
      })
      .setOrigin(0.5);

    if (disabled) return text;

    text.setInteractive({ useHandCursor: true });
    text.on('pointerover', () => text.setStyle({ backgroundColor: '#55606e' }));
    text.on('pointerout', () => text.setStyle({ backgroundColor: '#3a3a3a' }));
    text.on('pointerdown', onClick);
    return text;
  }

  /**
   * BGM/SE音量調整・プレイヤー名設定を行う簡易設定パネル（Save.js経由で永続化）。
   * 「スマホでもプレイできるように」への対応: パネル幅・内部の行オフセット
   * にもthis._uiScaleを適用し、狭い画面でパネルが画面外にはみ出さないようにする。
   */
  _createSettingsPanel(x, y) {
    const { bgm, se } = soundSystem.getVolume();
    const s = this._uiScale ?? 1;

    this.settingsContainer = this.add.container(x, y);
    this.settingsContainer.setVisible(false);

    const bg = this.add.rectangle(0, 55 * s, 360 * s, 150 * s, 0x000000, 0.55);
    this.bgmRow = this._createVolumeRow(0, 0, 'BGM音量', bgm, (v) => soundSystem.setVolume('bgm', v));
    this.seRow = this._createVolumeRow(0, 45 * s, 'SE音量', se, (v) => soundSystem.setVolume('se', v));
    this.nameRow = this._createPlayerNameRow(0, 95 * s);

    this.settingsContainer.add([bg, this.bgmRow.container, this.seRow.container, this.nameRow.container]);
  }

  /**
   * ランキング(RankingScene/RankingSystem)に記録する際の表示名を設定する行。
   * このゲームには専用のログイン機構が無いため、ブラウザ標準のprompt()で
   * 簡易的に入力してもらう(Save.getPlayerName/setPlayerName経由で永続化)。
   */
  _createPlayerNameRow(x, y) {
    const s = this._uiScale ?? 1;
    const container = this.add.container(x, y);
    const labelText = this.add.text(-170 * s, 0, 'ランキング表示名', { fontSize: scaledFontPx(16, s), color: '#ffffff' }).setOrigin(0, 0.5);
    const valueText = this.add
      .text(60 * s, 0, Save.getPlayerName(), { fontSize: scaledFontPx(16, s), color: '#ffe066' })
      .setOrigin(0.5);
    const editBtn = this.add
      .text(150 * s, 0, '変更', { fontSize: scaledFontPx(16, s), color: '#ffffff', backgroundColor: '#3a3a3a', padding: { x: 10, y: 2 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    editBtn.on('pointerdown', () => {
      soundSystem.playSE('button');
      const input = window.prompt('ランキングに表示する名前を入力してください(最大12文字)', Save.getPlayerName());
      if (!input) return;
      const name = input.trim().slice(0, 12) || 'プレイヤー';
      Save.setPlayerName(name);
      valueText.setText(name);
    });

    container.add([labelText, valueText, editBtn]);
    return { container };
  }

  _createVolumeRow(x, y, label, initialValue, onChange) {
    const s = this._uiScale ?? 1;
    const container = this.add.container(x, y);
    let value = initialValue;

    const labelText = this.add.text(-170 * s, 0, label, { fontSize: scaledFontPx(16, s), color: '#ffffff' }).setOrigin(0, 0.5);
    const valueText = this.add
      .text(80 * s, 0, `${Math.round(value * 100)}%`, { fontSize: scaledFontPx(16, s), color: '#ffe066' })
      .setOrigin(0.5);

    const minusBtn = this._createStepperButton(30 * s, 0, '-', () => {
      value = Math.max(0, Math.round((value - 0.1) * 10) / 10);
      valueText.setText(`${Math.round(value * 100)}%`);
      onChange(value);
    });
    const plusBtn = this._createStepperButton(130 * s, 0, '+', () => {
      value = Math.min(1, Math.round((value + 0.1) * 10) / 10);
      valueText.setText(`${Math.round(value * 100)}%`);
      onChange(value);
    });

    container.add([labelText, valueText, minusBtn, plusBtn]);
    return { container };
  }

  _createStepperButton(x, y, label, onClick) {
    const s = this._uiScale ?? 1;
    const btn = this.add
      .text(x, y, label, {
        fontSize: scaledFontPx(18, s),
        color: '#ffffff',
        backgroundColor: '#3a3a3a',
        padding: { x: 10, y: 2 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => {
      soundSystem.playSE('button');
      onClick();
    });
    return btn;
  }

  _toggleSettingsPanel() {
    this.settingsContainer.setVisible(!this.settingsContainer.visible);
  }
}
