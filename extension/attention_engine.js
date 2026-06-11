const SIGNAL_LABELS = {
  tab_switch_rate: 'tab switching',
  scroll_velocity: 'fast scrolling',
  scroll_consistency: 'rhythmic scrolling',
  idle_time: 'idle time',
  passive_browse: 'passive browsing',
  direction_chaos: 'erratic scrolling',
  low_interaction: 'low interaction',
  distracting_context: 'distracting site',
  goal_mismatch: 'goal mismatch',
};

let _config = null;

async function loadConfig() {
  if (_config) return _config;
  const url = chrome.runtime.getURL('attention_config.json');
  const res = await fetch(url);
  _config = await res.json();
  return _config;
}

const _GOAL_SUPPORT_CLUSTERS = {
  essay: new Set(['essay', 'write', 'writing', 'thesis', 'argument', 'paragraph', 'outline', 'draft', 'revision', 'cite', 'citation', 'analyze', 'analysis', 'structure', 'introduction', 'conclusion', 'body']),
  homework: new Set(['homework', 'study', 'learn', 'tutorial', 'guide', 'tips', 'practice', 'solve', 'explain', 'review']),
  study: new Set(['study', 'learn', 'tutorial', 'guide', 'tips', 'review', 'explain']),
  code: new Set(['code', 'coding', 'programming', 'debug', 'tutorial', 'algorithm']),
  math: new Set(['math', 'algebra', 'calculus', 'equation', 'problem', 'solve']),
  history: new Set(['history', 'historical', 'era', 'war', 'revolution', 'century']),
  science: new Set(['science', 'biology', 'chemistry', 'physics', 'experiment', 'lab']),
};

const _VIDEO_DOMAINS = new Set(['youtube', 'vimeo', 'twitch', 'dailymotion', 'coursera', 'udemy', 'khanacademy', 'ted', 'nebula']);

function isVideoSite(url) {
  const urlLower = String(url || '').toLowerCase();
  for (const d of _VIDEO_DOMAINS) {
    if (urlLower.includes(d)) return true;
  }
  return false;
}

function goalRelevance(title, goal) {
  if (!title || !goal) return 0;
  const stop = new Set(['for', 'and', 'the', 'to', 'a', 'in', 'of', 'on', 'is', 'my', 'how', 'what', 'why', 'with', 'do', 'does', 'be', 'are', 'was', 'were', 'an', 'at', 'by', 'this', 'that']);
  const tw = new Set(title.toLowerCase().split(/\W+/).filter(w => w && !stop.has(w)));
  const gw = new Set(goal.toLowerCase().split(/\W+/).filter(w => w && !stop.has(w)));
  if (gw.size === 0) return 0;

  const direct = Array.from(gw).filter(w => tw.has(w)).length / gw.size;

  let supportBonus = 0;
  for (const [key, terms] of Object.entries(_GOAL_SUPPORT_CLUSTERS)) {
    if (gw.has(key)) {
      const overlap = Array.from(terms).filter(t => tw.has(t)).length;
      if (overlap > 0) {
        supportBonus = Math.max(supportBonus, Math.min(0.35 * overlap, 0.6));
      }
    }
  }

  return Math.min(direct + supportBonus, 1);
}

function isDistracting(url, config) {
  const urlLower = String(url || '').toLowerCase();
  return config.distracting_domains.some(d => urlLower.includes(d));
}

function signalDrift(value, focusedMax, driftingAt, goneAt) {
  if (value <= focusedMax) return 0;
  if (value >= goneAt) return 1;
  if (driftingAt <= focusedMax) return 1;
  if (value <= driftingAt) return 0.4 * (value - focusedMax) / (driftingAt - focusedMax);
  if (goneAt <= driftingAt) return 1;
  return 0.4 + 0.6 * (value - driftingAt) / (goneAt - driftingAt);
}

function lowInteractionDrift(value, focusedMin, driftingBelow, goneBelow) {
  if (value >= focusedMin) return 0;
  if (value <= goneBelow) return 1;
  if (value <= driftingBelow) {
    return 0.4 + 0.6 * (driftingBelow - value) / Math.max(driftingBelow - goneBelow, 0.001);
  }
  return 0.4 * (focusedMin - value) / Math.max(focusedMin - driftingBelow, 0.001);
}

function passiveBrowseScore(scrollVel, mouseActivity, interactionPerMin) {
  if (scrollVel <= 5) return 0;
  const velFactor = Math.min(scrollVel / 18, 1);
  const mouseFactor = 1 - Math.min(mouseActivity / 8, 1);
  const interactFactor = 1 - Math.min(interactionPerMin / 2, 1);
  return Math.min(velFactor * 0.5 + mouseFactor * 0.25 + interactFactor * 0.25, 1);
}

function normalizeFeatures(raw, config) {
  const features = { ...raw };
  if (features.tab_switches_per_min == null) {
    const tab5 = features.tab_switches_5min || 0;
    features.tab_switches_per_min = tab5 / 5;
  }
  if (features.interaction_per_min == null) {
    features.interaction_per_min = (features.clicks_per_min || 0) + (features.keypresses_per_min || 0);
  }
  const scrollVel = features.avg_scroll_velocity || 0;
  const mouse = features.mouse_activity || 0;
  const interaction = features.interaction_per_min || 0;
  if (features.passive_browse_score == null) {
    features.passive_browse_score = passiveBrowseScore(scrollVel, mouse, interaction);
  }
  const url = features.current_url || '';
  const title = features.page_title || '';
  const goal = features.current_goal || '';
  if (features.goal_relevance == null) {
    features.goal_relevance = goalRelevance(title, goal);
  }
  if (features.is_distracting == null) {
    features.is_distracting = isDistracting(url, config) ? 1 : 0;
  }
  return features;
}

function buildReason(features, components, state, topComponents, weights) {
  const url = String(features.current_url || '');
  const goal = String(features.current_goal || '');
  const tabPerMin = features.tab_switches_per_min || 0;
  const idle = features.idle_seconds || 0;
  const relevance = features.goal_relevance || 0;

  if (state === 'focused') {
    if (goal && relevance > 0.4) return 'Page content aligns with your goal.';
    return 'Behavior patterns look steady and on-task.';
  }

  const parts = [];
  if (tabPerMin >= 20) parts.push(`${Math.round(tabPerMin)} tab switches/min`);
  if (idle >= 60) parts.push(`${Math.round(idle)}s idle`);
  if (components.distracting_context > 0 && goal && relevance < 0.3) {
    parts.push(`'${url}' doesn't match your goal`);
  }
  if (!parts.length) {
    const topNames = topComponents.filter(([, v]) => v > 0.1).slice(0, 3).map(([k]) => SIGNAL_LABELS[k] || k);
    if (topNames.length) parts.push(topNames.join(', '));
  }

  if (state === 'drifting') {
    const detail = parts.length ? parts.join(', ') : 'signals suggest wandering attention';
    return `Drifting: ${detail}.`;
  }
  const detail = parts.length ? parts.join(', ') : `deep distraction on ${url || 'this page'}`;
  return `Off track — ${detail}.`;
}

function computeDriftSync(rawFeatures, config) {
  const features = normalizeFeatures(rawFeatures, config);
  const weights = config.weights;
  const sig = config.signals;
  const mods = config.modifiers;
  const states = config.states;

  const url = features.current_url || '';
  const goal = features.current_goal || '';
  const relevance = features.goal_relevance || 0;
  const distracting = isDistracting(url, config);

  const videoSite = isVideoSite(url);
  const videoRelevanceThreshold = mods.video_relevance_threshold || 0.35;
  const relevantVideo = videoSite && goal && relevance >= videoRelevanceThreshold;
  const videoSuppress = relevantVideo ? Math.max(0, 1 - relevance) : 1;

  const components = {
    tab_switch_rate: signalDrift(
      features.tab_switches_per_min || 0,
      sig.tab_switches_per_min.focused_max,
      sig.tab_switches_per_min.drifting_at,
      sig.tab_switches_per_min.gone_at,
    ),
    scroll_velocity: signalDrift(
      features.avg_scroll_velocity || 0,
      sig.scroll_velocity.focused_max,
      sig.scroll_velocity.drifting_at,
      sig.scroll_velocity.gone_at,
    ),
    scroll_consistency: signalDrift(
      features.scroll_consistency || 0,
      sig.scroll_consistency.focused_max,
      sig.scroll_consistency.drifting_at,
      sig.scroll_consistency.gone_at,
    ),
    idle_time: signalDrift(
      features.idle_seconds || 0,
      sig.idle_seconds.focused_max,
      sig.idle_seconds.drifting_at,
      sig.idle_seconds.gone_at,
    ) * videoSuppress,
    direction_chaos: signalDrift(
      features.direction_changes_per_min || 0,
      sig.direction_changes_per_min.focused_max,
      sig.direction_changes_per_min.drifting_at,
      sig.direction_changes_per_min.gone_at,
    ),
    low_interaction: lowInteractionDrift(
      features.interaction_per_min || 0,
      sig.interaction_per_min.focused_min,
      sig.interaction_per_min.drifting_below,
      sig.interaction_per_min.gone_below,
    ) * videoSuppress,
    passive_browse: (features.passive_browse_score || 0) * videoSuppress,
    distracting_context: !distracting ? 0 : goal ? Math.max(0, 1 - relevance / Math.max(mods.distracting_mismatch_threshold, 0.001)) : 1,
    goal_mismatch: distracting && goal && relevance < mods.distracting_mismatch_threshold
      ? 1
      : distracting && !goal ? 0.5 : 0,
  };

  let driftScore = Object.keys(weights).reduce((sum, k) => sum + weights[k] * (components[k] || 0), 0);
  if (!relevantVideo) {
    const peakSignal = Math.max(...Object.values(components), 0);
    driftScore = Math.max(driftScore, peakSignal * 0.85);
  }
  driftScore = Math.max(0, Math.min(1, driftScore));

  if (goal && relevance > mods.goal_alignment_threshold) {
    driftScore = Math.max(0, driftScore + mods.goal_alignment_bonus);
  }
  if (distracting && goal && relevance < mods.distracting_mismatch_threshold) {
    driftScore = Math.min(1, driftScore + mods.distracting_mismatch_penalty);
  } else if (distracting && !goal) {
    driftScore = Math.min(1, driftScore + mods.distracting_mismatch_penalty * 0.5);
  }

  const consecutive = features.consecutive_drift || 0;
  if (consecutive >= mods.sustained_drift_threshold) {
    driftScore = Math.min(1, driftScore + mods.sustained_drift_penalty);
  }

  const sessionMin = features.session_duration || 0;
  if (sessionMin > mods.session_fatigue_minutes) {
    driftScore = Math.min(1, driftScore + mods.session_fatigue_penalty);
  }

  driftScore = Math.max(0, Math.min(1, driftScore));

  const prevScore = features.previous_drift_score;
  if (prevScore != null) {
    if (driftScore < prevScore) {
      driftScore = prevScore * 0.85 + driftScore * 0.15;
    } else {
      driftScore = prevScore * 0.30 + driftScore * 0.70;
    }
  }

  let state;
  let confidence;
  if (driftScore < states.focused_max) {
    state = 'focused';
    confidence = Math.min(0.65 + (states.focused_max - driftScore) * 0.5, 0.92);
  } else if (driftScore <= states.drifting_max) {
    state = 'drifting';
    confidence = Math.min(0.50 + driftScore * 0.4, 0.85);
  } else {
    state = 'gone';
    confidence = Math.min(0.55 + driftScore * 0.35, 0.92);
  }

  const topComponents = Object.entries(components)
    .sort((a, b) => b[1] * (weights[a[0]] || 0) - a[1] * (weights[b[0]] || 0));
  const reason = buildReason(features, components, state, topComponents, weights);

  const roundedComponents = {};
  Object.keys(components).forEach(k => { roundedComponents[k] = Math.round(components[k] * 10000) / 10000; });

  return {
    drift_score: Math.round(driftScore * 10000) / 10000,
    driftState: state,
    state,
    confidence: Math.round(confidence * 10000) / 10000,
    score: driftScore,
    components: roundedComponents,
    top_component: topComponents[0] ? topComponents[0][0] : null,
    reason,
    distracting,
    relevance,
  };
}

async function computeDrift(rawFeatures) {
  const config = await loadConfig();
  return computeDriftSync(rawFeatures, config);
}

// Export for service worker (no module bundler)
if (typeof self !== 'undefined') {
  self.attentionEngine = { loadConfig, computeDrift, computeDriftSync, goalRelevance, isDistracting, SIGNAL_LABELS };
}
