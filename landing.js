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
  const workflow = document.querySelector('.workflow-preview');
  const steps = [...document.querySelectorAll('[data-workflow-step]')];
  const views = [...workflow.querySelectorAll('.workflow-panel')];
  const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
  let frame = 0;

  function render() {
    frame = 0;
    if (!motion.matches) {
      hero.style.removeProperty('--drift');
      panels.forEach(panel => panel.style.removeProperty('--preview-scale'));
      workflow.classList.remove('is-enhanced');
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
    const limits = steps.map(step => {
      const bounds = step.getBoundingClientRect();
      return bounds.top + bounds.height * .5;
    });
    const next = limits.findIndex(center => center >= focus);
    const previous = clamp(next === -1 ? steps.length - 1 : next - 1, 0, steps.length - 1);
    const progress = next <= 0 ? previous : previous + clamp((focus - limits[previous]) / (limits[next] - limits[previous]), 0, 1);
    for (const [index, view] of views.entries()) {
      const weight = clamp(1 - Math.abs(progress - index), 0, 1);
      view.style.opacity = weight.toFixed(3);
      view.style.transform = 'translateX(' + ((index - progress) * 110).toFixed(2) + '%)';
    }
    workflow.classList.add('is-enhanced');
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  motion.addEventListener('change', schedule);
  schedule();
})();
