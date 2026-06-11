const API = 'http://localhost:5000';

let isLoading = false;

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle').textContent = theme === 'light' ? '☾' : '☀';
  chrome.storage.local.set({ agTheme: theme });
}

chrome.storage.local.get(['agTheme'], (r) => applyTheme(r.agTheme || 'dark'));
document.getElementById('theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

const TYPE_LABELS = {
  'off_track_catch': 'Off-track catch',
  'self-correction': 'Self-correction',
  'realization': 'Realization',
  'mirror+recall': 'Mirror',
  'fade': 'Fade',
};

async function load() {
  if (isLoading) return;
  isLoading = true;
  const btn = document.getElementById('refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Loading…'; }
  try {
    const res = await fetch(`${API}/api/dashboard`);
    const data = await res.json();
    renderHeatmap(data.timeline);
    renderSummary(data.timeline);
    renderSites(data.siteStates);
    renderInterventions(data.interventions);
    renderTrend(data.weeklyTrends);
    const ts = document.getElementById('last-updated');
    if (ts) ts.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    document.querySelector('.dashboard').innerHTML += '<p style="color:#f87171;text-align:center;margin-top:20px;">⚠️ Cannot connect to backend. Make sure Flask is running on localhost:5000</p>';
  } finally {
    isLoading = false;
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
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
  const counts = { focused: 0, drifting: 0, gone: 0 };
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
  if (!entries.length) { container.innerHTML = '<p class="empty-msg">No site data yet</p>'; return; }
  container.innerHTML = entries.map(([site, s]) => {
    const total = s.focused + s.drifting + s.gone || 1;
    return `<div class="site-row">
      <div class="site-name">${site}</div>
      <div class="site-bar">
        <div class="seg focused" style="width:${s.focused / total * 100}%"></div>
        <div class="seg drifting" style="width:${s.drifting / total * 100}%"></div>
        <div class="seg gone" style="width:${s.gone / total * 100}%"></div>
      </div>
    </div>`;
  }).join('');
}

function renderInterventions(interventions) {
  const container = document.getElementById('interventions');
  if (!interventions.length) { container.innerHTML = '<p class="empty-msg">No catches yet</p>'; return; }
  container.innerHTML = interventions.slice(0, 25).map(i => {
    const time = new Date(i.timestamp).toLocaleTimeString();
    const typeLabel = TYPE_LABELS[i.type] || i.type;
    return `<div class="intervention-item">
      <span class="intervention-type">${typeLabel}</span>
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
  if (!days.length) { ctx.fillStyle = '#666'; ctx.font = '13px Inter'; ctx.fillText('No weekly data yet', w / 2 - 60, h / 2); return; }

  const maxVal = Math.max(...days.map(d => weeklyTrends[d].total), 1);
  const barW = Math.min(40, (w - 60) / days.length - 8);
  const colors = { focused: getComputedStyle(document.documentElement).getPropertyValue('--focused').trim() || '#6b9e78',
    drifting: getComputedStyle(document.documentElement).getPropertyValue('--drifting').trim() || '#d4a054',
    gone: getComputedStyle(document.documentElement).getPropertyValue('--gone').trim() || '#c45c5c' };

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
    ctx.fillText(date.toLocaleDateString('en', { weekday: 'short' }), x, h - 4);
  });
}

load();
setInterval(load, 60000);
document.getElementById('refresh-btn').addEventListener('click', load);
