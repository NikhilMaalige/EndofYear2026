# Attention Guard

**A Chrome extension that notices when you've drifted off task and nudges you back.**

Site blockers are blunt: YouTube can be a lecture or a rabbit hole. Attention Guard decides based on context. You set a goal for your session; the extension watches behavioral signals and page content, estimates whether you are **focused**, **drifting**, or **gone**, and intervenes only when it's warranted.

## How it works

1. **Signals:** the content script and background worker collect browsing behavior (tab switches per minute, idle time, scroll velocity and consistency, mouse and hover activity, session length, URL path) into a feature vector. URL paths matter: a YouTube search page isn't flagged, but `/watch` and `/shorts` are evaluated.
2. **Attention engine:** a rules layer (mirrored in JavaScript and Python) tracks drift over time using thresholds in `attention_config.json`.
3. **ML classifier:** a scikit-learn ensemble (random forest / gradient boosting) predicts the attention state from the features and retrains on your own labeled history.
4. **Content check:** Gemini judges whether the page you're on actually matches your stated goal.
5. **Intervention:** an on-page prompt when you drift, plus a dashboard of your focus over time.

## Structure

| Path | Contents |
|---|---|
| `extension/` | Manifest V3 extension: content script, background service worker, attention engine, popup, dashboard, intervention overlay |
| `backend/` | Flask API, feature pipeline, classifier and retraining, Gemini analyzer, SQLite storage, tests |

## Running locally

```bash
cd backend
pip install -r requirements.txt
python app.py
```
Then open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `extension/`. Set `GEMINI_API_KEY` in your environment for content checks.
