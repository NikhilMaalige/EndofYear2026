const state = { signals: [], tabSwitches: [], sessionStart: Date.now(), currentState: 'focused', lastStates: [], tabHistory: {}, currentGoal: '' };

chrome.storage.local.get(['currentGoal'], res => { if (res.currentGoal) state.currentGoal = res.currentGoal; });

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'SIGNALS') {
    state.signals.push({ ...msg.data, tabId: sender.tab?.id });
  }
  if (msg.type === 'LABEL') {
    fetch('http://localhost:5000/api/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: msg.label, timestamp: Date.now() })
    }).catch(() => {});
  }
  if (msg.type === 'GET_STATE') {
    chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: state.currentState, stats: getStats() });
  }
  if (msg.type === 'SET_GOAL') {
    chrome.storage.local.set({ currentGoal: msg.goal });
    state.currentGoal = msg.goal;
  }
  if (msg.type === 'INTERVENTION_RESULT') {
    fetch('http://localhost:5000/api/intervention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.data)
    }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener((info) => {
  state.tabSwitches.push({ tabId: info.tabId, t: Date.now() });
  state.tabHistory[info.tabId] = (state.tabHistory[info.tabId] || 0) + 1;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete state.tabHistory[tabId];
});

function getStats() {
  const now = Date.now(), recent = state.signals.filter(s => now - s.timestamp < 300000);
  const tabSwitchesRecent = state.tabSwitches.filter(s => now - s.t < 300000).length;
  const avgVel = recent.length ? recent.reduce((a, s) => a + s.avgScrollVelocity, 0) / recent.length : 0;
  const avgConsistency = recent.length ? recent.reduce((a, s) => a + s.scrollConsistency, 0) / recent.length : 0;
  const avgScrollDepth = recent.length ? recent.reduce((a, s) => a + s.scrollDepth, 0) / recent.length : 0;
  return { tabSwitches: tabSwitchesRecent, avgVel: Math.round(avgVel * 100) / 100, avgConsistency: Math.round(avgConsistency * 1000) / 1000, avgScrollDepth: Math.round(avgScrollDepth * 1000) / 1000, sessionMinutes: Math.round((now - state.sessionStart) / 60000) };
}

function buildFeatureVector() {
  const now = Date.now(), window5 = state.signals.filter(s => now - s.timestamp < 300000);
  if (window5.length < 2) return null;
  const tabSw = state.tabSwitches.filter(s => now - s.t < 300000).length;
  const avgVel = window5.reduce((a, s) => a + s.avgScrollVelocity, 0) / window5.length;
  const avgCons = window5.reduce((a, s) => a + s.scrollConsistency, 0) / window5.length;
  const avgMouse = window5.reduce((a, s) => a + s.mouseActivity, 0) / window5.length;
  const avgDepth = window5.reduce((a, s) => a + s.scrollDepth, 0) / window5.length;
  const avgContent = window5.reduce((a, s) => a + s.contentLength, 0) / window5.length;
  const recentSignal = window5[window5.length - 1];
  const current_url = recentSignal ? recentSignal.url : '';
  const page_title = recentSignal ? recentSignal.title : '';
  const current_goal = state.currentGoal || '';
  const sessionMin = (now - state.sessionStart) / 60000;
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  return {
    avg_scroll_velocity: avgVel,
    scroll_consistency: avgCons,
    tab_switches_5min: tabSw,
    mouse_activity: avgMouse,
    session_duration: sessionMin,
    time_of_day: hour,
    content_length: avgContent,
    scroll_depth_vs_time: window5.length > 0 ? avgDepth / (sessionMin || 1) : 0,
    current_url,
    page_title,
    current_goal
  };
}

async function tick() {
  const fv = buildFeatureVector();
  if (!fv) return;
  try {
    const res = await fetch('http://localhost:5000/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fv)
    });
    const data = await res.json();
    const prev = state.currentState;
    state.currentState = data.state;
    state.lastStates.push({ state: data.state, t: Date.now() });
    if (state.lastStates.length > 100) state.lastStates = state.lastStates.slice(-100);

    if (data.state !== prev) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'STATE_CHANGE', state: data.state, stats: getStats() }).catch(() => {});
      }
    }

    fetch('http://localhost:5000/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: fv, state: data.state, timestamp: Date.now() })
    }).catch(() => {});
  } catch(e) {}

  state.signals = state.signals.filter(s => Date.now() - s.timestamp < 600000);
  state.tabSwitches = state.tabSwitches.filter(s => Date.now() - s.t < 600000);
}

chrome.alarms.create('tick', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'tick') tick(); });
