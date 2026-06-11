import json
import os
import re

_CONFIG = None
_CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'shared', 'attention_config.json')

SIGNAL_LABELS = {
    'tab_switch_rate': 'tab switching',
    'scroll_velocity': 'fast scrolling',
    'scroll_consistency': 'rhythmic scrolling',
    'idle_time': 'idle time',
    'passive_browse': 'passive browsing',
    'direction_chaos': 'erratic scrolling',
    'low_interaction': 'low interaction',
    'distracting_context': 'distracting site',
    'goal_mismatch': 'goal mismatch',
}


def load_config():
    global _CONFIG
    if _CONFIG is None:
        with open(_CONFIG_PATH) as f:
            _CONFIG = json.load(f)
    return _CONFIG


# Terms that signal a video/page is *supporting* a goal even without direct keyword overlap.
# Keys are goal-domain keywords; values are sets of title terms that are task-supportive.
_GOAL_SUPPORT_CLUSTERS = {
    # academic writing
    'essay':    {'essay', 'write', 'writing', 'thesis', 'argument', 'paragraph',
                 'outline', 'draft', 'revision', 'cite', 'citation', 'analyze',
                 'analysis', 'structure', 'introduction', 'conclusion', 'body'},
    'homework': {'homework', 'study', 'learn', 'tutorial', 'guide', 'tips',
                 'practice', 'solve', 'explain', 'review'},
    'study':    {'study', 'learn', 'tutorial', 'guide', 'tips', 'review', 'explain'},
    'code':     {'code', 'coding', 'programming', 'debug', 'tutorial', 'algorithm'},
    'math':     {'math', 'algebra', 'calculus', 'equation', 'problem', 'solve'},
    'history':  {'history', 'historical', 'era', 'war', 'revolution', 'century'},
    'science':  {'science', 'biology', 'chemistry', 'physics', 'experiment', 'lab'},
}


# Domains that are video/media players — passive behavior (idle, low interaction)
# is expected and should not count against you when content is goal-relevant.
_VIDEO_DOMAINS = {'youtube', 'vimeo', 'twitch', 'dailymotion', 'coursera',
                  'udemy', 'khanacademy', 'ted', 'nebula'}


def _is_video_site(url):
    url_lower = str(url).lower()
    return any(d in url_lower for d in _VIDEO_DOMAINS)


def _get_relevance_score(title, goal):
    """Return a 0‒1 score for how relevant `title` is to `goal`.

    Uses both direct keyword overlap and a cluster-based expansion so that
    a video titled "How to Write a Good Essay" is considered relevant when
    the goal mentions "essay", even though the subject (e.g. Hamlet) differs.
    """
    if not title or not goal:
        return 0.0
    stop_words = {'for', 'and', 'the', 'to', 'a', 'in', 'of', 'on', 'is',
                  'my', 'how', 'what', 'why', 'with', 'do', 'does', 'be',
                  'are', 'was', 'were', 'an', 'at', 'by', 'this', 'that'}
    t_words = set(re.findall(r'\w+', str(title).lower())) - stop_words
    g_words = set(re.findall(r'\w+', str(goal).lower())) - stop_words
    if not g_words:
        return 0.0

    # Direct overlap score (0‒1)
    direct = float(len(t_words.intersection(g_words))) / len(g_words)

    # Cluster-based support score: does the title support any goal domain?
    support_bonus = 0.0
    for goal_keyword, support_terms in _GOAL_SUPPORT_CLUSTERS.items():
        if goal_keyword in g_words:          # goal is in this domain
            overlap = t_words.intersection(support_terms)
            if overlap:
                # Each matched support term adds up to 0.35 bonus, capped at 0.6
                support_bonus = max(support_bonus, min(0.35 * len(overlap), 0.6))

    return min(direct + support_bonus, 1.0)


def is_distracting(url, config=None):
    config = config or load_config()
    url_lower = str(url).lower()
    return any(d in url_lower for d in config['distracting_domains'])


def signal_drift(value, focused_max, drifting_at, gone_at):
    if value <= focused_max:
        return 0.0
    if value >= gone_at:
        return 1.0
    if drifting_at <= focused_max:
        return 1.0
    if value <= drifting_at:
        return 0.4 * (value - focused_max) / (drifting_at - focused_max)
    if gone_at <= drifting_at:
        return 1.0
    return 0.4 + 0.6 * (value - drifting_at) / (gone_at - drifting_at)


def low_interaction_drift(value, focused_min, drifting_below, gone_below):
    """Inverted ramp: lower interaction = higher drift."""
    if value >= focused_min:
        return 0.0
    if value <= gone_below:
        return 1.0
    if value <= drifting_below:
        return 0.4 + 0.6 * (drifting_below - value) / max(drifting_below - gone_below, 0.001)
    return 0.4 * (focused_min - value) / max(focused_min - drifting_below, 0.001)


def passive_browse_score(scroll_vel, mouse_activity, interaction_per_min):
    if scroll_vel <= 5:
        return 0.0
    vel_factor = min(scroll_vel / 18.0, 1.0)
    mouse_factor = 1.0 - min(mouse_activity / 8.0, 1.0)
    interact_factor = 1.0 - min(interaction_per_min / 2.0, 1.0)
    return min(vel_factor * 0.5 + mouse_factor * 0.25 + interact_factor * 0.25, 1.0)


def normalize_features(raw):
    """Ensure all derived fields exist on the feature dict."""
    features = dict(raw)
    tab_per_min = features.get('tab_switches_per_min')
    if tab_per_min is None:
        tab_5min = features.get('tab_switches_5min', 0)
        tab_per_min = tab_5min / 5.0
        features['tab_switches_per_min'] = tab_per_min

    if 'interaction_per_min' not in features:
        clicks = features.get('clicks_per_min', 0)
        keys = features.get('keypresses_per_min', 0)
        features['interaction_per_min'] = clicks + keys

    scroll_vel = features.get('avg_scroll_velocity', 0)
    mouse = features.get('mouse_activity', 0)
    interaction = features.get('interaction_per_min', 0)
    if 'passive_browse_score' not in features:
        features['passive_browse_score'] = passive_browse_score(scroll_vel, mouse, interaction)

    url = str(features.get('current_url', ''))
    title = str(features.get('page_title', ''))
    goal = str(features.get('current_goal', ''))
    if 'goal_relevance' not in features:
        features['goal_relevance'] = _get_relevance_score(title, goal)
    if 'is_distracting' not in features:
        features['is_distracting'] = 1.0 if is_distracting(url) else 0.0

    return features


def compute_drift(raw_features):
    config = load_config()
    features = normalize_features(raw_features)
    weights = config['weights']
    sig = config['signals']
    mods = config['modifiers']
    states = config['states']

    url = str(features.get('current_url', ''))
    title = str(features.get('page_title', ''))
    goal = str(features.get('current_goal', ''))
    relevance = features.get('goal_relevance', 0)
    distracting = is_distracting(url, config)

    # Detect goal-relevant video watching.  Passive signals (idle, low
    # interaction, passive browsing) are normal when watching a video and
    # should not be counted as drift when the content is on-task.
    video_site = _is_video_site(url)
    relevant_video = video_site and goal and relevance >= mods.get('video_relevance_threshold', 0.35)
    # suppress factor: 0 = fully suppressed, 1 = not suppressed
    video_suppress = max(0.0, 1.0 - relevance) if relevant_video else 1.0

    components = {
        'tab_switch_rate': signal_drift(
            features.get('tab_switches_per_min', 0),
            sig['tab_switches_per_min']['focused_max'],
            sig['tab_switches_per_min']['drifting_at'],
            sig['tab_switches_per_min']['gone_at'],
        ),
        'scroll_velocity': signal_drift(
            features.get('avg_scroll_velocity', 0),
            sig['scroll_velocity']['focused_max'],
            sig['scroll_velocity']['drifting_at'],
            sig['scroll_velocity']['gone_at'],
        ),
        'scroll_consistency': signal_drift(
            features.get('scroll_consistency', 0),
            sig['scroll_consistency']['focused_max'],
            sig['scroll_consistency']['drifting_at'],
            sig['scroll_consistency']['gone_at'],
        ),
        # Idle time and low interaction are expected while watching a video —
        # scale them down proportionally when content is goal-relevant.
        'idle_time': signal_drift(
            features.get('idle_seconds', 0),
            sig['idle_seconds']['focused_max'],
            sig['idle_seconds']['drifting_at'],
            sig['idle_seconds']['gone_at'],
        ) * video_suppress,
        'direction_chaos': signal_drift(
            features.get('direction_changes_per_min', 0),
            sig['direction_changes_per_min']['focused_max'],
            sig['direction_changes_per_min']['drifting_at'],
            sig['direction_changes_per_min']['gone_at'],
        ),
        'low_interaction': low_interaction_drift(
            features.get('interaction_per_min', 0),
            sig['interaction_per_min']['focused_min'],
            sig['interaction_per_min']['drifting_below'],
            sig['interaction_per_min']['gone_below'],
        ) * video_suppress,
        # passive_browse is inherently high when watching any video — suppress it too.
        'passive_browse': features.get('passive_browse_score', 0) * video_suppress,
        # Distracting context scales down with relevance; fully relevant = 0.
        'distracting_context': (
            0.0 if not distracting else
            max(0.0, 1.0 - relevance / max(mods['distracting_mismatch_threshold'], 0.001))
            if goal else 1.0
        ),
        'goal_mismatch': (
            1.0 if distracting and goal and relevance < mods['distracting_mismatch_threshold'] else
            0.5 if distracting and not goal else
            0.0
        ),
    }

    drift_score = sum(weights[k] * components[k] for k in weights)
    # Skip the peak_signal floor for relevant video watching — the floor would
    # re-introduce suppressed passive signals through the back door.
    if not relevant_video:
        peak_signal = max(components.values()) if components else 0.0
        drift_score = max(drift_score, peak_signal * 0.85)
    drift_score = max(0.0, min(1.0, drift_score))

    # Goal alignment bonus applies to any site (including YouTube) when the
    # content is actually relevant — not just non-distracting sites.
    if goal and relevance > mods['goal_alignment_threshold']:
        drift_score = max(0.0, drift_score + mods['goal_alignment_bonus'])
    if distracting and goal and relevance < mods['distracting_mismatch_threshold']:
        drift_score = min(1.0, drift_score + mods['distracting_mismatch_penalty'])
    elif distracting and not goal:
        drift_score = min(1.0, drift_score + mods['distracting_mismatch_penalty'] * 0.5)

    consecutive = features.get('consecutive_drift', 0)
    if consecutive >= mods['sustained_drift_threshold']:
        drift_score = min(1.0, drift_score + mods['sustained_drift_penalty'])

    session_min = features.get('session_duration', 0)
    if session_min > mods['session_fatigue_minutes']:
        drift_score = min(1.0, drift_score + mods['session_fatigue_penalty'])

    drift_score = max(0.0, min(1.0, drift_score))

    # EMA Smoothing: smooth out drift score transitions
    prev_score = features.get('previous_drift_score')
    if prev_score is not None:
        if drift_score < prev_score:
            # Slow recovery (e.g. going back to task)
            drift_score = prev_score * 0.85 + drift_score * 0.15
        else:
            # Fast reaction to new drifting signals
            drift_score = prev_score * 0.30 + drift_score * 0.70

    if drift_score < states['focused_max']:
        state = 'focused'
        confidence = min(0.65 + (states['focused_max'] - drift_score) * 0.5, 0.92)
    elif drift_score <= states['drifting_max']:
        state = 'drifting'
        confidence = min(0.50 + drift_score * 0.4, 0.85)
    else:
        state = 'gone'
        confidence = min(0.55 + drift_score * 0.35, 0.92)

    top_components = sorted(components.items(), key=lambda x: x[1] * weights.get(x[0], 0), reverse=True)
    reason = build_reason(features, components, state, top_components)

    return {
        'drift_score': round(drift_score, 4),
        'state': state,
        'confidence': round(confidence, 4),
        'components': {k: round(v, 4) for k, v in components.items()},
        'top_component': top_components[0][0] if top_components else None,
        'reason': reason,
        'is_distracting': distracting,
        'goal_relevance': round(relevance, 4),
    }


def build_reason(features, components, state, top_components=None):
    if top_components is None:
        config = load_config()
        weights = config['weights']
        top_components = sorted(components.items(), key=lambda x: x[1] * weights.get(x[0], 0), reverse=True)

    url = str(features.get('current_url', ''))
    goal = str(features.get('current_goal', ''))
    tab_per_min = features.get('tab_switches_per_min', 0)
    idle = features.get('idle_seconds', 0)
    relevance = features.get('goal_relevance', 0)

    if state == 'focused':
        if goal and relevance > 0.4:
            return 'Page content aligns with your goal.'
        return 'Behavior patterns look steady and on-task.'

    top_names = [SIGNAL_LABELS.get(k, k) for k, v in top_components[:3] if v > 0.1]
    parts = []

    if tab_per_min >= 20:
        parts.append(f'{round(tab_per_min)} tab switches/min')
    if idle >= 60:
        parts.append(f'{round(idle)}s idle')
    if components.get('distracting_context', 0) > 0 and goal and relevance < 0.3:
        parts.append(f"'{url}' doesn't match your goal")
    if not parts and top_names:
        parts.append(', '.join(top_names))

    if state == 'drifting':
        detail = ', '.join(parts) if parts else 'signals suggest wandering attention'
        return f'Drifting: {detail}.'

    detail = ', '.join(parts) if parts else f'deep distraction on {url or "this page"}'
    return f'Off track — {detail}.'
