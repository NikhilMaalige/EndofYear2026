function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle');
  btn.textContent = theme === 'light' ? '☾' : '☀';
  chrome.storage.local.set({ agTheme: theme });
}

chrome.storage.local.get(['agTheme'], (r) => {
  applyTheme(r.agTheme || 'dark');
});

document.getElementById('theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

function showFeedback(text) {
  const el = document.getElementById('label-feedback');
  el.textContent = text;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}

document.querySelectorAll('[data-label]').forEach(btn => {
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LABEL', label: btn.dataset.label });
    showFeedback(`Logged: ${btn.dataset.label}`);
  });
});

function updateGoalDisplay(goal) {
  const display = document.getElementById('current-goal-display');
  if (goal) {
    display.innerHTML = `Working on <strong>${goal}</strong>`;
    display.style.borderLeftColor = 'var(--focused)';
  } else {
    display.textContent = 'Not set';
    display.style.borderLeftColor = 'var(--accent)';
  }
}

document.getElementById('set-goal').addEventListener('click', () => {
  const goal = document.getElementById('goal-input').value.trim();
  if (goal) {
    chrome.runtime.sendMessage({ type: 'SET_GOAL', goal });
    chrome.storage.local.set({ currentGoal: goal });
    document.getElementById('goal-input').value = '';
    updateGoalDisplay(goal);
    showFeedback('Goal updated');
  }
});

chrome.storage.local.get(['currentGoal'], (r) => {
  updateGoalDisplay(r.currentGoal);
});

function updateDriftSource(driftSource) {
  const el = document.getElementById('drift-source');
  if (!el) return;
  const labels = {
    gemini: '· AI calibrated',
    hybrid: '· AI adjusted',
    local: '· local estimate',
  };
  const label = labels[driftSource] || labels.local;
  el.textContent = label;
  el.className = `drift-source ${driftSource === 'local' ? 'local' : ''}`;
}

function updateDriftUI(driftScore, reason, state, driftSource) {
  const displayPct = typeof driftScore === 'number' && driftScore <= 1
    ? Math.round(driftScore * 100)
    : (driftScore ?? 0);

  document.getElementById('drift-value').textContent = `${displayPct}%`;
  const fill = document.getElementById('drift-fill');
  fill.style.width = `${Math.min(displayPct, 100)}%`;
  fill.className = 'drift-fill';
  if (state === 'gone' || displayPct > 64) fill.classList.add('gone');
  else if (state === 'drifting' || displayPct > 34) fill.classList.add('drifting');
  else fill.classList.add('focused');

  updateDriftSource(driftSource || 'local');

  const reasonEl = document.getElementById('drift-reason');
  if (reason && state !== 'focused') {
    reasonEl.textContent = reason;
    reasonEl.style.display = 'block';
  } else {
    reasonEl.textContent = '';
    reasonEl.style.display = 'none';
  }
}

function renderStateUpdate(msg) {
  const labels = { focused: 'Focused', drifting: 'Drifting', gone: 'Off track' };
  document.getElementById('status').textContent = labels[msg.state] || msg.state;
  document.getElementById('status').className = `status-badge ${msg.state}`;

  const driftRaw = msg.driftScore ?? msg.stats?.driftScore ?? 0;
  const driftNorm = driftRaw > 1 ? driftRaw / 100 : driftRaw;
  updateDriftUI(driftNorm, msg.reason, msg.state, msg.driftSource);

  if (msg.stats) {
    const s = msg.stats;
    const top = s.topComponent ? `<div class="stat-item stat-wide"><div class="val stat-sm">${s.topComponent}</div><div class="lbl">Top signal</div></div>` : '';
    document.getElementById('stats').innerHTML = `
      <div class="stat-item"><div class="val">${s.tabSwitchesPerMin ?? '—'}</div><div class="lbl">Tabs/min</div></div>
      <div class="stat-item"><div class="val">${s.idleSeconds ?? 0}s</div><div class="lbl">Idle</div></div>
      <div class="stat-item"><div class="val">${s.avgVel}</div><div class="lbl">Scroll</div></div>
      <div class="stat-item"><div class="val">${s.sessionMinutes}m</div><div class="lbl">Session</div></div>
      ${top}`;
  }
}

chrome.runtime.sendMessage({ type: 'GET_STATE' });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE' || msg.type === 'DRIFT_UPDATE') {
    renderStateUpdate(msg);
  }
});

document.getElementById('snooze-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'SET_SNOOZE', minutes: 30 });
  document.getElementById('snooze-label').textContent = 'Snoozed for 30m';
  document.getElementById('snooze-btn').disabled = true;
  setTimeout(() => {
    document.getElementById('snooze-label').textContent = '';
    document.getElementById('snooze-btn').disabled = false;
  }, 30 * 60 * 1000);
});

chrome.runtime.sendMessage({ type: 'GET_SNOOZE' });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SNOOZE_STATUS' && msg.snoozed) {
    document.getElementById('snooze-label').textContent = `Snoozed (${msg.remainingMinutes}m left)`;
    document.getElementById('snooze-btn').disabled = true;
  }
});

fetch('http://localhost:5000/api/status')
  .then(r => r.json())
  .then(data => {
    const el = document.getElementById('model-status');
    const lc = data.label_counts;
    const trained = data.model_trained
      ? 'Local ML active'
      : (data.ready_to_train ? 'Ready to retrain' : `${lc.total}/10 labels collected`);
    el.textContent = trained;
    el.title = `Focused: ${lc.focused} · Drifting: ${lc.drifting} · Gone: ${lc.gone}`;
  })
  .catch(() => {
    document.getElementById('model-status').textContent = 'Backend offline';
  });
