import os
import time
import hashlib
import json
from google import genai
from google.genai import types
from dotenv import load_dotenv

import classifier

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
if GEMINI_API_KEY:
    client = genai.Client(api_key=GEMINI_API_KEY)
else:
    client = None

_cache = {}
CACHE_TTL = 30

_rl_tokens = 10
_rl_last_refill = time.time()
RL_CAPACITY = 10
RL_REFILL_RATE = 10.0 / 60.0


def _take_token():
    global _rl_tokens, _rl_last_refill
    now = time.time()
    elapsed = now - _rl_last_refill
    _rl_tokens = min(RL_CAPACITY, _rl_tokens + elapsed * RL_REFILL_RATE)
    _rl_last_refill = now
    if _rl_tokens >= 1:
        _rl_tokens -= 1
        return True
    return False


def _bucketize(val, bucket_size):
    return round(val / bucket_size) * bucket_size


def _get_cache_key(features):
    url = str(features.get('current_url', ''))
    goal = str(features.get('current_goal', ''))
    v = _bucketize(features.get('avg_scroll_velocity', 0), 5)
    t = _bucketize(features.get('tab_switches_5min', 0), 2)
    s = _bucketize(features.get('session_duration', 0), 5)
    key_str = f"{url}|{goal}|{v}|{t}|{s}"
    return hashlib.md5(key_str.encode()).hexdigest()


def _call_gemini(features):
    url = str(features.get('current_url', ''))
    title = str(features.get('page_title', ''))
    goal = str(features.get('current_goal', ''))
    v = features.get('avg_scroll_velocity', 0)
    t = features.get('tab_switches_5min', 0)
    s = features.get('session_duration', 0)
    recent = features.get('recent_sites', [])

    sys_instruct = (
        "You classify a user's web browsing attention state. "
        "States: 'focused', 'drifting', 'gone'. Be concise."
    )
    prompt = f"Goal: {goal or 'None'}\n"
    prompt += f"Current page: {title} ({url})\n"
    if recent:
        prompt += f"Recent tabs: {', '.join(recent[-3:])}\n"
    prompt += f"Behavior: {s:.0f}min session, {v:.1f} scroll vel, {t} tab switches/5m.\n"
    prompt += "Classify state and provide a brief reason and helpful suggestion."

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "state": types.Schema(type=types.Type.STRING, enum=["focused", "drifting", "gone"]),
            "confidence": types.Schema(type=types.Type.NUMBER),
            "reason": types.Schema(type=types.Type.STRING),
            "suggestion": types.Schema(type=types.Type.STRING),
        },
        required=["state", "confidence", "reason", "suggestion"],
    )

    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=sys_instruct,
            response_mime_type="application/json",
            response_schema=schema,
            temperature=0.1,
        ),
    )
    result_dict = json.loads(response.text)
    return (
        result_dict.get('state', 'focused'),
        float(result_dict.get('confidence', 0.8)),
        result_dict.get('reason', ''),
        result_dict.get('suggestion', ''),
    )


def analyze(features):
    """
    Local ML runs first. Gemini enriches reason/suggestion only when off-track
    or confidence is low — not on every request.
    Returns: (state, confidence, reason, suggestion, source)
    """
    local_state, local_conf, local_reason, drift_score = classifier.predict_detailed(features)

    # Confident on-task → skip Gemini entirely
    if local_state == 'focused' and local_conf >= 0.72:
        return local_state, local_conf, local_reason, '', 'local_ml'

    cache_key = _get_cache_key(features)
    now = time.time()
    if cache_key in _cache:
        cached = _cache[cache_key]
        if now - cached['timestamp'] < CACHE_TTL:
            return cached['result']

    need_enrichment = (
        local_state in ('drifting', 'gone')
        or local_conf < 0.65
        or drift_score >= 2
    )

    suggestion = ''
    reason = local_reason
    state = local_state
    confidence = local_conf
    source = 'local_ml'

    if need_enrichment and client and _take_token():
        try:
            g_state, g_conf, g_reason, g_suggestion = _call_gemini(features)
            reason = g_reason or local_reason
            suggestion = g_suggestion or ''
            source = 'hybrid'

            state_order = {'focused': 0, 'drifting': 1, 'gone': 2}
            if state_order.get(g_state, 0) > state_order.get(local_state, 0):
                state = g_state
                confidence = max(local_conf, g_conf) * 0.9
            else:
                state = local_state
                confidence = max(local_conf, g_conf * 0.85)
        except Exception as e:
            print(f"Gemini API error: {e}")
            source = 'local_ml'

    result = (state, confidence, reason, suggestion, source)
    _cache[cache_key] = {'timestamp': now, 'result': result}
    return result
