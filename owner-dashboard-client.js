const range = document.querySelector('#range');
range.addEventListener('change', () => range.form.requestSubmit());

function selectSection() {
  const links = [...document.querySelectorAll('.sidebar nav a')];
  const selected = links.find(link => link.hash === location.hash) || links[0];
  for (const link of links) {
    link.toggleAttribute('aria-current', link === selected);
    document.getElementById(link.hash.slice(1)).hidden = link !== selected;
  }
}
window.addEventListener('hashchange', selectSection);
selectSection();

let polling = false;
let expired = false;
setInterval(async () => {
  if (document.hidden || polling || expired) return;
  const dashboard = document.querySelector('#dashboard');
  if (dashboard.matches(':focus-within') || dashboard.querySelector('svg:hover') || dashboard.querySelector('details[open]')) return;
  const status = document.querySelector('#refresh-status');
  polling = true;
  try {
    const response = await fetch(location.pathname + location.search, { signal: AbortSignal.timeout(8000) });
    if (response.status === 403) {
      expired = true;
      status.textContent = 'Session expired. Return to NOIR and reopen the Command Center.';
      return;
    }
    if (!response.ok) throw Error('Refresh failed');
    const updated = new DOMParser().parseFromString(await response.text(), 'text/html');
    const content = updated.querySelector('#dashboard');
    if (!content) throw Error('Dashboard unavailable');
    if (dashboard.matches(':focus-within') || dashboard.querySelector('svg:hover') || dashboard.querySelector('details[open]')) return;
    dashboard.replaceWith(content);
    selectSection();
    document.querySelector('#updated-at').textContent = updated.querySelector('#updated-at').textContent;
    status.textContent = '';
  } catch {
    status.textContent = 'Refresh failed. The last loaded figures are still shown.';
  } finally {
    polling = false;
  }
}, 60_000);
