/**
 * PauseScene.js
 * ------------------------------------------------------------
 * Escキーで呼び出されるポーズ画面。GameSceneの上にオーバーレイ表示し、
 * 再開または降参してタイトルへ戻る導線を提供する。
 * ------------------------------------------------------------
 */
import { SCENE_KEYS } from '../constants/GameConstants.js';
import { soundSystem } from '../systems/SoundSystem.js';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.PAUSE });
  }

  create() {
    // GameSceneはScale.RESIZEモードでブラウザの実サイズに合わせて画面全体を
    // 使う(main.js/GameScene.js参照)ため、固定のSCREEN_WIDTH/SCREEN_HEIGHT
    // ではなく、その時点の実サイズ(this.scale.width/height)を使って
    // オーバーレイ・中央のボタンを配置する(そうしないと画面の一部にしか
    // 暗幕がかからず、ボタンも画面中央からズレて表示されてしまう)。
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    const overlay = this.add.rectangle(0, 0, screenWidth, screenHeight, 0x000000, 0.6);
    overlay.setOrigin(0, 0);

    this.add
      .text(screenWidth / 2, screenHeight / 2 - 40, 'ポーズ中', {
        fontSize: '32px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    const resumeText = this.add
      .text(screenWidth / 2, screenHeight / 2 + 20, '再開する (Esc)', {
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#3a3a3a',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    resumeText.on('pointerdown', () => {
      soundSystem.playSE('button');
      this._resume();
    });

    const titleText = this.add
      .text(screenWidth / 2, screenHeight / 2 + 70, 'タイトルに戻る', {
        fontSize: '20px',
        color: '#ffffff',
        backgroundColor: '#3a3a3a',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    titleText.on('pointerdown', () => {
      soundSystem.playSE('button');
      this._backToTitle();
    });

    this.input.keyboard.once('keydown-ESC', () => this._resume());
  }

  _resume() {
    this.scene.stop();
    this.scene.resume(SCENE_KEYS.GAME);
  }

  _backToTitle() {
    soundSystem.stopBGM();
    this.scene.stop(SCENE_KEYS.GAME);
    this.scene.stop();
    this.scene.start(SCENE_KEYS.TITLE);
  }
}
