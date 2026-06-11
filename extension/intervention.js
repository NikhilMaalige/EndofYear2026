(function () {
  let fadeInterval = null;
  let fadeOpacity = 0;
  let currentState = 'focused';
  let catchTimeout = null;
  let fadeDelayTimeout = null;

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-ag-theme', theme || 'dark');
  }

  chrome.storage.local.get(['agTheme'], (r) => applyTheme(r.agTheme || 'dark'));
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.agTheme) applyTheme(changes.agTheme.newValue);
  });

  function createOverlays() {
    if (document.getElementById('ag-fade-overlay')) return;

    const fade = document.createElement('div');
    fade.id = 'ag-fade-overlay';
    document.body.appendChild(fade);

    const catchEl = document.createElement('div');
    catchEl.id = 'ag-catch';
    catchEl.innerHTML = `
      <div class="ag-catch-icon">◉</div>
      <div class="ag-catch-body">
        <div class="ag-catch-label">Off track</div>
        <div class="ag-catch-msg" id="ag-catch-msg">You might be drifting.</div>
        <div class="ag-catch-sub" id="ag-catch-sub"></div>
      </div>
      <button class="ag-catch-dismiss" id="ag-catch-close" aria-label="Dismiss">×</button>`;
    document.body.appendChild(catchEl);
    document.getElementById('ag-catch-close').addEventListener('click', hideCatch);

    const mirror = document.createElement('div');
    mirror.id = 'ag-mirror-overlay';
    mirror.innerHTML = `<div id="ag-mirror-card">
      <div class="ag-mirror-header">
        <span class="ag-mirror-badge">Attention</span>
        <h2>Take a breath.</h2>
      </div>
      <div id="ag-ai-reason"></div>
      <div id="ag-mirror-stats"></div>
      <div id="ag-recall-section">
        <div id="ag-recall-goal"></div>
        <input type="text" id="ag-recall-input" placeholder="What were you working on?">
      </div>
      <button id="ag-dismiss-btn">Continue</button>
    </div>`;
    document.body.appendChild(mirror);

    document.getElementById('ag-dismiss-btn').addEventListener('click', dismiss);
    document.getElementById('ag-recall-input').addEventListener('input', (e) => {
      document.getElementById('ag-dismiss-btn').disabled = e.target.value.trim().length < 3;
    });
  }

  function showCatch(message, sub) {
    createOverlays();
    const el = document.getElementById('ag-catch');
    if (!el) return;
    document.getElementById('ag-catch-msg').textContent = message || 'You might be drifting.';
    const subEl = document.getElementById('ag-catch-sub');
    subEl.textContent = sub || '';
    subEl.style.display = sub ? 'block' : 'none';
    el.classList.remove('ag-catch-exit');
    requestAnimationFrame(() => el.classList.add('ag-catch-visible'));
    if (catchTimeout) clearTimeout(catchTimeout);
    catchTimeout = setTimeout(hideCatch, 6000);
  }

  function hideCatch() {
    const el = document.getElementById('ag-catch');
    if (!el) return;
    el.classList.remove('ag-catch-visible');
    el.classList.add('ag-catch-exit');
    if (catchTimeout) clearTimeout(catchTimeout);
    setTimeout(() => el.classList.remove('ag-catch-exit'), 320);
  }

  function showToast(message) {
    createOverlays();
    let toast = document.getElementById('ag-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ag-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="ag-toast-dot"></span><span>${message}</span>`;
    toast.classList.remove('ag-toast-show');
    requestAnimationFrame(() => toast.classList.add('ag-toast-show'));
    setTimeout(() => toast.classList.remove('ag-toast-show'), 3500);
  }

  function startFade(delayMs) {
    if (fadeInterval) return;
    const begin = () => {
      fadeOpacity = 0;
      const overlay = document.getElementById('ag-fade-overlay');
      if (!overlay) return;
      overlay.classList.add('ag-fade-active');
      fadeInterval = setInterval(() => {
        fadeOpacity = Math.min(fadeOpacity + 0.012, 0.82);
        overlay.style.opacity = fadeOpacity;
        if (fadeOpacity >= 0.82) {
          clearInterval(fadeInterval);
          fadeInterval = null;
          showMirror(false);
        }
      }, 1000);
    };
    if (delayMs > 0) {
      if (fadeDelayTimeout) clearTimeout(fadeDelayTimeout);
      fadeDelayTimeout = setTimeout(begin, delayMs);
    } else {
      begin();
    }
  }

  function stopFade() {
    if (fadeDelayTimeout) { clearTimeout(fadeDelayTimeout); fadeDelayTimeout = null; }
    if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }
    fadeOpacity = 0;
    const overlay = document.getElementById('ag-fade-overlay');
    if (overlay) {
      overlay.style.opacity = 0;
      overlay.classList.remove('ag-fade-active');
    }
  }

  function showMirror(withRecall) {
    createOverlays();
    hideCatch();
    const mirror = document.getElementById('ag-mirror-overlay');
    mirror.style.display = 'flex';
    requestAnimationFrame(() => mirror.classList.add('ag-mirror-open'));
    chrome.runtime.sendMessage({ type: 'GET_STATE' });

    chrome.runtime.onMessage.addListener(function handler(msg) {
      if (msg.type === 'STATE_UPDATE' && msg.stats) {
        const s = msg.stats;
        const reasonDiv = document.getElementById('ag-ai-reason');
        if (msg.reason) {
          reasonDiv.innerHTML = `<p class="ai-reason">${msg.reason}</p>` +
            (msg.suggestion ? `<p class="ai-suggestion">${msg.suggestion}</p>` : '');
          reasonDiv.style.display = 'block';
        } else {
          reasonDiv.style.display = 'none';
        }

        const driftPct = typeof msg.driftScore === 'number'
          ? Math.round((msg.driftScore <= 1 ? msg.driftScore * 100 : msg.driftScore))
          : (s.driftScore ?? 0);
        const driftLabel = msg.driftSource === 'gemini' ? ' (AI calibrated)'
          : msg.driftSource === 'hybrid' ? ' (AI adjusted)' : '';
        const comps = msg.components || {};
        const compRows = Object.entries(comps)
          .filter(([, v]) => v > 0.08)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `<div class="ag-stat-row ag-stat-sub"><span>${k.replace(/_/g, ' ')}</span><span>${Math.round(v * 100)}%</span></div>`)
          .join('');

        document.getElementById('ag-mirror-stats').innerHTML =
          `<div class="ag-stat-row ag-stat-highlight"><span>Drift score${driftLabel}</span><span>${driftPct}%</span></div>` +
          `<div class="ag-stat-row"><span>Tab switches/min</span><span>${s.tabSwitchesPerMin ?? '—'} <small>(20+ drifting)</small></span></div>` +
          `<div class="ag-stat-row"><span>Idle time</span><span>${s.idleSeconds ?? 0}s</span></div>` +
          `<div class="ag-stat-row"><span>Scroll velocity</span><span>${s.avgVel}</span></div>` +
          `<div class="ag-stat-row"><span>Session</span><span>${s.sessionMinutes} min</span></div>` +
          (compRows ? `<div class="ag-stat-divider"></div>${compRows}` : '');
        chrome.runtime.onMessage.removeListener(handler);
      }
    });

    const recallSection = document.getElementById('ag-recall-section');
    const dismissBtn = document.getElementById('ag-dismiss-btn');
    if (withRecall) {
      recallSection.style.display = 'block';
      dismissBtn.disabled = true;
      chrome.storage.local.get(['currentGoal'], (r) => {
        const goalEl = document.getElementById('ag-recall-goal');
        goalEl.innerHTML = r.currentGoal
          ? `Your goal: <strong>${r.currentGoal}</strong>`
          : 'No goal set — what were you trying to do?';
      });
    } else {
      recallSection.style.display = 'none';
      dismissBtn.disabled = false;
    }
  }

  function hideMirror() {
    const mirror = document.getElementById('ag-mirror-overlay');
    if (!mirror) return;
    mirror.classList.remove('ag-mirror-open');
    setTimeout(() => { mirror.style.display = 'none'; }, 350);
  }

  function dismiss() {
    hideMirror();
    stopFade();
    const recall = document.getElementById('ag-recall-input');
    const action = recall && recall.value.trim() ? 'recalled' : 'dismissed';
    chrome.runtime.sendMessage({
      type: 'INTERVENTION_RESULT',
      data: {
        type: currentState === 'gone' ? 'mirror+recall' : 'fade',
        action,
        state_before: currentState,
        state_after: 'focused',
        timestamp: Date.now(),
      },
    });
    if (recall) recall.value = '';
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_CHANGE') {
      createOverlays();
      currentState = msg.state;

      if (msg.state === 'focused') {
        stopFade();
        hideMirror();
        hideCatch();
      } else if (msg.state === 'drifting') {
        hideMirror();
      } else if (msg.state === 'gone') {
        stopFade();
        hideCatch();
        showMirror(true);
      }
    }

    if (msg.type === 'OFF_TRACK_CATCH') {
      showCatch(msg.message, msg.sub);
      if (msg.startFade) startFade(msg.fadeDelay || 4500);
    }

    if (msg.type === 'SHOW_TOAST') {
      showToast(msg.message || 'Nice catch');
    }
  });

  createOverlays();
})();
