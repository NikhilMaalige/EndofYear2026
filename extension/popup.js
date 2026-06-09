document.querySelectorAll('[data-label]').forEach(btn => {
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LABEL', label: btn.dataset.label });
    document.getElementById('label-feedback').textContent = `Logged: ${btn.dataset.label}`;
    setTimeout(() => document.getElementById('label-feedback').textContent = '', 2000);
  });
});

document.getElementById('set-goal').addEventListener('click', () => {
  const goal = document.getElementById('goal-input').value.trim();
  if (goal) {
    chrome.runtime.sendMessage({ type: 'SET_GOAL', goal });
    chrome.storage.local.set({ currentGoal: goal });
    document.getElementById('goal-input').value = '';
    document.getElementById('label-feedback').textContent = 'Goal set!';
    setTimeout(() => document.getElementById('label-feedback').textContent = '', 2000);
  }
});

chrome.storage.local.get(['currentGoal'], (r) => {
  if (r.currentGoal) document.getElementById('goal-input').placeholder = r.currentGoal;
});

chrome.runtime.sendMessage({ type: 'GET_STATE' });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    document.getElementById('status').textContent = msg.state.toUpperCase();
    document.getElementById('status').className = `status-badge ${msg.state}`;
    if (msg.stats) {
      document.getElementById('stats').innerHTML = `
        <div>Tab switches (5m): ${msg.stats.tabSwitches}</div>
        <div>Scroll velocity: ${msg.stats.avgVel}</div>
        <div>Session: ${msg.stats.sessionMinutes}m</div>
      `;
    }
  }
});
