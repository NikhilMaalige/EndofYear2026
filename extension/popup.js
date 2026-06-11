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

chrome.runtime.sendMessage({ type: 'GET_STATE' });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    const labels = { focused: 'Focused', drifting: 'Drifting', gone: 'Off track' };
    document.getElementById('status').textContent = labels[msg.state] || msg.state;
    document.getElementById('status').className = `status-badge ${msg.state}`;

    if (msg.stats) {
      document.getElementById('stats').innerHTML = `
        <div class="stat-item"><div class="val">${msg.stats.tabSwitches}</div><div class="lbl">Tabs</div></div>
        <div class="stat-item"><div class="val">${msg.stats.avgVel}</div><div class="lbl">Scroll</div></div>
        <div class="stat-item"><div class="val">${msg.stats.sessionMinutes}m</div><div class="lbl">Session</div></div>`;
    }
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
