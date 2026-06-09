# Attention Guard — Build Complete ✅

All **17 files** have been created. Here's what was built and what you need to do.

---

## Files Created

### Extension (`extension/`)
| File | Purpose |
|------|---------|
| [manifest.json](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/manifest.json) | Chrome Manifest V3 — permissions, content scripts, service worker |
| [content.js](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/content.js) | Runs on every page, collects scroll/mouse/click signals every 5s |
| [background.js](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/background.js) | Service worker — aggregates signals, builds feature vectors, calls Flask every 60s |
| [intervention.js](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/intervention.js) | Fade/mirror/recall overlays triggered by state changes |
| [intervention.css](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/intervention.css) | Styles for intervention overlays |
| [popup.html](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/popup.html) | Popup UI — manual labeling + goal setting |
| [popup.js](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/popup.js) | Popup logic |
| [popup.css](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/popup.css) | Popup dark theme styles |
| [dashboard.html](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/dashboard.html) | Full analytics dashboard page |
| [dashboard.js](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/dashboard.js) | Dashboard rendering — heatmap, charts, site breakdown |
| [dashboard.css](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/dashboard.css) | Dashboard dark theme styles |
| `icons/icon16.png` | 16×16 extension icon |
| `icons/icon48.png` | 48×48 extension icon |
| `icons/icon128.png` | 128×128 extension icon |

### Backend (`backend/`)
| File | Purpose |
|------|---------|
| [app.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/app.py) | Flask server — all API endpoints |
| [storage.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/storage.py) | SQLite storage layer (signals, labels, interventions) |
| [feature_pipeline.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/feature_pipeline.py) | Feature extraction + normalization |
| [classifier.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/classifier.py) | RandomForest classifier with rule-based fallback |
| [retrain.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/retrain.py) | Standalone retraining script |
| [requirements.txt](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/requirements.txt) | Python dependencies |

---

## What YOU Need to Do

### Step 1: Install Python dependencies
Open a terminal and run:
```bash
cd c:\Users\nmaal\OneDrive\Documents\GitHub\EndofYear2026\backend
pip install flask flask-cors scikit-learn numpy joblib
```

### Step 2: Start the Flask backend
```bash
cd c:\Users\nmaal\OneDrive\Documents\GitHub\EndofYear2026\backend
python app.py
```
You should see: `Running on http://127.0.0.1:5000`

> [!IMPORTANT]
> Keep this terminal running. The extension talks to this backend.

### Step 3: Load the extension in Chrome
1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select the folder: `c:\Users\nmaal\OneDrive\Documents\GitHub\EndofYear2026\extension`
5. You should see "Attention Guard" appear with the shield icon

### Step 4: Verify it works
1. Open any webpage (e.g., Wikipedia), scroll around, click things
2. Open **DevTools → Console** on that page — you should see no errors
3. Click the **Attention Guard** extension icon in the toolbar — popup should appear with labeling buttons
4. In `chrome://extensions`, click the **"Service worker"** link under Attention Guard → Console — you should see no errors and alarm events every 60s
5. The Flask terminal should start showing POST requests

### Step 5: Train the model (after browsing a while)
1. Browse normally for a while
2. Periodically click the extension icon and label your state (Focused / Drifting / Gone)
3. Aim for **30+ labels** across all three states
4. Then run:
```bash
cd c:\Users\nmaal\OneDrive\Documents\GitHub\EndofYear2026\backend
python retrain.py
```

### Step 6: Open the Dashboard
- Click "Open Dashboard →" in the extension popup, **or**
- Open `c:\Users\nmaal\OneDrive\Documents\GitHub\EndofYear2026\extension\dashboard.html` directly in Chrome

---

## How It All Works Together

```
content.js (every page)
    ↓ scroll/mouse/click signals every 5s
background.js (service worker)
    ↓ aggregated feature vector every 60s
Flask backend (localhost:5000)
    ↓ prediction (rule-based → trained model)
background.js
    ↓ STATE_CHANGE message on transitions
intervention.js (content script)
    → Drifting: page fades to black gradually
    → Gone: mirror overlay with stats + recall prompt
```

> [!NOTE]
> Until you train the model (Step 5), the classifier uses a **rule-based fallback** that scores your behavior based on scroll velocity, tab switches, and mouse activity. It works fine out of the box — training just personalizes it to you.
