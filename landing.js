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
  const scenes = document.querySelectorAll('[data-scene]');
  if (!scenes.length) return;
  const sceneObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      const scene = entry.target;
      document.querySelector('#showcase-name').textContent = scene.querySelector('h3').firstChild.textContent.trim();
      document.querySelector('#showcase-title').textContent = scene.querySelector('p').textContent;
      document.querySelector('#showcase-detail').hidden = true;
      for (const item of scenes) item.classList.toggle('active', item === scene);
    }
  }, { rootMargin: '-20% 0px -45%' });
  scenes.forEach(scene => sceneObserver.observe(scene));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const hero = document.querySelector('.hero');
  let pending = false;
  window.addEventListener('scroll', () => {
    if (pending || scrollY > hero.offsetHeight) return;
    pending = true;
    requestAnimationFrame(() => {
      hero.style.setProperty('--drift', Math.round(scrollY * .09) + 'px');
      pending = false;
    });
  }, { passive: true });
})();
