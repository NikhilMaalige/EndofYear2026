(function() {
  let fadeInterval = null, fadeOpacity = 0, currentState = 'focused';

  function createOverlays() {
    if (document.getElementById('ag-fade-overlay')) return;
    const fade = document.createElement('div');
    fade.id = 'ag-fade-overlay';
    document.body.appendChild(fade);

    const mirror = document.createElement('div');
    mirror.id = 'ag-mirror-overlay';
    mirror.innerHTML = `<div id="ag-mirror-card">
      <h2>👁️ Hey. Look at this.</h2>
      <div id="ag-mirror-stats"></div>
      <div id="ag-recall-section">
        <div id="ag-recall-goal"></div>
        <input type="text" id="ag-recall-input" placeholder="What were you trying to do?">
      </div>
      <button id="ag-dismiss-btn">I'm good, let me back</button>
    </div>`;
    document.body.appendChild(mirror);

    document.getElementById('ag-dismiss-btn').addEventListener('click', dismiss);
    document.getElementById('ag-recall-input').addEventListener('input', (e) => {
      document.getElementById('ag-dismiss-btn').disabled = e.target.value.trim().length < 3;
    });
  }

  function startFade() {
    if (fadeInterval) return;
    fadeOpacity = 0;
    const overlay = document.getElementById('ag-fade-overlay');
    if (!overlay) return;
    fadeInterval = setInterval(() => {
      fadeOpacity = Math.min(fadeOpacity + 0.015, 0.85);
      overlay.style.opacity = fadeOpacity;
      if (fadeOpacity >= 0.85) {
        clearInterval(fadeInterval);
        fadeInterval = null;
        showMirror(false);
      }
    }, 1000);
  }

  function stopFade() {
    if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }
    fadeOpacity = 0;
    const overlay = document.getElementById('ag-fade-overlay');
    if (overlay) overlay.style.opacity = 0;
  }

  function showMirror(withRecall) {
    createOverlays();
    const mirror = document.getElementById('ag-mirror-overlay');
    mirror.style.display = 'flex';
    chrome.runtime.sendMessage({ type: 'GET_STATE' });

    chrome.runtime.onMessage.addListener(function handler(msg) {
      if (msg.type === 'STATE_UPDATE' && msg.stats) {
        const s = msg.stats;
        document.getElementById('ag-mirror-stats').innerHTML =
          `You've switched tabs <span>${s.tabSwitches} times</span> in the last 5 minutes.<br>` +
          `Average scroll velocity: <span>${s.avgVel}</span><br>` +
          `Scroll depth: <span>${Math.round(s.avgScrollDepth * 100)}%</span><br>` +
          `Session duration: <span>${s.sessionMinutes} minutes</span>`;
        chrome.runtime.onMessage.removeListener(handler);
      }
    });

    const recallSection = document.getElementById('ag-recall-section');
    const dismissBtn = document.getElementById('ag-dismiss-btn');
    if (withRecall) {
      recallSection.style.display = 'block';
      dismissBtn.disabled = true;
      chrome.storage.local.get(['currentGoal'], (r) => {
        document.getElementById('ag-recall-goal').textContent = r.currentGoal ? `Your goal was: "${r.currentGoal}"` : 'No goal set — what were you trying to do?';
      });
    } else {
      recallSection.style.display = 'none';
      dismissBtn.disabled = false;
    }
  }

  function dismiss() {
    const mirror = document.getElementById('ag-mirror-overlay');
    if (mirror) mirror.style.display = 'none';
    stopFade();
    const recall = document.getElementById('ag-recall-input');
    const action = recall && recall.value.trim() ? 'recalled' : 'dismissed';
    chrome.runtime.sendMessage({
      type: 'INTERVENTION_RESULT',
      data: { type: currentState === 'gone' ? 'mirror+recall' : 'fade', action, state_before: currentState, state_after: 'focused', timestamp: Date.now() }
    });
    if (recall) recall.value = '';
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_CHANGE') {
      createOverlays();
      const prev = currentState;
      currentState = msg.state;

      if (msg.state === 'focused') {
        stopFade();
        const mirror = document.getElementById('ag-mirror-overlay');
        if (mirror) mirror.style.display = 'none';
      } else if (msg.state === 'drifting') {
        startFade();
      } else if (msg.state === 'gone') {
        stopFade();
        showMirror(true);
      }
    }
  });

  createOverlays();
})();
