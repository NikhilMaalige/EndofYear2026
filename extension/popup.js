document.querySelectorAll('[data-label]').forEach(btn => {
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LABEL', label: btn.dataset.label });
    document.getElementById('label-feedback').textContent = `Logged: ${btn.dataset.label}`;
    setTimeout(() => document.getElementById('label-feedback').textContent = '', 2000);
  });
});

function updateGoalDisplay(goal) {
  const display = document.getElementById('current-goal-display');
  if (goal) {
    display.innerHTML = `Working on: <strong>${goal}</strong>`;
    display.style.borderLeftColor = '#4ade80';
  } else {
    display.textContent = 'Not set';
    display.style.borderLeftColor = '#60a5fa';
  }
}

document.getElementById('set-goal').addEventListener('click', () => {
  const goal = document.getElementById('goal-input').value.trim();
  if (goal) {
    chrome.runtime.sendMessage({ type: 'SET_GOAL', goal });
    chrome.storage.local.set({ currentGoal: goal });
    document.getElementById('goal-input').value = '';
    updateGoalDisplay(goal);
    document.getElementById('label-feedback').textContent = 'Goal set!';
    setTimeout(() => document.getElementById('label-feedback').textContent = '', 2000);
  }
});

chrome.storage.local.get(['currentGoal'], (r) => {
  updateGoalDisplay(r.currentGoal);
});

chrome.runtime.sendMessage({ type: 'GET_STATE' });
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    let text = msg.state.toUpperCase();
    if (msg.state === 'drifting') text = '⚠️ ' + text;
    if (msg.state === 'gone') text = '🚨 ' + text;
    if (msg.state === 'focused') text = '🎯 ' + text;

    document.getElementById('status').textContent = text;
    document.getElementById('status').className = `status-badge ${msg.state}`;
    
    if (msg.state === 'drifting') document.body.style.boxShadow = 'inset 0 0 20px rgba(251, 191, 36, 0.4)';
    else if (msg.state === 'gone') document.body.style.boxShadow = 'inset 0 0 20px rgba(248, 113, 113, 0.4)';
    else document.body.style.boxShadow = 'none';
    if (msg.stats) {
      document.getElementById('stats').innerHTML = `
        <div>Tab switches (5m): ${msg.stats.tabSwitches}</div>
        <div>Scroll velocity: ${msg.stats.avgVel}</div>
        <div>Session: ${msg.stats.sessionMinutes}m</div>
      `;
    }
  }
});
