const DISTRACTING = ['youtube', 'netflix', 'twitter', 'instagram', 'facebook', 'reddit', 'tiktok', 'twitch'];

const state = {
  signals: [],
  tabSwitches: [],
  sessionStart: Date.now(),
  currentState: 'focused',
  currentReason: '',
  currentSuggestion: '',
  lastStates: [],
  recentSites: [],
  snoozeUntil: 0,
  catchShownAt: 0,
  consecutiveDriftSignals: 0,
  lastGoal: '',
};

chrome.storage.local.get(['snoozeUntil', 'currentGoal'], (r) => {
  if (r.snoozeUntil) state.snoozeUntil = r.snoozeUntil;
  if (r.currentGoal) state.lastGoal = r.currentGoal;
});

function isSnoozed() {
  return Date.now() < state.snoozeUntil;
}

function goalRelevance(title, goal) {
  if (!title || !goal) return 0;
  const stop = new Set(['for', 'and', 'the', 'to', 'a', 'in', 'of', 'on', 'is', 'my', 'how', 'what', 'why', 'with']);
  const tw = new Set(title.toLowerCase().split(/\W+/).filter(w => w && !stop.has(w)));
  const gw = goal.toLowerCase().split(/\W+/).filter(w => w && !stop.has(w));
  if (!gw.length) return 0;
  const overlap = gw.filter(w => tw.has(w)).length;
  return overlap / gw.length;
}

function localHeuristic(latest, tabSw, goal) {
  const v = latest.avgScrollVelocity || 0;
  const c = latest.scrollConsistency || 0;
  const m = latest.mouseActivity || 0;
  const url = latest.url || '';
  const title = latest.title || '';
  const sessionMin = (Date.now() - state.sessionStart) / 60000;
  const distracting = DISTRACTING.some(d => url.includes(d));
  const relevance = goalRelevance(title, goal);

  let score = 0;
  if (v > 15) score += 2;
  else if (v > 8) score += 1;
  if (c > 0.7) score += 2;
  if (tabSw > 8) score += 2;
  else if (tabSw > 4) score += 1;
  if (m < 2 && v > 5) score += 1;
  if (sessionMin > 30) score += 1;
  if (distracting) {
    if (goal && relevance < 0.3) score += 4;
    else if (!goal) score += 2;
  } else if (goal && relevance > 0.5) {
    score -= 2;
  }

  let driftState = 'focused';
  if (score >= 5) driftState = 'gone';
  else if (score >= 2) driftState = 'drifting';
  return { score, driftState, distracting, relevance };
}

async function notifyTab(message) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
  }
}

async function logIntervention(data) {
  fetch('http://localhost:5000/api/intervention', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});
}

async function triggerOffTrackCatch(reason, sub, startFade) {
  const now = Date.now();
  if (now - state.catchShownAt < 120000) return;
  state.catchShownAt = now;

  await notifyTab({
    type: 'OFF_TRACK_CATCH',
    message: reason,
    sub,
    startFade,
    fadeDelay: 4500,
  });

  await logIntervention({
    type: 'off_track_catch',
    action: reason,
    state_before: state.currentState,
    state_after: 'drifting',
    timestamp: now,
  });
}

async function handleStateTransition(prev, next, reason, suggestion) {
  if (prev === next) return;

  if (next === 'focused' && (prev === 'drifting' || prev === 'gone')) {
    await notifyTab({ type: 'SHOW_TOAST', message: 'Nice catch — back on track' });
    await logIntervention({
      type: 'realization',
      action: 'returned_to_focus',
      state_before: prev,
      state_after: 'focused',
      timestamp: Date.now(),
    });
  }

  if (prev === 'focused' && (next === 'drifting' || next === 'gone')) {
    const msg = next === 'gone'
      ? "You're deep off track."
      : 'Heads up — you might be drifting.';
    const sub = reason || suggestion || '';
    await triggerOffTrackCatch(msg, sub, next === 'drifting');
  }

  await notifyTab({
    type: 'STATE_CHANGE',
    state: next,
    stats: getStats(),
    reason,
    suggestion,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SIGNALS') {
    state.signals.push({ ...msg.data, tabId: sender.tab?.id });
    if (msg.data.url && !state.recentSites.includes(msg.data.url)) {
      state.recentSites.push(msg.data.url);
      if (state.recentSites.length > 5) state.recentSites.shift();
    }

    if (!isSnoozed()) {
      chrome.storage.local.get(['currentGoal'], async (r) => {
        const goal = r.currentGoal || '';
        state.lastGoal = goal;
        const tabSw = state.tabSwitches.filter(s => Date.now() - s.t < 300000).length;
        const h = localHeuristic(msg.data, tabSw, goal);

        if (h.driftState !== 'focused') {
          state.consecutiveDriftSignals++;
        } else {
          state.consecutiveDriftSignals = 0;
        }

        if (
          state.currentState === 'focused' &&
          state.consecutiveDriftSignals >= 2 &&
          h.driftState !== 'focused'
        ) {
          const sub = h.distracting && goal
            ? `${msg.data.url} doesn't match "${goal.slice(0, 40)}"`
            : '';
          await triggerOffTrackCatch(
            h.driftState === 'gone' ? "You're off track." : 'Starting to drift.',
            sub,
            h.driftState === 'drifting',
          );
        }
      });
    }
  }

  if (msg.type === 'LABEL') {
    fetch('http://localhost:5000/api/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: msg.label, timestamp: Date.now() }),
    }).catch(() => {});
  }

  if (msg.type === 'GET_STATE') {
    chrome.runtime.sendMessage({
      type: 'STATE_UPDATE',
      state: state.currentState,
      stats: getStats(),
      reason: state.currentReason,
      suggestion: state.currentSuggestion,
    });
  }

  if (msg.type === 'SET_GOAL') {
    state.lastGoal = msg.goal;
    chrome.storage.local.set({ currentGoal: msg.goal });
  }

  if (msg.type === 'INTERVENTION_RESULT') {
    logIntervention(msg.data);
  }

  if (msg.type === 'SET_SNOOZE') {
    const minutes = msg.minutes || 30;
    state.snoozeUntil = Date.now() + minutes * 60000;
    chrome.storage.local.set({ snoozeUntil: state.snoozeUntil });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'GET_SNOOZE') {
    const remaining = Math.max(0, Math.ceil((state.snoozeUntil - Date.now()) / 60000));
    chrome.runtime.sendMessage({
      type: 'SNOOZE_STATUS',
      snoozed: isSnoozed(),
      remainingMinutes: remaining,
    });
  }

  if (msg.type === 'SELF_CORRECT') {
    if (state.currentState !== 'focused') {
      const prevState = state.currentState;
      state.currentState = 'focused';
      state.currentReason = 'Self-corrected';
      state.currentSuggestion = '';
      state.consecutiveDriftSignals = 0;

      logIntervention({
        type: 'self-correction',
        action: msg.reason,
        state_before: prevState,
        state_after: 'focused',
        timestamp: Date.now(),
      });

      notifyTab({ type: 'STATE_CHANGE', state: 'focused', stats: getStats() });
      notifyTab({ type: 'SHOW_TOAST', message: 'Nice catch — you caught yourself' });
    }
  }

  if (msg.type === 'REALIZATION_CHECK') {
    if (state.currentState !== 'focused') {
      state.currentState = 'focused';
      state.consecutiveDriftSignals = 0;
      logIntervention({
        type: 'realization',
        action: msg.reason || 'tab_return',
        state_before: 'drifting',
        state_after: 'focused',
        timestamp: Date.now(),
      });
      notifyTab({ type: 'STATE_CHANGE', state: 'focused', stats: getStats() });
      notifyTab({ type: 'SHOW_TOAST', message: 'Nice catch — welcome back' });
    }
  }
});

chrome.tabs.onActivated.addListener((info) => {
  state.tabSwitches.push({ tabId: info.tabId, t: Date.now() });
});

function getStats() {
  const now = Date.now();
  const recent = state.signals.filter(s => now - s.timestamp < 300000);
  const tabSwitchesRecent = state.tabSwitches.filter(s => now - s.t < 300000).length;
  const avgVel = recent.length ? recent.reduce((a, s) => a + s.avgScrollVelocity, 0) / recent.length : 0;
  const avgConsistency = recent.length ? recent.reduce((a, s) => a + s.scrollConsistency, 0) / recent.length : 0;
  const avgScrollDepth = recent.length ? recent.reduce((a, s) => a + s.scrollDepth, 0) / recent.length : 0;
  return {
    tabSwitches: tabSwitchesRecent,
    avgVel: Math.round(avgVel * 100) / 100,
    avgConsistency: Math.round(avgConsistency * 1000) / 1000,
    avgScrollDepth: Math.round(avgScrollDepth * 1000) / 1000,
    sessionMinutes: Math.round((now - state.sessionStart) / 60000),
  };
}

async function buildFeatureVector() {
  const now = Date.now();
  const window5 = state.signals.filter(s => now - s.timestamp < 300000);
  if (window5.length < 1) return null;
  const latest = window5[window5.length - 1];
  const tabSw = state.tabSwitches.filter(s => now - s.t < 300000).length;
  const avgVel = window5.reduce((a, s) => a + s.avgScrollVelocity, 0) / window5.length;
  const avgCons = window5.reduce((a, s) => a + s.scrollConsistency, 0) / window5.length;
  const avgMouse = window5.reduce((a, s) => a + s.mouseActivity, 0) / window5.length;
  const avgDepth = window5.reduce((a, s) => a + s.scrollDepth, 0) / window5.length;
  const avgContent = window5.reduce((a, s) => a + (s.contentLength || 0), 0) / window5.length;
  const sessionMin = (now - state.sessionStart) / 60000;
  const hour = new Date().getHours();

  const r = await chrome.storage.local.get(['currentGoal']);
  return {
    current_url: latest.url,
    page_title: latest.title,
    current_goal: r.currentGoal || '',
    recent_sites: state.recentSites,
    avg_scroll_velocity: avgVel,
    scroll_consistency: avgCons,
    tab_switches_5min: tabSw,
    mouse_activity: avgMouse,
    session_duration: sessionMin,
    time_of_day: hour,
    content_length: avgContent,
    scroll_depth_vs_time: window5.length > 0 ? avgDepth / (sessionMin || 1) : 0,
  };
}

async function tick() {
  if (isSnoozed()) return;
  const fv = await buildFeatureVector();
  if (!fv) return;
  try {
    const res = await fetch('http://localhost:5000/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fv),
    });
    const data = await res.json();
    const prev = state.currentState;
    state.currentState = data.state;
    state.currentReason = data.reason || '';
    state.currentSuggestion = data.suggestion || '';

    state.lastStates.push({ state: data.state, t: Date.now() });
    if (state.lastStates.length > 100) state.lastStates = state.lastStates.slice(-100);

    if (data.state !== prev) {
      await handleStateTransition(prev, data.state, data.reason, data.suggestion);
    }

    fetch('http://localhost:5000/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        features: fv,
        state: data.state,
        reason: data.reason,
        suggestion: data.suggestion,
        source: data.source,
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  } catch (e) { /* backend offline */ }

  state.signals = state.signals.filter(s => Date.now() - s.timestamp < 600000);
  state.tabSwitches = state.tabSwitches.filter(s => Date.now() - s.t < 600000);
}

chrome.alarms.create('tick', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'tick') tick(); });
