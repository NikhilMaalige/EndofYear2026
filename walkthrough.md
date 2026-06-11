# Attention Guard — Context-Aware YouTube Flagging ✅

All systems have been updated to make YouTube flagging context-aware. Opening YouTube will no longer immediately flag the site as distracting. Instead, the extension waits until you actually open a video to determine if the content matches your goal or constitutes a distraction.

---

## What Changed

1. **Path-level detection**: We updated both the extension (JavaScript) and the backend (Python) to check the URL pathname.
2. **Flagging Logic**:
   - `youtube.com` (homepage, search, subscription feed, history, etc.) is **not** immediately treated as distracting context.
   - Only URLs containing video watch paths (`/watch`, `/shorts`, `/embed`) are classified as distracting.
3. **Signal Pipeline**:
   - `content.js` now forwards `url_path: location.pathname` to the background.
   - `background.js` maps this to `current_url_path` in the feature vector.
   - `attention_engine.js` and `attention_engine.py` use the new context-sensitive checks when analyzing drift.

---

## Files Created/Modified

### Extension (`extension/`)
| File | Changes Made |
|------|--------------|
| [content.js](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/content.js) | Sends `url_path` parameter to the background service worker |
| [background.js](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/background.js) | Captures and includes `current_url_path` in the final signal feature vector |
| [attention_engine.js](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/extension/attention_engine.js) | Implements path-level checks for YouTube; only considers `/watch`, `/shorts`, or `/embed` as distracting |

### Backend (`backend/`)
| File | Changes Made |
|------|--------------|
| [attention_engine.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/attention_engine.py) | Implements equivalent Python path-level check for YouTube to ensure backend/Gemini predictions align |
| [feature_pipeline.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/feature_pipeline.py) | Updates feature pipeline extraction to feed `url_path` into context checks |
| [test_attention_engine.py](file:///c:/Users/nmaal/OneDrive/Documents/GitHub/EndofYear2026/backend/test_attention_engine.py) | Added tests verifying YouTube homepage is ignored while video pages trigger standard distraction rules |

---

## Verification & Testing

### 1. Run Backend Tests
All tests in the attention engine verify that this behavior is correct:
```powershell
cd c:\Users\nmaal\OneDrive\Documents\GitHub\EndofYear2026\backend
python -m unittest test_attention_engine.TestComputeDrift
```
*Result:* All 8 tests passed successfully, confirming homepage URL passes as non-distracting while video URLs get flagged as mismatch/distracting.

### 2. Apply Changes in browser
1. Go to `chrome://extensions/` in Chrome.
2. Click the **Reload** (refresh) icon on the **Attention Guard** card.
3. Restart your Flask backend to load the updated Python models and engines.
