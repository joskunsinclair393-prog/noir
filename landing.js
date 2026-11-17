(() => {
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
  let frame = 0;

  function render() {
    frame = 0;
    if (!motion.matches) {
      hero.style.removeProperty('--drift');
      panels.forEach(panel => panel.style.removeProperty('--preview-scale'));
      document.querySelectorAll('.chapter').forEach(section => section.removeAttribute('style'));
      typed.textContent = promptText;
      answer.textContent = answerText;
      return;
    }
    hero.style.setProperty('--drift', Math.round(Math.min(scrollY, hero.offsetHeight) * .09) + 'px');
    const focus = innerHeight * .48;
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
    hero.style.setProperty('--headline-drift', -heroProgress * 55 + 'px');
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
    journey.style.setProperty('--phone-tilt', (1 - entry) * 8 + 'deg');
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

  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  motion.addEventListener('change', schedule);
  schedule();
})();
