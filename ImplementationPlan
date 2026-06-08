# Attention Guard — Stage - by - Stage Build Guide

    > Chrome extension that detects your mental state shift from focused → drifting → gone using behavioral signals, then intervenes with fade / mirror / recall overlays.Trained on YOUR data.Everything local.

---

## Project Structure(Final)

    ```
EndofYear2026/
├── extension/
│   ├── manifest.json
│   ├── content.js
│   ├── background.js
│   ├── intervention.js
│   ├── intervention.css
│   ├── dashboard.html
│   ├── dashboard.js
│   ├── dashboard.css
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
└── backend/
    ├── app.py
    ├── feature_pipeline.py
    ├── classifier.py
    ├── storage.py
    ├── retrain.py
    └── requirements.txt
```

## What to Install

    > [!CAUTION]
    > Do NOT let me install these.Run these yourself.

** Python(backend):**
    ```bash
cd backend
pip install flask flask-cors scikit-learn numpy joblib
```

    ** No npm needed ** — the extension is plain JS, no build step.

** Chrome:** You'll load the extension unpacked via `chrome://extensions` → Developer mode → Load unpacked → select the `extension/` folder.

---

## Team Ownership Map

    | Person | Owns | Primary Files |
| --------| ------| ---------------|
| ** A ** | Chrome extension — signal collection | `manifest.json`, `content.js`, `background.js` |
| ** B ** | ML pipeline — features, classifier, retraining | `feature_pipeline.py`, `classifier.py`, `retrain.py` |
| ** C ** | Interventions + Dashboard UI | `intervention.js/css`, `dashboard.html/js/css`, `popup.*` |
| ** D ** | Flask backend + storage + glue | `app.py`, `storage.py`, `requirements.txt` |

    ---

# STAGE 1 — Extension Scaffold + Signal Collection(Days 1–2)

    > ** Who:** Person A(primary), Person D(starts backend scaffold in parallel)
        > ** Goal:** Extension loads on every page, collects scroll / mouse / click signals, sends them to background.js

---

### 1.1 Create extension icons

You need three PNG icons.Create simple solid - color circles or use any 16×16, 48×48, 128×128 PNGs.Place them in `extension/icons/`.

---

### 1.2 `extension/manifest.json`

    ```json
{
  "manifest_version": 3,
  "name": "Attention Guard",
  "version": "1.0",
  "description": "Detects attention state shifts using behavioral signals",
  "permissions": ["tabs", "activeTab", "storage", "alarms"],
  "host_permissions": ["http://localhost:5000/*"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js", "intervention.js"],
      "css": ["intervention.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

### 1.3 `extension/content.js`

This runs on every page.Collects scroll, mouse, and click signals every 5 seconds and ships them to background.js.

```js
(function() {
  const S = { scrollY: 0, lastScrollY: 0, scrollEvents: [], mouseEvents: [], clicks: 0, dirChanges: 0, lastDir: 0, hoverStart: null, hoversWithoutClick: 0, lastActivityTime: Date.now() };

  window.addEventListener('scroll', () => {
    const y = window.scrollY, dy = y - S.lastScrollY, dir = Math.sign(dy);
    if (dir !== 0 && dir !== S.lastDir && S.lastDir !== 0) S.dirChanges++;
    S.lastDir = dir;
    S.scrollEvents.push({ y, t: Date.now(), dy });
    S.lastScrollY = y;
    S.lastActivityTime = Date.now();
  }, { passive: true });

  window.addEventListener('mousemove', (e) => {
    S.mouseEvents.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    S.lastActivityTime = Date.now();
  }, { passive: true });

  window.addEventListener('click', () => { S.clicks++; S.lastActivityTime = Date.now(); });

  document.addEventListener('mouseover', (e) => {
    if (e.target.tagName === 'A') S.hoverStart = Date.now();
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.tagName === 'A' && S.hoverStart && (Date.now() - S.hoverStart > 500)) S.hoversWithoutClick++;
    S.hoverStart = null;
  });

  function computeAndSend() {
    const now = Date.now(), scrolls = S.scrollEvents.filter(e => now - e.t < 5000), mice = S.mouseEvents.filter(e => now - e.t < 5000);
    const avgVel = scrolls.length > 1 ? scrolls.reduce((a, e) => a + Math.abs(e.dy), 0) / scrolls.length : 0;
    let consistency = 0;
    if (scrolls.length > 2) {
      const gaps = [];
      for (let i = 1; i < scrolls.length; i++) gaps.push(scrolls[i].t - scrolls[i-1].t);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
      consistency = 1 / (1 + Math.sqrt(variance) / 1000);
    }
    const mouseActivity = mice.length > 1 ? mice.reduce((a, e, i) => i === 0 ? 0 : a + Math.hypot(mice[i].x - mice[i-1].x, mice[i].y - mice[i-1].y), 0) / mice.length : 0;
    const docHeight = Math.max(document.body.scrollHeight, 1);
    const scrollDepth = window.scrollY / docHeight;
    const contentLength = document.body.innerText.length;

    chrome.runtime.sendMessage({
      type: 'SIGNALS',
      data: {
        avgScrollVelocity: Math.round(avgVel * 100) / 100,
        scrollConsistency: Math.round(consistency * 1000) / 1000,
        directionChanges: S.dirChanges,
        mouseActivity: Math.round(mouseActivity * 100) / 100,
        clicks: S.clicks,
        hoversWithoutClick: S.hoversWithoutClick,
        scrollDepth: Math.round(scrollDepth * 1000) / 1000,
        contentLength,
        url: location.hostname,
        timestamp: now
      }
    });

    S.scrollEvents = scrolls;
    S.mouseEvents = mice;
    S.dirChanges = 0;
    S.clicks = 0;
    S.hoversWithoutClick = 0;
  }

  setInterval(computeAndSend, 5000);
})();
```

---

### 1.4 `extension/background.js`

Service worker.Aggregates signals from all tabs, tracks tab switches, sends feature vectors to Flask backend every 60s.

```js
const state = { signals: [], tabSwitches: [], sessionStart: Date.now(), currentState: 'focused', lastStates: [], tabHistory: {} };

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
    scroll_depth_vs_time: window5.length > 0 ? avgDepth / (sessionMin || 1) : 0
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
```

---

### ✅ Stage 1 Verification

1. Load extension unpacked in Chrome
2. Open any webpage, scroll around, click things
3. Open DevTools → Console on the page — no errors
4. Go to `chrome://extensions` → Attention Guard → "Service worker" link → Console — you should see no errors and the alarm firing every 60s
5. At this point the `fetch` calls to localhost: 5000 will fail(expected — backend isn't built yet)

---

# STAGE 2 — Flask Backend + SQLite Storage(Days 3–4)

> ** Who:** Person D(primary), Person B(starts feature pipeline in parallel)
> ** Goal:** Backend accepts signals, stores them, returns predictions(hardcoded initially)

---

### 2.1 `backend/requirements.txt`

    ```
flask
flask-cors
scikit-learn
numpy
joblib
```

> [!IMPORTANT]
> Run`pip install flask flask-cors scikit-learn numpy joblib` yourself.

---

### 2.2 `backend/storage.py`

    ```python
import sqlite3, json, os, threading

DB_PATH = os.path.join(os.path.dirname(__file__), 'attention.db')
_local = threading.local()

def get_db():
    if not hasattr(_local, 'conn'):
        _local.conn = sqlite3.connect(DB_PATH)
        _local.conn.row_factory = sqlite3.Row
    return _local.conn

def init_db():
    db = get_db()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            features TEXT,
            predicted_state TEXT
        );
        CREATE TABLE IF NOT EXISTS labels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            label TEXT,
            features TEXT
        );
        CREATE TABLE IF NOT EXISTS interventions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL,
            type TEXT,
            action TEXT,
            state_before TEXT,
            state_after TEXT
        );
    ''')
    db.commit()

def store_signal(timestamp, features, state):
    db = get_db()
    db.execute('INSERT INTO signals (timestamp, features, predicted_state) VALUES (?, ?, ?)', (timestamp, json.dumps(features), state))
    db.commit()

def store_label(timestamp, label, features=None):
    db = get_db()
    db.execute('INSERT INTO labels (timestamp, label, features) VALUES (?, ?, ?)', (timestamp, label, json.dumps(features) if features else None))
    db.commit()

def store_intervention(timestamp, itype, action, state_before, state_after):
    db = get_db()
    db.execute('INSERT INTO interventions (timestamp, type, action, state_before, state_after) VALUES (?, ?, ?, ?, ?)', (timestamp, itype, action, state_before, state_after))
    db.commit()

def get_signals(since=None, limit=1000):
    db = get_db()
    if since:
        rows = db.execute('SELECT * FROM signals WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?', (since, limit)).fetchall()
    else:
        rows = db.execute('SELECT * FROM signals ORDER BY timestamp DESC LIMIT ?', (limit,)).fetchall()
    return [dict(r) for r in rows]

def get_labels(limit=5000):
    db = get_db()
    return [dict(r) for r in db.execute('SELECT * FROM labels ORDER BY timestamp DESC LIMIT ?', (limit,)).fetchall()]

def get_interventions(since=None):
    db = get_db()
    if since:
        rows = db.execute('SELECT * FROM interventions WHERE timestamp > ? ORDER BY timestamp DESC', (since,)).fetchall()
    else:
        rows = db.execute('SELECT * FROM interventions ORDER BY timestamp DESC LIMIT 200').fetchall()
    return [dict(r) for r in rows]

def get_training_data():
    db = get_db()
    labels = db.execute('SELECT * FROM labels WHERE features IS NOT NULL ORDER BY timestamp').fetchall()
    return [dict(r) for r in labels]
```

---

### 2.3 `backend/app.py`

    ```python
from flask import Flask, request, jsonify
from flask_cors import CORS
import storage, classifier, feature_pipeline

app = Flask(__name__)
CORS(app)

storage.init_db()

@app.route('/api/predict', methods=['POST'])
def predict():
    features = request.json
    state = classifier.predict(features)
    return jsonify({'state': state})

@app.route('/api/signals', methods=['POST'])
def receive_signals():
    data = request.json
    storage.store_signal(data.get('timestamp', 0), data.get('features', {}), data.get('state', 'focused'))
    return jsonify({'ok': True})

@app.route('/api/label', methods=['POST'])
def receive_label():
    data = request.json
    recent = storage.get_signals(limit=1)
    features = None
    if recent:
        import json
        features = json.loads(recent[0]['features']) if isinstance(recent[0]['features'], str) else recent[0]['features']
    storage.store_label(data['timestamp'], data['label'], features)
    return jsonify({'ok': True})

@app.route('/api/intervention', methods=['POST'])
def receive_intervention():
    d = request.json
    storage.store_intervention(d.get('timestamp', 0), d.get('type', ''), d.get('action', ''), d.get('state_before', ''), d.get('state_after', ''))
    return jsonify({'ok': True})

@app.route('/api/history', methods=['GET'])
def history():
    since = request.args.get('since', type=float)
    signals = storage.get_signals(since=since)
    return jsonify(signals)

@app.route('/api/interventions', methods=['GET'])
def interventions():
    since = request.args.get('since', type=float)
    return jsonify(storage.get_interventions(since=since))

@app.route('/api/retrain', methods=['POST'])
def retrain():
    result = classifier.train_from_db()
    return jsonify(result)

@app.route('/api/dashboard', methods=['GET'])
def dashboard_data():
    import time, json
    now = time.time() * 1000
    today_start = now - (now % 86400000)
    signals = storage.get_signals(since=today_start, limit=5000)
    interventions = storage.get_interventions(since=today_start)

    timeline = []
    for s in signals:
        f = json.loads(s['features']) if isinstance(s['features'], str) else s['features']
        timeline.append({'timestamp': s['timestamp'], 'state': s['predicted_state'], 'url': f.get('url', ''), **f})

    site_states = {}
    for s in signals:
        f = json.loads(s['features']) if isinstance(s['features'], str) else s['features']
        url = f.get('url', 'unknown')
        if url not in site_states:
            site_states[url] = {'focused': 0, 'drifting': 0, 'gone': 0}
        st = s['predicted_state']
        if st in site_states[url]:
            site_states[url][st] += 1

    week_start = now - 7 * 86400000
    week_signals = storage.get_signals(since=week_start, limit=10000)
    daily = {}
    for s in week_signals:
        day = int(s['timestamp'] // 86400000)
        if day not in daily:
            daily[day] = {'focused': 0, 'drifting': 0, 'gone': 0, 'total': 0}
        st = s['predicted_state']
        if st in daily[day]:
            daily[day][st] += 1
        daily[day]['total'] += 1

    return jsonify({'timeline': timeline, 'siteStates': site_states, 'interventions': interventions, 'weeklyTrends': daily})

if __name__ == '__main__':
    app.run(port=5000, debug=True)
```

---

### ✅ Stage 2 Verification

    ```bash
cd backend
python app.py
```

Then test:
    ```bash
curl -X POST http://localhost:5000/api/predict -H "Content-Type: application/json" -d "{\"avg_scroll_velocity\": 5, \"scroll_consistency\": 0.5, \"tab_switches_5min\": 3, \"mouse_activity\": 10, \"session_duration\": 15, \"time_of_day\": 14, \"content_length\": 5000, \"scroll_depth_vs_time\": 0.3}"
```

Should return `{"state": "focused"}`(or whatever the rule - based fallback gives).

---

# STAGE 3 — Feature Pipeline + Classifier + Labeling(Days 5–7)

    > ** Who:** Person B(primary)
        > ** Goal:** Feature pipeline normalizes raw signals, classifier works with rule - based fallback, manual labeling in the popup

---

### 3.1 `backend/feature_pipeline.py`

    ```python
import numpy as np

FEATURE_KEYS = ['avg_scroll_velocity', 'scroll_consistency', 'tab_switches_5min', 'mouse_activity', 'session_duration', 'time_of_day', 'content_length', 'scroll_depth_vs_time']

def extract(raw):
    return np.array([raw.get(k, 0) for k in FEATURE_KEYS], dtype=np.float64)

def normalize(features, stats=None):
    if stats is None:
        return features
    means = np.array([stats.get(k, {}).get('mean', 0) for k in FEATURE_KEYS])
    stds = np.array([stats.get(k, {}).get('std', 1) for k in FEATURE_KEYS])
    stds[stds == 0] = 1
    return (features - means) / stds

def compute_stats(feature_list):
    if not feature_list:
        return {}
    arr = np.array(feature_list)
    stats = {}
    for i, k in enumerate(FEATURE_KEYS):
        stats[k] = {'mean': float(np.mean(arr[:, i])), 'std': float(np.std(arr[:, i]))}
    return stats
```

---

### 3.2 `backend/classifier.py`

    ```python
import os, json, joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
import feature_pipeline as fp
import storage

MODEL_PATH = os.path.join(os.path.dirname(__file__), 'model.pkl')
STATS_PATH = os.path.join(os.path.dirname(__file__), 'stats.json')
STATE_MAP = {0: 'focused', 1: 'drifting', 2: 'gone'}
LABEL_MAP = {'focused': 0, 'drifting': 1, 'gone': 2}

_model = None
_stats = None

def _load():
    global _model, _stats
    if os.path.exists(MODEL_PATH):
        _model = joblib.load(MODEL_PATH)
    if os.path.exists(STATS_PATH):
        with open(STATS_PATH) as f:
            _stats = json.load(f)

def _rule_based(features):
    v = features.get('avg_scroll_velocity', 0)
    c = features.get('scroll_consistency', 0)
    t = features.get('tab_switches_5min', 0)
    m = features.get('mouse_activity', 0)
    s = features.get('session_duration', 0)
    score = 0
    if v > 15: score += 2
    elif v > 8: score += 1
    if c > 0.7: score += 2
    if t > 8: score += 2
    elif t > 4: score += 1
    if m < 2 and v > 5: score += 1
    if s > 30: score += 1
    if score >= 5: return 'gone'
    if score >= 2: return 'drifting'
    return 'focused'

def predict(features):
    global _model, _stats
    if _model is None:
        _load()
    if _model is None:
        return _rule_based(features)
    try:
        fv = fp.extract(features)
        fv = fp.normalize(fv, _stats)
        pred = _model.predict(fv.reshape(1, -1))[0]
        return STATE_MAP.get(pred, 'focused')
    except:
        return _rule_based(features)

def train_from_db():
    global _model, _stats
    data = storage.get_training_data()
    if len(data) < 10:
        return {'status': 'insufficient_data', 'count': len(data)}
    X, y = [], []
    for row in data:
        features = json.loads(row['features']) if isinstance(row['features'], str) else row['features']
        label = row['label']
        if label not in LABEL_MAP:
            continue
        X.append(fp.extract(features))
        y.append(LABEL_MAP[label])
    if len(X) < 10:
        return {'status': 'insufficient_data', 'count': len(X)}
    X = np.array(X)
    y = np.array(y)
    _stats = fp.compute_stats(X.tolist())
    with open(STATS_PATH, 'w') as f:
        json.dump(_stats, f)
    X_norm = np.array([fp.normalize(x, _stats) for x in X])
    _model = RandomForestClassifier(n_estimators=50, max_depth=5, random_state=42)
    _model.fit(X_norm, y)
    joblib.dump(_model, MODEL_PATH)
    return {'status': 'trained', 'samples': len(X), 'classes': list(set(y.tolist()))}
```

---

### 3.3 `backend/retrain.py`

Standalone script to retrain from collected labels.Run manually or via cron.

```python
import storage, classifier

storage.init_db()
result = classifier.train_from_db()
print(f"Retrain result: {result}")
```

---

### 3.4 `extension/popup.html` — Manual Labeling + Goal Setting

    ```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <h1>Attention Guard</h1>
    <div id="status" class="status-badge">—</div>
    <div class="stats" id="stats"></div>
    <div class="section">
      <h2>How do you feel?</h2>
      <div class="label-buttons">
        <button data-label="focused" class="btn focused">🎯 Focused</button>
        <button data-label="drifting" class="btn drifting">😶‍🌫️ Drifting</button>
        <button data-label="gone" class="btn gone">💀 Gone</button>
      </div>
      <div id="label-feedback" class="feedback"></div>
    </div>
    <div class="section">
      <h2>What are you trying to do?</h2>
      <input type="text" id="goal-input" placeholder="e.g. Research for essay...">
      <button id="set-goal" class="btn primary">Set Goal</button>
    </div>
    <a href="dashboard.html" target="_blank" class="dashboard-link">Open Dashboard →</a>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

---

### 3.5 `extension/popup.js`

    ```js
document.querySelectorAll('[data-label]').forEach(btn => {
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'LABEL', label: btn.dataset.label });
    document.getElementById('label-feedback').textContent = `Logged: ${ btn.dataset.label } `;
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
    document.getElementById('status').className = `status - badge ${ msg.state } `;
    if (msg.stats) {
      document.getElementById('stats').innerHTML = `
    < div > Tab switches(5m): ${ msg.stats.tabSwitches }</div >
        <div>Scroll velocity: ${msg.stats.avgVel}</div>
        <div>Session: ${msg.stats.sessionMinutes}m</div>
`;
    }
  }
});
```

---

### 3.6 `extension/popup.css`

    ```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 300px; font-family: 'Segoe UI', system-ui, sans-serif; background: #0f0f14; color: #e0e0e0; }
.container { padding: 16px; }
h1 { font-size: 16px; font-weight: 700; margin-bottom: 12px; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 8px; }
.status-badge { text-align: center; padding: 8px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-bottom: 12px; background: #1a1a24; }
.status-badge.focused { background: #0d2818; color: #4ade80; }
.status-badge.drifting { background: #2d1f0e; color: #fbbf24; }
.status-badge.gone { background: #2d0e0e; color: #f87171; }
.stats { font-size: 11px; color: #888; margin-bottom: 12px; display: flex; flex-direction: column; gap: 2px; }
.section { margin-bottom: 14px; }
.label-buttons { display: flex; gap: 6px; }
.btn { padding: 8px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: transform 0.15s, opacity 0.15s; }
.btn:hover { transform: scale(1.05); }
.btn:active { transform: scale(0.95); }
.btn.focused { background: #166534; color: #fff; }
.btn.drifting { background: #854d0e; color: #fff; }
.btn.gone { background: #991b1b; color: #fff; }
.btn.primary { background: #4f46e5; color: #fff; width: 100%; margin-top: 6px; }
input[type="text"] { width: 100%; padding: 8px; border: 1px solid #2a2a3a; border-radius: 6px; background: #1a1a24; color: #e0e0e0; font-size: 12px; outline: none; }
input[type="text"]:focus { border-color: #4f46e5; }
.feedback { font-size: 11px; color: #4ade80; margin-top: 4px; min-height: 16px; }
.dashboard-link { display: block; text-align: center; color: #60a5fa; text-decoration: none; font-size: 12px; margin-top: 8px; }
.dashboard-link:hover { text-decoration: underline; }
```

---

### ✅ Stage 3 Verification

1. Reload the extension
2. Click the extension icon → popup should show with labeling buttons and goal input
3. Click "Focused" / "Drifting" / "Gone" — check Flask console for label POST
4. Browse for a few minutes, click labels periodically to build training data
5. Run `python retrain.py` — should print training result

---

# STAGE 4 — Live State Detection(Days 8–9)

    > ** Who:** Person A + Person B(integration)
        > ** Goal:** Classifier runs live, state changes are sent to content scripts in real - time

This stage is mostly ** integration testing ** — Stages 1–3 already have the wiring.What you need to do:

### 4.1 Collect Training Data

1. Browse normally for 1–2 hours
2. Every few minutes, click the popup and label your current state
3. Aim for at least ** 30 labels ** across all three states
4. Run`python retrain.py`

### 4.2 Verify Live Predictions

After retraining, the model file `model.pkl` exists.The `predict` endpoint now uses the real model instead of rule - based fallback.

1. Browse with the extension loaded
2. Watch the Flask console — every 60s you should see POST requests to`/api/predict`
3. The response should reflect your actual behavior
4. Open the popup — the status badge should update

### 4.3 Fine - tuning the Rule - Based Fallback

If you don't have enough labels yet, the rule-based fallback in [classifier.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/classifier.py) is what runs. Tune the thresholds in `_rule_based()` to match your own patterns.

---

# STAGE 5 — Interventions(Days 10–11)

    > ** Who:** Person C(primary)
        > ** Goal:** Build the Fade, Mirror, and Recall interventions that fire on state changes

---

### 5.1 `extension/intervention.css`

    ```css
#ag-fade-overlay { position: fixed; inset: 0; background: #000; z-index: 2147483646; pointer-events: none; opacity: 0; transition: opacity 0.5s ease; }
#ag-mirror-overlay { position: fixed; inset: 0; z-index: 2147483647; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); font-family: 'Segoe UI', system-ui, sans-serif; }
#ag-mirror-card { background: linear-gradient(145deg, #1a1a2e, #16213e); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; max-width: 420px; width: 90%; color: #e0e0e0; box-shadow: 0 25px 60px rgba(0,0,0,0.5); }
#ag-mirror-card h2 { font-size: 18px; margin-bottom: 16px; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
#ag-mirror-stats { font-size: 14px; line-height: 1.8; margin-bottom: 20px; }
#ag-mirror-stats span { color: #fbbf24; font-weight: 700; }
#ag-recall-section { margin-bottom: 16px; display: none; }
#ag-recall-input { width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; background: rgba(255,255,255,0.05); color: #e0e0e0; font-size: 14px; outline: none; }
#ag-recall-input:focus { border-color: #a78bfa; }
#ag-recall-goal { font-size: 12px; color: #888; margin-bottom: 8px; }
#ag-dismiss-btn { padding: 10px 24px; border: none; border-radius: 8px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; font-weight: 600; cursor: pointer; font-size: 14px; transition: transform 0.15s, box-shadow 0.15s; }
#ag-dismiss-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(79,70,229,0.4); }
#ag-dismiss-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
```

---

### 5.2 `extension/intervention.js`

    ```js
(function() {
  let fadeInterval = null, fadeOpacity = 0, currentState = 'focused';

  function createOverlays() {
    if (document.getElementById('ag-fade-overlay')) return;
    const fade = document.createElement('div');
    fade.id = 'ag-fade-overlay';
    document.body.appendChild(fade);

    const mirror = document.createElement('div');
    mirror.id = 'ag-mirror-overlay';
    mirror.innerHTML = `< div id = "ag-mirror-card" >
      <h2>👁️ Hey. Look at this.</h2>
      <div id="ag-mirror-stats"></div>
      <div id="ag-recall-section">
        <div id="ag-recall-goal"></div>
        <input type="text" id="ag-recall-input" placeholder="What were you trying to do?">
      </div>
      <button id="ag-dismiss-btn">I'm good, let me back</button>
    </div > `;
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
}) ();
```

---

### ✅ Stage 5 Verification

To test interventions without waiting for real state changes, open DevTools console on any page and run:

```js
// Test fade (drifting)
window.postMessage({ type: 'test' }, '*');
chrome.runtime.sendMessage = chrome.runtime.sendMessage; // ensure it's available
// Simulate from background:
// In background console:
// chrome.tabs.query({active:true,currentWindow:true}, t => chrome.tabs.sendMessage(t[0].id, {type:'STATE_CHANGE', state:'drifting', stats:{tabSwitches:5,avgVel:12,avgScrollDepth:0.3,sessionMinutes:22}}))
```

Or add a temporary test button to the popup that sends state changes.

---

# STAGE 6 — Dashboard (Days 12–13)

> **Who:** Person C (primary)
> **Goal:** Full analytics dashboard with attention heatmap, site correlations, intervention history, weekly trends

---

### 6.1 `extension / dashboard.html`

```html
    < !DOCTYPE html >
        <html>
            <head>
                <meta charset="utf-8">
                    <title>Attention Guard — Dashboard</title>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
                        <link rel="stylesheet" href="dashboard.css">
                        </head>
                        <body>
                            <div class="dashboard">
                                <header>
                                    <h1>🛡️ Attention Guard</h1>
                                    <p class="subtitle">Your attention, visualized</p>
                                </header>
                                <div class="grid">
                                    <section class="card full-width">
                                        <h2>Today's Attention Timeline</h2>
                                        <div id="heatmap" class="heatmap"></div>
                                        <div class="heatmap-legend">
                                            <span class="legend-item"><span class="dot focused"></span> Focused</span>
                                            <span class="legend-item"><span class="dot drifting"></span> Drifting</span>
                                            <span class="legend-item"><span class="dot gone"></span> Gone</span>
                                        </div>
                                    </section>
                                    <section class="card">
                                        <h2>Today's Summary</h2>
                                        <div id="summary" class="summary-grid"></div>
                                    </section>
                                    <section class="card">
                                        <h2>Site Breakdown</h2>
                                        <div id="sites" class="site-list"></div>
                                    </section>
                                    <section class="card">
                                        <h2>Intervention History</h2>
                                        <div id="interventions" class="intervention-list"></div>
                                    </section>
                                    <section class="card">
                                        <h2>Weekly Trend</h2>
                                        <canvas id="trend-chart" width="400" height="200"></canvas>
                                    </section>
                                </div>
                            </div>
                            <script src="dashboard.js"></script>
                        </body>
                    </html>
                    ```

                    ---

                    ### 6.2 `extension/dashboard.css`

                    ```css
                    * {margin: 0; padding: 0; box-sizing: border-box; }
                    body {font - family: 'Inter', system-ui, sans-serif; background: #0a0a12; color: #e0e0e0; min-height: 100vh; }
                    .dashboard {max - width: 1200px; margin: 0 auto; padding: 32px 24px; }
                    header {margin - bottom: 32px; }
                    h1 {font - size: 28px; font-weight: 700; background: linear-gradient(135deg, #a78bfa, #60a5fa, #34d399); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                    .subtitle {color: #666; font-size: 14px; margin-top: 4px; }
                    h2 {font - size: 14px; text-transform: uppercase; letter-spacing: 1.5px; color: #888; margin-bottom: 16px; }
                    .grid {display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                    .card {background: linear-gradient(145deg, #12121c, #1a1a2e); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; padding: 24px; transition: border-color 0.3s; }
                    .card:hover {border - color: rgba(167,139,250,0.2); }
                    .full-width {grid - column: 1 / -1; }

                    .heatmap {display: flex; gap: 2px; flex-wrap: wrap; margin-bottom: 12px; min-height: 40px; }
                    .heatmap-cell {width: 18px; height: 32px; border-radius: 4px; transition: transform 0.15s; cursor: pointer; position: relative; }
                    .heatmap-cell:hover {transform: scaleY(1.3); z-index: 1; }
                    .heatmap-cell.focused {background: #166534; }
                    .heatmap-cell.drifting {background: #854d0e; }
                    .heatmap-cell.gone {background: #991b1b; }
                    .heatmap-cell.empty {background: #1a1a24; }
                    .heatmap-cell::after {content: attr(data-tooltip); position: absolute; bottom: 110%; left: 50%; transform: translateX(-50%); background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px; font-size: 10px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
                    .heatmap-cell:hover::after {opacity: 1; }
                    .heatmap-legend {display: flex; gap: 16px; }
                    .legend-item {font - size: 12px; color: #888; display: flex; align-items: center; gap: 6px; }
                    .dot {width: 10px; height: 10px; border-radius: 50%; }
                    .dot.focused {background: #4ade80; }
                    .dot.drifting {background: #fbbf24; }
                    .dot.gone {background: #f87171; }

                    .summary-grid {display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                    .summary-item {background: rgba(255,255,255,0.03); border-radius: 10px; padding: 16px; text-align: center; }
                    .summary-item .value {font - size: 28px; font-weight: 700; margin-bottom: 4px; }
                    .summary-item .label {font - size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
                    .summary-item.focused .value {color: #4ade80; }
                    .summary-item.drifting .value {color: #fbbf24; }
                    .summary-item.gone .value {color: #f87171; }
                    .summary-item.total .value {color: #60a5fa; }

                    .site-list {max - height: 300px; overflow-y: auto; }
                    .site-row {display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
                    .site-row:last-child {border - bottom: none; }
                    .site-name {font - size: 13px; font-weight: 500; min-width: 120px; }
                    .site-bar {flex: 1; height: 8px; border-radius: 4px; display: flex; overflow: hidden; gap: 1px; }
                    .site-bar .seg {height: 100%; }
                    .site-bar .seg.focused {background: #4ade80; }
                    .site-bar .seg.drifting {background: #fbbf24; }
                    .site-bar .seg.gone {background: #f87171; }

                    .intervention-list {max - height: 300px; overflow-y: auto; }
                    .intervention-item {display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 13px; }
                    .intervention-item:last-child {border - bottom: none; }
                    .intervention-type {font - weight: 600; }
                    .intervention-action {padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
                    .intervention-action.dismissed {background: rgba(248,113,113,0.15); color: #f87171; }
                    .intervention-action.recalled {background: rgba(74,222,128,0.15); color: #4ade80; }
                    .intervention-time {color: #666; font-size: 11px; }

                    canvas {width: 100% !important; height: 200px !important; }
                    ```

                    ---

                    ### 6.3 `extension/dashboard.js`

                    ```js
                    const API = 'http://localhost:5000';

                    async function load() {
  try {
    const res = await fetch(`${API}/api/dashboard`);
                    const data = await res.json();
                    renderHeatmap(data.timeline);
                    renderSummary(data.timeline);
                    renderSites(data.siteStates);
                    renderInterventions(data.interventions);
                    renderTrend(data.weeklyTrends);
  } catch(e) {
                        document.querySelector('.dashboard').innerHTML += '<p style="color:#f87171;text-align:center;margin-top:20px;">⚠️ Cannot connect to backend. Make sure Flask is running on localhost:5000</p>';
  }
}

                    function renderHeatmap(timeline) {
  const container = document.getElementById('heatmap');
                    const buckets = new Array(48).fill(null);
  timeline.forEach(s => {
    const d = new Date(s.timestamp);
    const bucket = d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
    if (!buckets[bucket] || s.timestamp > buckets[bucket].timestamp) buckets[bucket] = s;
  });
  container.innerHTML = buckets.map((b, i) => {
    const h = Math.floor(i / 2), m = (i % 2) * 30;
                    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    return `<div class="heatmap-cell ${b ? b.state : 'empty'}" data-tooltip="${time} — ${b ? b.state : 'no data'}"></div>`;
  }).join('');
}

                    function renderSummary(timeline) {
  const counts = {focused: 0, drifting: 0, gone: 0 };
  timeline.forEach(s => { if (counts[s.state] !== undefined) counts[s.state]++; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
                    document.getElementById('summary').innerHTML = `
                    <div class="summary-item focused"><div class="value">${total ? Math.round(counts.focused / total * 100) : 0}%</div><div class="label">Focused</div></div>
                    <div class="summary-item drifting"><div class="value">${total ? Math.round(counts.drifting / total * 100) : 0}%</div><div class="label">Drifting</div></div>
                    <div class="summary-item gone"><div class="value">${total ? Math.round(counts.gone / total * 100) : 0}%</div><div class="label">Gone</div></div>
                    <div class="summary-item total"><div class="value">${total}</div><div class="label">Total Readings</div></div>
                    `;
}

                    function renderSites(siteStates) {
  const container = document.getElementById('sites');
  const entries = Object.entries(siteStates).sort((a, b) => {
    const ta = a[1].focused + a[1].drifting + a[1].gone, tb = b[1].focused + b[1].drifting + b[1].gone;
                    return tb - ta;
  }).slice(0, 15);
                    if (!entries.length) {container.innerHTML = '<p style="color:#666;font-size:13px;">No site data yet</p>'; return; }
  container.innerHTML = entries.map(([site, s]) => {
    const total = s.focused + s.drifting + s.gone || 1;
                    return `<div class="site-row">
                        <div class="site-name">${site}</div>
                        <div class="site-bar">
                            <div class="seg focused" style="width:${s.focused/total*100}%"></div>
                            <div class="seg drifting" style="width:${s.drifting/total*100}%"></div>
                            <div class="seg gone" style="width:${s.gone/total*100}%"></div>
                        </div>
                    </div>`;
  }).join('');
}

                    function renderInterventions(interventions) {
  const container = document.getElementById('interventions');
                    if (!interventions.length) {container.innerHTML = '<p style="color:#666;font-size:13px;">No interventions yet</p>'; return; }
  container.innerHTML = interventions.slice(0, 20).map(i => {
    const time = new Date(i.timestamp).toLocaleTimeString();
                    return `<div class="intervention-item">
                        <span class="intervention-type">${i.type}</span>
                        <span class="intervention-action ${i.action}">${i.action}</span>
                        <span class="intervention-time">${time}</span>
                    </div>`;
  }).join('');
}

                    function renderTrend(weeklyTrends) {
  const canvas = document.getElementById('trend-chart');
                    const ctx = canvas.getContext('2d');
                    canvas.width = canvas.offsetWidth * 2;
                    canvas.height = 400;
                    ctx.scale(2, 2);
                    const w = canvas.offsetWidth, h = 200;

                    const days = Object.keys(weeklyTrends).sort().slice(-7);
                    if (!days.length) {ctx.fillStyle = '#666'; ctx.font = '13px Inter'; ctx.fillText('No weekly data yet', w/2 - 60, h/2); return; }

  const maxVal = Math.max(...days.map(d => weeklyTrends[d].total), 1);
                    const barW = Math.min(40, (w - 60) / days.length - 8);
                    const colors = {focused: '#4ade80', drifting: '#fbbf24', gone: '#f87171' };

  days.forEach((day, i) => {
    const d = weeklyTrends[day];
                    const x = 40 + i * ((w - 60) / days.length);
                    let yOffset = h - 20;
    ['focused', 'drifting', 'gone'].forEach(state => {
      const barH = (d[state] / maxVal) * (h - 40);
                    ctx.fillStyle = colors[state];
                    ctx.beginPath();
                    ctx.roundRect(x, yOffset - barH, barW, barH, 3);
                    ctx.fill();
                    yOffset -= barH;
    });
                    ctx.fillStyle = '#666';
                    ctx.font = '10px Inter';
                    const date = new Date(parseInt(day) * 86400000);
                    ctx.fillText(date.toLocaleDateString('en', {weekday: 'short' }), x, h - 4);
  });
}

                    load();
                    setInterval(load, 60000);
                    ```

                    ---

                    ### ✅ Stage 6 Verification

                    1. Open `dashboard.html` from the extension folder directly in Chrome (or right-click extension icon → "Open Dashboard")
                    2. Make sure Flask backend is running
                    3. You should see the heatmap, summary, site breakdown, intervention history, and weekly trend
                    4. If there's no data yet, you'll see placeholder messages — browse for a while with labeling to generate data

                    ---

                    # STAGE 7 — End-to-End Integration + Polish (Day 14)

> **Who:** Everyone
> **Goal:** Everything works together, edge cases handled, demo-ready

                    ---

                    ### 7.1 Integration Checklist

                    - [ ] Extension loads without errors on all pages
                    - [ ] Signals flow: content.js → background.js → Flask → SQLite
                    - [ ] Labels flow: popup → background.js → Flask → SQLite
                    - [ ] Predictions flow: background.js → Flask → background.js → content.js
                    - [ ] State changes trigger interventions correctly
                    - [ ] Fade intervention: gradually darkens page during "drifting"
                    - [ ] Mirror intervention: shows stats overlay during "gone"
                    - [ ] Recall intervention: requires typing before dismissing
                    - [ ] Intervention results are logged to Flask
                    - [ ] Dashboard loads and displays all 4 sections
                    - [ ] Retraining works with `python retrain.py`

                    ### 7.2 Edge Cases to Handle

                    - Extension on `chrome://` pages (content scripts don't run — that's fine, just don't crash)
                    - Flask backend not running (extension should degrade gracefully — it does, with try/catch)
                    - No training data yet (rule-based fallback works)
                    - Very long sessions (signal arrays are trimmed in background.js)

                    ### 7.3 Demo Script

                    1. **Show the popup** — goal setting, current state, manual labeling
                    2. **Browse normally** — show that it detects Focused state (status badge is green)
                    3. **Start doomscrolling** — open Twitter/Reddit, scroll fast, switch tabs rapidly
                    4. **Watch the fade** — page starts losing opacity as you drift
                    5. **Hit Gone state** — mirror overlay appears with your stats
                    6. **Recall prompt** — type what you were trying to do
                    7. **Open Dashboard** — show the heatmap, site breakdown, intervention history
                    8. **Show retraining** — run `python retrain.py` with collected labels

                    ---

                    ## Summary: Who Builds What, When

                    ```mermaid
                    gantt
                    title Attention Guard Build Schedule
                    dateFormat  YYYY-MM-DD
                    section Person A (Extension)
                    manifest.json + content.js          :a1, 2026-06-09, 2d
                    background.js signals               :a2, after a1, 2d
                    Integration testing                  :a3, 2026-06-19, 2d
                    section Person B (ML)
                    feature_pipeline.py                  :b1, 2026-06-13, 2d
                    classifier.py + retrain.py           :b2, after b1, 3d
                    Live prediction tuning               :b3, 2026-06-18, 2d
                    section Person C (UI)
                    popup.html/js/css                    :c1, 2026-06-13, 2d
                    intervention.js/css                  :c2, 2026-06-17, 2d
                    dashboard.html/js/css                :c3, after c2, 2d
                    section Person D (Backend)
                    Flask app.py + storage.py            :d1, 2026-06-09, 2d
                    API endpoints                        :d2, after d1, 2d
                    Dashboard API + integration          :d3, 2026-06-19, 2d
                    section Everyone
                    End-to-end testing + polish          :e1, 2026-06-22, 1d
                    ```

                    ---

> [!IMPORTANT]
> **Before you start:** Do you want me to go ahead and create all these files in your `EndofYear2026` repo, or do you want to build them stage by stage yourselves following this guide? Also — do you want me to generate the extension icons (16/48/128px)?
