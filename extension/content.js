(function () {
  const S = { scrollY: 0, lastScrollY: 0, scrollEvents: [], mouseEvents: [], clicks: 0, dirChanges: 0, lastDir: 0, hoverStart: null, hoversWithoutClick: 0, keypresses: 0, lastActivityTime: Date.now() };
  let recentScrolls = [];
  let recentMouse = [];

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      S.lastActivityTime = Date.now();
    }
  });

  let wasHiddenLong = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      wasHiddenLong = true;
    } else if (wasHiddenLong) {
      wasHiddenLong = false;
      chrome.runtime.sendMessage({ type: 'REALIZATION_CHECK', reason: 'tab_return' });
    }
  });

  window.addEventListener('scroll', () => {
    const y = window.scrollY, dy = y - S.lastScrollY, dir = Math.sign(dy);
    if (dir !== 0 && dir !== S.lastDir && S.lastDir !== 0) S.dirChanges++;
    S.lastDir = dir;
    S.scrollEvents.push({ y, t: Date.now(), dy });
    S.lastScrollY = y;
    S.lastActivityTime = Date.now();

    recentScrolls.push({ y, t: Date.now() });
    if (recentScrolls.length > 10) recentScrolls.shift();
    if (recentScrolls.length > 2) {
      const oldest = recentScrolls[0];
      const newest = recentScrolls[recentScrolls.length - 1];
      const dt_scroll = newest.t - oldest.t;
      const dy_scroll = newest.y - oldest.y;
      if (dt_scroll > 0 && dt_scroll < 500 && dy_scroll < -800) {
        chrome.runtime.sendMessage({ type: 'SELF_CORRECT', reason: 'recoil_scroll' });
        recentScrolls = [];
      }
    }
  }, { passive: true });

  window.addEventListener('mousemove', (e) => {
    S.mouseEvents.push({ x: e.clientX, y: e.clientY, t: Date.now() });
    S.lastActivityTime = Date.now();

    recentMouse.push({ y: e.clientY, t: Date.now() });
    if (recentMouse.length > 10) recentMouse.shift();
    if (recentMouse.length > 2) {
      const oldest = recentMouse[0];
      const newest = recentMouse[recentMouse.length - 1];
      const dt_mouse = newest.t - oldest.t;
      const dy_mouse = newest.y - oldest.y;
      if (dt_mouse > 0 && dt_mouse < 300 && dy_mouse < -400 && newest.y < 50) {
        chrome.runtime.sendMessage({ type: 'SELF_CORRECT', reason: 'bailout_flick' });
        recentMouse = [];
      }
    }
  }, { passive: true });

  window.addEventListener('click', () => { S.clicks++; S.lastActivityTime = Date.now(); });

  window.addEventListener('keydown', () => { S.keypresses++; S.lastActivityTime = Date.now(); }, { passive: true });

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
      for (let i = 1; i < scrolls.length; i++) gaps.push(scrolls[i].t - scrolls[i - 1].t);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
      consistency = 1 / (1 + Math.sqrt(variance) / 1000);
    }
    const mouseActivity = mice.length > 1 ? mice.reduce((a, e, i) => i === 0 ? 0 : a + Math.hypot(mice[i].x - mice[i - 1].x, mice[i].y - mice[i - 1].y), 0) / mice.length : 0;
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
        keypresses: S.keypresses,
        hoversWithoutClick: S.hoversWithoutClick,
        scrollDepth: Math.round(scrollDepth * 1000) / 1000,
        contentLength,
        url: location.hostname,
        title: document.title,
        timestamp: now
      }
    });

    S.scrollEvents = scrolls;
    S.mouseEvents = mice;
    S.dirChanges = 0;
    S.clicks = 0;
    S.keypresses = 0;
    S.hoversWithoutClick = 0;
  }

  setInterval(computeAndSend, 5000);
})();
