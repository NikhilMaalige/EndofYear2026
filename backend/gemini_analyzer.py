import os
import time
import hashlib
import json
from google import genai
from google.genai import types
from dotenv import load_dotenv

import classifier
import attention_engine as ae

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
if GEMINI_API_KEY:
    client = genai.Client(api_key=GEMINI_API_KEY)
else:
    client = None

_cache = {}
CACHE_TTL = 90

_rl_tokens = 6
_rl_last_refill = time.time()
RL_CAPACITY = 6
RL_REFILL_RATE = 6.0 / 60.0

_last_gemini_call = 0.0
_last_local_drift = 0.0
MIN_CALL_INTERVAL = 45.0
DRIFT_JUMP_BYPASS = 0.22

DRIFT_RUBRIC = """\
Drift percent (0-100) measures how far the user's attention has wandered from their stated goal.

Calibration guide:
- 0-15: Fully on-task. Page and behavior match the goal.
- 16-33: Mostly focused with minor distractions.
- 34-64: Drifting. Off-task browsing, high tab switching (20+/min), idle scrolling, or unrelated sites.
- 65-100: Deeply gone. Heavy distraction (40+ tab switches/min), entertainment sites unrelated to goal, or no meaningful progress.

Weigh goal relevance heavily: same behavior on-task vs YouTube should differ by 30+ points.
Use the algorithmic baseline as a hint, but adjust based on page content and goal fit."""


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


def _can_call_gemini(local_drift, local_state):
    """Gate API calls: rate limit, min interval, and skip obvious on-task cases."""
    global _last_gemini_call, _last_local_drift
    now = time.time()

    if local_state == 'focused' and local_drift < 0.15:
        return False

    if now - _last_gemini_call < MIN_CALL_INTERVAL:
        drift_jump = abs(local_drift - _last_local_drift)
        if local_state != 'gone' and drift_jump < DRIFT_JUMP_BYPASS:
            return False

    return True


def _bucketize(val, bucket_size):
    return round(val / bucket_size) * bucket_size


def _get_cache_key(features, local_drift):
    url = str(features.get('current_url', ''))
    goal = str(features.get('current_goal', ''))
    v = _bucketize(features.get('avg_scroll_velocity', 0), 5)
    t = _bucketize(features.get('tab_switches_per_min', features.get('tab_switches_5min', 0) / 5), 5)
    s = _bucketize(features.get('session_duration', 0), 5)
    d = _bucketize(local_drift, 0.12)
    key_str = f"{url}|{goal}|{v}|{t}|{s}|{d}"
    return hashlib.md5(key_str.encode()).hexdigest()


def _format_components(components):
    if not components:
        return ''
    top = sorted(components.items(), key=lambda x: x[1], reverse=True)[:4]
    return ', '.join(f"{ae.SIGNAL_LABELS.get(k, k)}: {v:.0%}" for k, v in top if v > 0.05)


def _state_from_drift(drift_score):
    config = ae.load_config()
    states = config['states']
    if drift_score < states['focused_max']:
        return 'focused'
    if drift_score <= states['drifting_max']:
        return 'drifting'
    return 'gone'


def _blend_drift(local_drift, gemini_drift, gemini_conf):
    """Weight Gemini higher when confident; keep local signal as anchor."""
    if gemini_conf >= 0.8:
        weight = 0.82
    elif gemini_conf >= 0.65:
        weight = 0.72
    else:
        weight = 0.58
    blended = weight * gemini_drift + (1 - weight) * local_drift
    return max(0.0, min(1.0, blended))


def _call_gemini(features, local_drift, local_state, components):
    url = str(features.get('current_url', ''))
    title = str(features.get('page_title', ''))
    goal = str(features.get('current_goal', ''))
    v = features.get('avg_scroll_velocity', 0)
    tab_per_min = features.get('tab_switches_per_min', features.get('tab_switches_5min', 0) / 5)
    idle = features.get('idle_seconds', 0)
    interaction = features.get('interaction_per_min', 0)
    s = features.get('session_duration', 0)
    recent = features.get('recent_sites', [])
    comp_str = _format_components(components)
    relevance = features.get('goal_relevance', ae._get_relevance_score(title, goal))

    sys_instruct = (
        "You assess a user's web browsing attention. "
        "Return an accurate drift_percent (0-100), state, reason, and suggestion. "
        + DRIFT_RUBRIC
    )
    prompt = f"Goal: {goal or 'None'}\n"
    prompt += f"Current page: {title} ({url})\n"
    if recent:
        prompt += f"Recent tabs: {', '.join(recent[-3:])}\n"
    prompt += (
        f"Behavior: {s:.0f}min session, scroll vel {v:.1f}, "
        f"{tab_per_min:.0f} tab switches/min, {idle:.0f}s idle, "
        f"{interaction:.1f} interactions/min, goal relevance {relevance:.0%}.\n"
    )
    prompt += f"Algorithmic baseline drift: {local_drift:.0%} (local estimate, state: {local_state}).\n"
    if comp_str:
        prompt += f"Signal breakdown: {comp_str}.\n"
    prompt += (
        "Estimate drift_percent holistically. "
        "State must align: focused if <34%, drifting if 34-64%, gone if >64%."
    )

    schema = types.Schema(
        type=types.Type.OBJECT,
        properties={
            "drift_percent": types.Schema(type=types.Type.INTEGER),
            "state": types.Schema(type=types.Type.STRING, enum=["focused", "drifting", "gone"]),
            "confidence": types.Schema(type=types.Type.NUMBER),
            "reason": types.Schema(type=types.Type.STRING),
            "suggestion": types.Schema(type=types.Type.STRING),
        },
        required=["drift_percent", "state", "confidence", "reason", "suggestion"],
    )

    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=sys_instruct,
            response_mime_type="application/json",
            response_schema=schema,
            temperature=0.15,
        ),
    )
    result_dict = json.loads(response.text)
    drift_percent = int(result_dict.get('drift_percent', round(local_drift * 100)))
    drift_percent = max(0, min(100, drift_percent))
    return (
        drift_percent / 100.0,
        result_dict.get('state', 'focused'),
        float(result_dict.get('confidence', 0.8)),
        result_dict.get('reason', ''),
        result_dict.get('suggestion', ''),
    )


def analyze(features):
    """
    Local engine provides fast baseline. Gemini calibrates drift_percent when
    warranted — gated by cache, rate limit, and min call interval.
    Returns: (state, confidence, reason, suggestion, source, drift_score,
              components, top_component, drift_source)
    """
    global _last_gemini_call, _last_local_drift

    local_state, local_conf, local_reason, local_drift, components = classifier.predict_detailed(features)
    drift_result = ae.compute_drift(features)
    top_component = drift_result.get('top_component')
    _last_local_drift = local_drift

    drift_source = 'local'
    drift_score = local_drift

    if local_state == 'focused' and local_conf >= 0.78 and local_drift < 0.12:
        return (
            local_state, local_conf, local_reason, '', 'local_ml',
            drift_score, components, top_component, drift_source,
        )

    cache_key = _get_cache_key(features, local_drift)
    now = time.time()
    if cache_key in _cache:
        cached = _cache[cache_key]
        if now - cached['timestamp'] < CACHE_TTL:
            return cached['result']

    need_gemini = (
        client is not None
        and _can_call_gemini(local_drift, local_state)
        and (
            local_state in ('drifting', 'gone')
            or local_drift >= 0.28
            or local_conf < 0.62
        )
    )

    suggestion = ''
    reason = local_reason
    state = local_state
    confidence = local_conf
    source = 'local_ml'

    if need_gemini and _take_token():
        try:
            g_drift, g_state, g_conf, g_reason, g_suggestion = _call_gemini(
                features, local_drift, local_state, components,
            )
            _last_gemini_call = time.time()

            drift_score = _blend_drift(local_drift, g_drift, g_conf)
            drift_source = 'gemini' if g_conf >= 0.75 else 'hybrid'

            reason = g_reason or local_reason
            suggestion = g_suggestion or ''
            source = 'hybrid'

            state_from_score = _state_from_drift(drift_score)
            state_order = {'focused': 0, 'drifting': 1, 'gone': 2}
            g_order = state_order.get(g_state, 0)
            score_order = state_order.get(state_from_score, 0)
            final_order = max(g_order, score_order)
            state = {0: 'focused', 1: 'drifting', 2: 'gone'}[final_order]
            confidence = max(local_conf, g_conf * 0.92)

        except Exception as e:
            print(f"Gemini API error: {e}")
            source = 'local_ml'
            drift_source = 'local'

    result = (
        state, confidence, reason, suggestion, source,
        round(drift_score, 4), components, top_component, drift_source,
    )
    _cache[cache_key] = {'timestamp': now, 'result': result}
    return result
