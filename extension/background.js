importScripts('attention_engine.js');

const state = {
  signals: [],
  tabSwitches: [],
  sessionStart: Date.now(),
  currentState: 'focused',
  currentReason: '',
  currentSuggestion: '',
  currentDriftScore: 0,
  currentDriftSource: 'local',
  currentComponents: {},
  currentTopComponent: null,
  lastStates: [],
  recentSites: [],
  snoozeUntil: 0,
  catchShownAt: 0,
  consecutiveDriftSignals: 0,
  lastGoal: '',
  engineReady: false,
};

attentionEngine.loadConfig().then(() => {
  state.engineReady = true;
});

chrome.storage.local.get(['snoozeUntil', 'currentGoal'], (r) => {
  if (r.snoozeUntil) state.snoozeUntil = r.snoozeUntil;
  if (r.currentGoal) state.lastGoal = r.currentGoal;
});

function isSnoozed() {
  return Date.now() < state.snoozeUntil;
}

function signalsInWindow(ms) {
  const now = Date.now();
  return state.signals.filter(s => now - s.timestamp < ms);
}

function sumField(signals, field) {
  return signals.reduce((a, s) => a + (s[field] || 0), 0);
}

function aggregateRates() {
  const now = Date.now();
  const window1 = signalsInWindow(60000);
  const window5 = signalsInWindow(300000);
  const tabSw1 = state.tabSwitches.filter(s => now - s.t < 60000).length;
  const tabSw5 = state.tabSwitches.filter(s => now - s.t < 300000).length;

  const clicks1 = sumField(window1, 'clicks');
  const keys1 = sumField(window1, 'keypresses');
  const dir1 = sumField(window1, 'directionChanges');
  const hovers1 = sumField(window1, 'hoversWithoutClick');
  const idleSeconds = window1.length
    ? Math.max(...window1.map(s => s.idleSeconds || 0))
    : 0;

  const avgVel = window5.length
    ? window5.reduce((a, s) => a + s.avgScrollVelocity, 0) / window5.length
    : 0;
  const avgCons = window5.length
    ? window5.reduce((a, s) => a + s.scrollConsistency, 0) / window5.length
    : 0;
  const avgMouse = window5.length
    ? window5.reduce((a, s) => a + s.mouseActivity, 0) / window5.length
    : 0;
  const avgDepth = window5.length
    ? window5.reduce((a, s) => a + s.scrollDepth, 0) / window5.length
    : 0;
  const avgContent = window5.length
    ? window5.reduce((a, s) => a + (s.contentLength || 0), 0) / window5.length
    : 0;

  return {
    tab_switches_per_min: tabSw1,
    tab_switches_5min: tabSw5,
    direction_changes_per_min: dir1,
    clicks_per_min: clicks1,
    keypresses_per_min: keys1,
    interaction_per_min: clicks1 + keys1,
    hovers_per_min: hovers1,
    idle_seconds: idleSeconds,
    avg_scroll_velocity: avgVel,
    scroll_consistency: avgCons,
    mouse_activity: avgMouse,
    avgScrollDepth: avgDepth,
    content_length: avgContent,
    window5,
  };
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
    driftScore: state.currentDriftScore,
    driftSource: state.currentDriftSource,
    components: state.currentComponents,
  });
}

function applyDriftResult(result, reason, suggestion, driftSource) {
  state.currentDriftScore = result.drift_score;
  state.currentComponents = result.components || {};
  state.currentTopComponent = result.top_component;
  if (driftSource) state.currentDriftSource = driftSource;
  if (reason) state.currentReason = reason;
  else if (result.reason) state.currentReason = result.reason;
  if (suggestion !== undefined) state.currentSuggestion = suggestion;
}

function broadcastDriftUpdate() {
  chrome.runtime.sendMessage({
    type: 'DRIFT_UPDATE',
    driftScore: state.currentDriftScore,
    driftSource: state.currentDriftSource,
    state: state.currentState,
    reason: state.currentReason,
    stats: getStats(),
    components: state.currentComponents,
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SIGNALS') {
    state.signals.push({ ...msg.data, tabId: sender.tab?.id });
    if (msg.data.url && !state.recentSites.includes(msg.data.url)) {
      state.recentSites.push(msg.data.url);
      if (state.recentSites.length > 5) state.recentSites.shift();
    }

    if (!isSnoozed() && state.engineReady) {
      chrome.storage.local.get(['currentGoal'], async (r) => {
        const goal = r.currentGoal || '';
        state.lastGoal = goal;
        const fv = await buildFeatureVectorFromLatest(msg.data, goal);
        if (!fv) return;

        const config = await attentionEngine.loadConfig();
        const h = attentionEngine.computeDriftSync(fv, config);
        applyDriftResult(h);

        if (h.driftState !== 'focused') {
          state.consecutiveDriftSignals++;
          if (state.consecutiveDriftSignals === 1 || state.consecutiveDriftSignals === 6) {
            tick();
          }
        } else {
          state.consecutiveDriftSignals = 0;
        }

        if (
          state.currentState === 'focused' &&
          state.consecutiveDriftSignals >= 2 &&
          h.drift_score >= 0.34 &&
          h.driftState !== 'focused'
        ) {
          const sub = h.distracting && goal
            ? `${msg.data.url} doesn't match "${goal.slice(0, 40)}"`
            : h.reason || '';
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
      driftScore: state.currentDriftScore,
      driftSource: state.currentDriftSource,
      components: state.currentComponents,
      top_component: state.currentTopComponent,
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
      state.currentDriftScore = 0;

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
      state.currentDriftScore = 0;
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
  const rates = aggregateRates();
  let topLabel = state.currentTopComponent;
  if (topLabel && attentionEngine.SIGNAL_LABELS) {
    topLabel = attentionEngine.SIGNAL_LABELS[topLabel] || topLabel;
  }

  return {
    tabSwitches: rates.tab_switches_5min,
    tabSwitchesPerMin: rates.tab_switches_per_min,
    avgVel: Math.round(rates.avg_scroll_velocity * 100) / 100,
    avgConsistency: Math.round(rates.scroll_consistency * 1000) / 1000,
    avgScrollDepth: Math.round(rates.avgScrollDepth * 1000) / 1000,
    idleSeconds: Math.round(rates.idle_seconds),
    sessionMinutes: Math.round((Date.now() - state.sessionStart) / 60000),
    driftScore: Math.round(state.currentDriftScore * 100),
    topComponent: topLabel,
    interactionPerMin: rates.interaction_per_min,
  };
}

async function buildFeatureVectorFromLatest(latest, goal) {
  const rates = aggregateRates();
  if (!latest && rates.window5.length < 1) return null;
  const last = latest || rates.window5[rates.window5.length - 1];
  const sessionMin = (Date.now() - state.sessionStart) / 60000;
  const hour = new Date().getHours();

  return {
    current_url: last.url,
    page_title: last.title,
    current_goal: goal || '',
    recent_sites: state.recentSites,
    avg_scroll_velocity: rates.avg_scroll_velocity,
    scroll_consistency: rates.scroll_consistency,
    tab_switches_per_min: rates.tab_switches_per_min,
    tab_switches_5min: rates.tab_switches_5min,
    direction_changes_per_min: rates.direction_changes_per_min,
    clicks_per_min: rates.clicks_per_min,
    keypresses_per_min: rates.keypresses_per_min,
    interaction_per_min: rates.interaction_per_min,
    hovers_per_min: rates.hovers_per_min,
    idle_seconds: rates.idle_seconds,
    mouse_activity: rates.mouse_activity,
    session_duration: sessionMin,
    time_of_day: hour,
    content_length: rates.content_length,
    scroll_depth_vs_time: rates.window5.length > 0 ? rates.avgScrollDepth / (sessionMin || 1) : 0,
    consecutive_drift: state.consecutiveDriftSignals,
  };
}

async function buildFeatureVector() {
  const r = await chrome.storage.local.get(['currentGoal']);
  return buildFeatureVectorFromLatest(null, r.currentGoal || '');
}

async function applyLocalState(result, reason, suggestion) {
  const prev = state.currentState;
  applyDriftResult(result, reason, suggestion);
  state.currentState = result.state || result.driftState;

  state.lastStates.push({ state: state.currentState, t: Date.now() });
  if (state.lastStates.length > 100) state.lastStates = state.lastStates.slice(-100);

  if (state.currentState !== prev) {
    await handleStateTransition(prev, state.currentState, state.currentReason, state.currentSuggestion);
  }
}

async function tick() {
  if (isSnoozed()) return;
  const fv = await buildFeatureVector();
  if (!fv) return;

  let data = null;
  try {
    const res = await fetch('http://localhost:5000/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fv),
    });
    data = await res.json();
  } catch (e) {
    if (state.engineReady) {
      const config = await attentionEngine.loadConfig();
      const local = attentionEngine.computeDriftSync(fv, config);
      await applyLocalState(local);
    }
    state.signals = state.signals.filter(s => Date.now() - s.timestamp < 600000);
    state.tabSwitches = state.tabSwitches.filter(s => Date.now() - s.t < 600000);
    return;
  }

  const prev = state.currentState;
  state.currentState = data.state;
  state.currentReason = data.reason || '';
  state.currentSuggestion = data.suggestion || '';
  state.currentDriftScore = data.drift_score ?? state.currentDriftScore;
  state.currentDriftSource = data.drift_source || 'local';
  state.currentComponents = data.components || state.currentComponents;
  state.currentTopComponent = data.top_component ?? state.currentTopComponent;

  state.lastStates.push({ state: data.state, t: Date.now() });
  if (state.lastStates.length > 100) state.lastStates = state.lastStates.slice(-100);

  if (data.state !== prev) {
    await handleStateTransition(prev, data.state, data.reason, data.suggestion);
  }

  broadcastDriftUpdate();

  fetch('http://localhost:5000/api/signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      features: { ...fv, drift_score: state.currentDriftScore, components: state.currentComponents },
      state: data.state,
      reason: data.reason,
      suggestion: data.suggestion,
      source: data.source,
      timestamp: Date.now(),
    }),
  }).catch(() => {});

  state.signals = state.signals.filter(s => Date.now() - s.timestamp < 600000);
  state.tabSwitches = state.tabSwitches.filter(s => Date.now() - s.t < 600000);
}

chrome.alarms.create('tick', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'tick') tick(); });
