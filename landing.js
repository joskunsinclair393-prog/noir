(() => {
  if (/^#\/?studio(?:\/|$|\?)/i.test(location.hash)) { location.replace('/app'); return; }
  const locationState = new URLSearchParams(location.search);
  if (location.pathname === '/' && (['code', 'error', 'error_description', 'settings', 'connector', 'plus'].some(key => locationState.has(key)) ||
      /^#(?:access_token|error|error_code)=/.test(location.hash))) {
    location.replace('/app' + location.search + location.hash);
    return;
  }
  if (!('IntersectionObserver' in window)) return;
  const rail = [...document.querySelectorAll('.chapter-rail a')];
  const railObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      document.querySelector('.site-header').dataset.chapter = entry.target.id;
      for (const link of rail) {
        const active = link.hash === '#' + entry.target.id;
        link.classList.toggle('current', active);
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-25% 0px -45%' });
  document.querySelectorAll('.chapter').forEach(section => railObserver.observe(section));
  const motion = matchMedia('(min-width: 761px) and (prefers-reduced-motion: no-preference)');
  const hero = document.querySelector('.hero');
  const panels = [...document.querySelectorAll('[data-scroll-panel]')];
  const journey = document.querySelector('[data-phone-journey]');
  const phone = document.querySelector('.demo-phone');
  const typed = document.querySelector('#phone-typed');
  const answer = document.querySelector('#phone-response');
  const promptText = typed.textContent;
  const answerText = answer.textContent;
  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  const monitorJourney = document.querySelector('[data-monitor-journey]');
  const monitorPrompt = document.querySelector('#monitor-typed');
  const monitorAnswer = document.querySelector('#monitor-answer');
  const monitorPromptText = monitorPrompt.textContent;
  const monitorAnswerText = monitorAnswer.textContent;
  const monitorPoints = [...document.querySelectorAll('.monitor-point')];
  monitorPoints.forEach(point => {
    point.addEventListener('click', () => {
      const selected = point.getAttribute('aria-expanded') !== 'true';
      monitorPoints.forEach(item => item.setAttribute('aria-expanded', String(item === point && selected)));
    });
    point.addEventListener('keydown', event => {
      if (event.key === 'Escape') { point.setAttribute('aria-expanded', 'false'); point.blur(); }
    });
  });
  function renderMonitor(progress, staticMode = false) {
    const entry = clamp(progress / .23, 0, 1);
    const drawing = staticMode ? 1 : clamp((progress - .49) / .29, 0, 1);
    const closeup = clamp((progress - .68) / .2, 0, 1);
    const exit = clamp((progress - .88) / .12, 0, 1);
    if (staticMode) monitorJourney.removeAttribute('style');
    else {
      const set = (key, value) => monitorJourney.style.setProperty('--monitor-' + key, value);
      set('x', -exit * 85 + 'px');
      set('y', (1 - entry) * 150 - exit * 35 + 'px');
      set('yaw', -24 * (1 - entry) - exit * 6 + 'deg');
      set('pitch', 12 * (1 - entry) + closeup * 2 + 'deg');
      set('roll', -3 * (1 - entry) + 'deg');
      set('scale', .82 + entry * .16 + closeup * .07 - exit * .035);
      set('route', clamp((progress - .31) / .07, 0, 1));
      set('chart-opacity', clamp((progress - .44) / .08, 0, 1));
      set('chart-y', (1 - clamp((progress - .44) / .12, 0, 1)) * 24 + 'px');
      set('chart-scale', .96 + closeup * .04);
      set('line-offset', 1 - drawing);
      set('chart-clip', (1 - drawing) * 100 + '%');
      set('bars-scale', clamp((progress - .55) / .25, 0, 1));
    }
    monitorPrompt.textContent = monitorPromptText.slice(0, Math.round(monitorPromptText.length * (staticMode ? 1 : clamp((progress - .12) / .2, 0, 1))));
    monitorAnswer.textContent = monitorAnswerText.slice(0, Math.round(monitorAnswerText.length * (staticMode ? 1 : clamp((progress - .36) / .15, 0, 1))));
    const count = staticMode ? 1 : clamp((progress - .55) / .25, 0, 1);
    document.querySelector('#monitor-visits').textContent = Math.round(18000 * count).toLocaleString('en-AU');
    document.querySelector('#monitor-growth').textContent = '+' + Math.round(140 * count) + '%';
    document.querySelector('#monitor-conversion').textContent = (3.8 * count).toFixed(1) + '%';
    monitorPoints.forEach((point, index) => {
      const visible = staticMode ? 1 : clamp((drawing - index / 6) * 6, 0, 1);
      point.style.setProperty('--point-progress', visible);
      point.disabled = visible < .5;
      if (point.disabled) point.setAttribute('aria-expanded', 'false');
    });
  }
  let frame = 0;

  function render() {
    frame = 0;
    if (!motion.matches) {
      hero.removeAttribute('style');
      journey.removeAttribute('style');
      panels.forEach(panel => panel.style.removeProperty('--preview-scale'));
      document.querySelectorAll('.chapter').forEach(section => section.removeAttribute('style'));
      typed.textContent = promptText;
      answer.textContent = answerText;
      renderMonitor(1, true);
      return;
    }
    hero.style.setProperty('--drift', Math.round(Math.min(scrollY, hero.offsetHeight) * .09) + 'px');
    for (const panel of panels) {
      const bounds = panel.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > innerHeight) continue;
      const entry = clamp((innerHeight - bounds.top) / (innerHeight * .65), 0, 1);
      panel.style.setProperty('--preview-scale', (.965 + entry * .035).toFixed(4));
    }
    const progressFor = element => {
      const rect = element.getBoundingClientRect();
      return clamp((innerHeight * .85 - rect.top) / (rect.height + innerHeight * .3), 0, 1);
    };
    const heroProgress = clamp(scrollY / hero.offsetHeight, 0, 1);
    hero.style.setProperty('--logo-scale', 1 - heroProgress * .8);
    hero.style.setProperty('--logo-x', -heroProgress * 12 + 'px');
    hero.style.setProperty('--logo-y', -heroProgress * 165 + 'px');
    hero.style.setProperty('--letter-shift', heroProgress * 12 + 'px');
    hero.style.setProperty('--opening-ui', .6 + heroProgress * .4);
    hero.style.setProperty('--opening-lift', -heroProgress * 60 + 'px');
    for (const id of ['features', 'verify', 'projects', 'challenge']) {
      const section = document.getElementById(id);
      const progress = progressFor(section);
      section.style.setProperty('--flow-offset', 1 - progress);
      section.style.setProperty('--nodes-visible', .35 + progress * .65);
      section.style.setProperty('--nodes-y', (1 - progress) * 12 + 'px');
      section.style.setProperty('--selected-stroke', 1 + progress * 2);
    }
    hero.style.setProperty('--hero-y', -9 + heroProgress * 9 + 'deg');
    hero.style.setProperty('--hero-x', 5 - heroProgress * 5 + 'deg');
    hero.style.setProperty('--hero-z', -3 + heroProgress * 3 + 'deg');
    hero.style.setProperty('--hero-scale', 1 + heroProgress * .07);
    const model = document.querySelector('#product');
    model.style.setProperty('--marquee-x', -progressFor(model) * 115 + 'px');
    const route = document.querySelector('#features');
    const rp = progressFor(route);
    route.style.setProperty('--route-travel', rp * 32 + 'px');
    route.style.setProperty('--route-selected', clamp(rp * 2, .2, 1));
    const verify = document.querySelector('#verify');
    const vp = progressFor(verify);
    verify.style.setProperty('--verify-mask', 100 - vp * 100 + '%');
    verify.style.setProperty('--verify-y', 25 * (1 - vp) + 'px');
    verify.style.setProperty('--verify-opacity', vp);
    const project = document.querySelector('#projects');
    const pp = progressFor(project);
    project.style.setProperty('--project-x', pp * 15 + 'px');
    project.style.setProperty('--project-y', pp * 35 + 'px');
    project.style.setProperty('--project-scale', 1 - pp * .1);
    const challenge = document.querySelector('#challenge');
    const cp = progressFor(challenge);
    challenge.style.setProperty('--challenge-left', -65 * (1 - cp) + 'px');
    challenge.style.setProperty('--challenge-right', 65 * (1 - cp) + 'px');
    const rect = journey.getBoundingClientRect();
    const p = clamp((110 - rect.top) / Math.max(1, rect.height - 650), 0, 1);
    const entry = clamp(p / .2, 0, 1);
    const exit = clamp((p - .75) / .25, 0, 1);
    journey.style.setProperty('--phone-x', (1 - entry) * 130 - exit * 30 + 'px');
    journey.style.setProperty('--phone-turn', (1 - entry) * -27 + 'deg');
    journey.style.setProperty('--phone-tilt', (1 - entry) * 8 - exit * 4 + 'deg');
    journey.style.setProperty('--phone-brightness', .3 + entry * .7);
    journey.style.setProperty('--phone-scale', .88 + entry * .12 - exit * .05);
    typed.textContent = promptText.slice(0, Math.round(promptText.length * clamp((p - .12) / .2, 0, 1)));
    journey.style.setProperty('--phone-route', clamp((p - .32) / .08, 0, 1));
    answer.textContent = answerText.slice(0, Math.round(answerText.length * clamp((p - .4) / .22, 0, 1)));
    journey.style.setProperty('--phone-project', clamp((p - .65) / .09, 0, 1));
    journey.style.setProperty('--phone-project-y', 20 * (1 - clamp((p - .65) / .09, 0, 1)) + 'px');
    journey.style.setProperty('--phone-copy', clamp((p - .7) / .15, 0, 1));
    journey.style.setProperty('--phone-copy-y', 30 * (1 - exit) + 'px');
    const closing = document.querySelector('#about');
    closing.style.setProperty('--closing-scale', .93 + progressFor(closing) * .07);
    const monitorBounds = monitorJourney.getBoundingClientRect();
    renderMonitor(clamp((100 - monitorBounds.top) / Math.max(1, monitorBounds.height - innerHeight + 115), 0, 1));

  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  motion.addEventListener('change', schedule);
  schedule();
})();
