// ==========================================================
// ランキング画面: Supabaseからスコア/タイムを取得して表示する
// ソロプレイ: スコア降順(プレイ時間も表示)、名前ごとに自己ベストのみ
// AI対戦: 難易度ごとに、勝利までのタイム昇順(タイムのみ表示)、名前ごとに自己ベストのみ
// ==========================================================

const listPanel = document.getElementById('list-panel');
const tabSolo = document.getElementById('tab-solo');
const tabBattle = document.getElementById('tab-battle');
const diffTabs = document.getElementById('diff-tabs');
const diffLabelEl = document.getElementById('diff-label');
const refreshBtn = document.getElementById('refresh-btn');

let currentMode = 'solo';
let currentDifficulty = 'easy';
let requestToken = 0; // 連打で古い結果が後から表示されるのを防ぐためのトークン

const DIFF_LABELS = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD', master: 'MASTER' };

function showMessage(html) {
  listPanel.innerHTML = `<div class="state-msg">${html}</div>`;
}

function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return '-';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadRanking() {
  const myToken = ++requestToken;

  tabSolo.classList.toggle('active', currentMode === 'solo');
  tabBattle.classList.toggle('active', currentMode === 'battle');
  diffTabs.style.display = currentMode === 'battle' ? 'flex' : 'none';
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.diff === currentDifficulty);
  });
  diffLabelEl.textContent = currentMode === 'battle'
    ? `AI対戦ランキング - ${DIFF_LABELS[currentDifficulty]}`
    : 'ソロプレイランキング';

  if (!supabaseClient) {
    showMessage('Supabaseがまだ設定されていません。<br>src/js/supabase-config.js にURLとanon keyを設定してください。');
    return;
  }

  showMessage('読み込み中...');

  let query = supabaseClient.from('scores').select('name, score, level, duration_seconds').eq('mode', currentMode);

  if (currentMode === 'battle') {
    query = query.eq('difficulty', currentDifficulty).order('duration_seconds', { ascending: true });
  } else {
    query = query.order('score', { ascending: false });
  }

  const { data, error } = await query.limit(20);

  // 別のタブ操作が既に行われていたら、この古い結果は無視する
  if (myToken !== requestToken) return;

  if (error) {
    showMessage('ランキングの取得に失敗しました。<br>時間をおいてもう一度お試しください。');
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    showMessage('まだ記録がありません。<br>最初のランキング入りを目指そう!');
    return;
  }

  if (currentMode === 'battle') {
    listPanel.innerHTML = data.map((row, i) => `
      <div class="row">
        <div class="rank">${i + 1}</div>
        <div class="name">${escapeHtml(row.name)}</div>
        <div class="score">${formatDuration(row.duration_seconds)}</div>
      </div>
    `).join('');
  } else {
    listPanel.innerHTML = data.map((row, i) => `
      <div class="row">
        <div class="rank">${i + 1}</div>
        <div class="name">${escapeHtml(row.name)}</div>
        <div class="level-badge">${formatDuration(row.duration_seconds)}</div>
        <div class="score">${row.score}</div>
      </div>
    `).join('');
  }
}

tabSolo.addEventListener('click', () => { currentMode = 'solo'; loadRanking(); });
tabBattle.addEventListener('click', () => { currentMode = 'battle'; loadRanking(); });
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => { currentDifficulty = btn.dataset.diff; loadRanking(); });
});
refreshBtn.addEventListener('click', () => loadRanking());

loadRanking();
