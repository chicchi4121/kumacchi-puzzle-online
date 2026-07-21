// タイトル画面: 背景に降ってくるブロックを生成
(function initFallingBlocks() {
  const colors = ['#EF5B5B', '#3E92CC', '#FFD23F', '#5FAD56', '#9B6BCC'];
  const container = document.getElementById('blocks');
  const COUNT = 22;

  for (let i = 0; i < COUNT; i++) {
    const b = document.createElement('div');
    b.className = 'block';
    b.style.background = colors[i % colors.length];
    b.style.left = Math.random() * 100 + 'vw';

    const duration = 6 + Math.random() * 8;
    b.style.animationDuration = duration + 's';
    b.style.animationDelay = -Math.random() * duration + 's';

    const size = 26 + Math.random() * 26;
    b.style.width = size + 'px';
    b.style.height = size + 'px';

    container.appendChild(b);
  }
})();

// スタートボタン: ゲーム画面へ遷移
document.getElementById('start-btn').addEventListener('click', () => {
  window.location.href = 'game.html';
});

// AI対戦ボタン: AI対戦モードへ遷移
document.getElementById('battle-btn').addEventListener('click', () => {
  window.location.href = 'battle.html';
});

// オンライン対戦ボタン: オンライン対戦モードへ遷移
document.getElementById('online-btn').addEventListener('click', () => {
  window.location.href = 'online.html';
});

// タイトルBGM: 開いた瞬間に自動再生する
// (ブラウザは「音あり」の自動再生をブロックすることが多いが、
//  「ミュートで再生開始→再生が始まってからミュート解除」は多くのブラウザで許可される)
const bgm = document.getElementById('bgm');
const soundToggle = document.getElementById('sound-toggle');
bgm.volume = 0.3;

function updateSoundIcon() {
  soundToggle.textContent = (!bgm.paused && !bgm.muted) ? '🔊' : '🔈';
}

function tryPlayBgm() {
  bgm.muted = true;
  const p = bgm.play();
  if (p && p.then) {
    p.then(() => {
      // 再生が始まったのでミュート解除(多くのブラウザでここは追加の操作なしで通る)
      bgm.muted = false;
      updateSoundIcon();
    }).catch(() => {
      // それでもブロックされた場合のみ、最初のユーザー操作で再生する
      bgm.muted = false;
      const resumeOnInteraction = () => {
        bgm.play().then(updateSoundIcon).catch(() => {});
        document.removeEventListener('click', resumeOnInteraction);
        document.removeEventListener('keydown', resumeOnInteraction);
        document.removeEventListener('touchstart', resumeOnInteraction);
      };
      document.addEventListener('click', resumeOnInteraction, { once: true });
      document.addEventListener('keydown', resumeOnInteraction, { once: true });
      document.addEventListener('touchstart', resumeOnInteraction, { once: true });
    });
  }
}
tryPlayBgm();

soundToggle.addEventListener('click', () => {
  if (bgm.paused) {
    bgm.muted = false;
    bgm.play().then(updateSoundIcon).catch(() => {});
  } else {
    bgm.pause();
    updateSoundIcon();
  }
});
