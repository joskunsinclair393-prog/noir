// All data entering this renderer is aggregate and all labels are escaped.
const escaped = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const unavailable = 'Not yet available';
const number = value => Number.isSafeInteger(value) && value >= 0;
const count = value => number(value) ? new Intl.NumberFormat('en-AU').format(value) : unavailable;
const percent = value => Number.isFinite(value) ? new Intl.NumberFormat('en-AU', { style: 'percent', maximumFractionDigits: 1 }).format(value) : unavailable;
const aud = value => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', currencyDisplay: 'code' }).format(value);

const sections = [
  ['overview', 'Overview', '⊞'], ['revenue', 'Revenue', '$'], ['users', 'Users', '◎'],
  ['ai', 'AI Analytics', '◇'], ['subscriptions', 'Subscriptions', '▤'], ['health', 'System Health', '＋'],
];
const cards = entries => '<dl class="cards">' + entries.map(([label, value, detail]) =>
  '<div><dt>' + escaped(label) + '</dt><dd>' + escaped(typeof value === 'string' ? value : count(value)) +
  '</dd>' + (detail ? '<dd class="detail">' + escaped(detail) + '</dd>' : '') + '</div>').join('') + '</dl>';
const panel = (title, content, detail = '') => '<article class="panel"><h3>' + escaped(title) + '</h3>' +
  (detail ? '<p>' + escaped(detail) + '</p>' : '') + content + '</article>';
const empty = (message = unavailable) => '<p class="empty">' + escaped(message) + '</p>';
const time = value => value ? value.slice(0, 19).replace('T', ' ') + ' UTC' : unavailable;

function timeline(title, rows, { series = [['requests', 'Count']], style = 'line', measured = false } = {}) {
  const points = (rows || []).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.day));
  if (!points.length) return panel(title, empty(measured ? 'No activity recorded in this range.' : unavailable));
  const values = points.map(row => series.map(([key]) => number(row[key]) ? row[key] : 0));
  const ts = points.map(row => Date.parse(row.day));
  const span = ts.at(-1) - ts[0];
  const x = index => span ? 28 + (ts[index] - ts[0]) / span * 520 : 288;
  const max = Math.max(1, ...values.map(row => row.reduce((sum, value) => sum + value, 0)));
  const y = value => 140 - value / max * 124;
  const grid = [0, .25, .5, .75, 1].map(n => '<path class="gridline" d="M 18 ' + y(n * max) + ' H 558"/>').join('');
  const plot = style === 'stack'
    ? values.map((row, i) => {
      let offset = 0;
      return row.map((value, j) => {
        offset += value;
        return '<rect class="series-' + j + '" x="' + (x(i) - 2.5) + '" y="' + y(offset) +
          '" width="5" height="' + (value / max * 124) + '"><title>' + escaped(points[i].day + ' · ' + series[j][1] + ': ' + count(value)) + '</title></rect>';
      }).join('');
    }).join('')
    : (() => {
      const line = values.map(([value], i) => x(i) + ',' + y(value)).join(' ');
      return (style === 'area' ? '<polygon class="area" points="' + x(0) + ',140 ' + line + ' ' + x(values.length - 1) + ',140"/>' : '') +
        '<polyline class="line" points="' + line + '"/>' + values.map(([value], i) =>
          '<circle class="point" cx="' + x(i) + '" cy="' + y(value) + '" r="5"><title>' +
          escaped(points[i].day + ' · ' + count(value)) + '</title></circle>').join('');
    })();
  const table = '<details><summary>Chart data</summary><table><thead><tr><th scope="col">Date</th>' +
    series.map(([, label]) => '<th scope="col">' + escaped(label) + '</th>').join('') +
    '</tr></thead><tbody>' + points.map((row, i) => '<tr><th scope="row">' + escaped(row.day) + '</th>' +
      values[i].map(value => '<td>' + count(value) + '</td>').join('') + '</tr>').join('') + '</tbody></table></details>';
  return panel(title, '<svg viewBox="0 0 576 156" aria-hidden="true">' + grid + plot + '</svg><div class="axis"><span>' +
    escaped(points[0].day) + '</span><span>' + escaped(points.at(-1).day) + '</span></div>' + table,
    series.length > 1 ? 'Violet · first active. Blue · returning.' : '');
}

function distribution(title, rows, donut = false) {
  const items = (rows || []).filter(row => number(row.requests) && row.requests > 0);
  if (!items.length) return panel(title, empty('No model or plan activity to display.'));
  const max = Math.max(...items.map(row => row.requests));
  const total = items.reduce((sum, row) => sum + row.requests, 0);
  let offset = 0;
  const chart = donut ? '<svg class="donut" viewBox="0 0 100 100" aria-hidden="true">' + items.map((row, index) => {
    const size = row.requests / total * 100;
    const segment = '<circle cx="50" cy="50" r="39" pathLength="100" fill="none" stroke-width="13" class="slice palette-' + index % 4 +
      '" stroke-dasharray="' + size + ' ' + (100 - size) + '" stroke-dashoffset="' + -offset + '"><title>' +
      escaped(row.model + ' · ' + count(row.requests)) + '</title></circle>';
    offset += size;
    return segment;
  }).join('') + '</svg>' : '';
  return panel(title, chart + '<ul class="models">' + items.map((row, index) => '<li><span><i class="palette-' + index % 4 + '"></i>' +
    escaped(row.model) + '</span>' + (donut ? '' : '<meter min="0" max="' + max + '" value="' + row.requests + '"></meter>') +
    '<b>' + count(row.requests) + (donut ? ' · ' + percent(row.requests / total) : '') + '</b></li>').join('') + '</ul>');
}

export function ownerDashboard({ metrics, registrations, subscribers, range, billingEnabled, analyticsEnabled, updatedAt, health, collectionMs }) {
  const views = (id, title, description, content) => '<section id="' + id + '" class="view"><h2>' + title + '</h2><p>' +
    description + '</p>' + content + '</section>';
  const grid = (...items) => '<div class="panels">' + items.join('') + '</div>';
  const retention = cohort => cohort?.eligible ? percent(cohort.returned / cohort.eligible) : unavailable;
  const activity = metrics?.since ? 'AI activity tracked since ' + metrics.since + ' UTC. Up to 90 days retained.'
    : analyticsEnabled ? 'AI activity is unavailable until aggregate tracking has recorded events.' : 'AI analytics collection is disabled.';
  const trackedCount = (value, measured = metrics?.since) => value ?? (measured ? 0 : null);
  const rangeMeasured = metrics?.since && (range === 'all' || range === '90' || metrics.days?.length);
  const billing = billingEnabled ? 'Verified payment amounts and historical plan events are unavailable.' : 'NOIR Plus payments are not enabled yet.';
  const revenue = billingEnabled ? unavailable : aud(0);
  const models = metrics?.models;
  const deepseek = models?.filter(row => /deepseek/i.test(row.model)).reduce((sum, row) => sum + row.requests, 0);
  const planChart = number(registrations?.total) && number(subscribers) && subscribers <= registrations.total ?
    distribution('Accounts by paid-plan status', [{ model: 'Other accounts', requests: registrations.total - subscribers }, { model: 'Active Plus', requests: subscribers }], true) :
    panel('Subscription distribution', empty(billing));
  const revenueChart = panel('Revenue over time', empty(billing), 'Verified cash receipts by transaction date.');
  const growthChart = timeline('Registrations over time', registrations?.days, { measured: Array.isArray(registrations?.days) });
  const requestsChart = timeline('AI requests over time', metrics?.days, { measured: rangeMeasured });
  const dashboard = [
    views('overview', 'Overview', 'User growth, AI activity and business performance.', cards([
      ['Total users', registrations?.total, 'All time'], ['Active users', trackedCount(metrics?.active, rangeMeasured), 'Unique accounts with tracked AI activity'],
      ['Total verified revenue', revenue, billingEnabled ? '' : 'Payments not enabled'], ['Monthly recurring revenue', null, 'Active recurring contract value'],
      ['AI requests', trackedCount(metrics?.ai_requests, rangeMeasured), 'Selected period'], ['Estimated operating profit', null, 'Requires verified revenue and cost data'],
    ]) + grid(growthChart, requestsChart, revenueChart, planChart, panel('Operational activity',
      '<p>' + escaped(activity) + '</p>'), panel('System warnings', '<p>' + escaped(health === 'Degraded' ? 'One or more analytics sources could not be read.' : billing) + '</p>'))),
    views('revenue', 'Revenue', 'Verified collections and recurring revenue in AUD when available.', cards([
      ['Total verified revenue', revenue], ['Revenue this month', revenue, 'Current UTC calendar month'], ['Monthly recurring revenue', null],
      ['Annual recurring revenue', null, 'MRR × 12'], ['Revenue per paying user', null], ['Estimated AI API costs', null],
      ['Estimated infrastructure costs', null], ['Estimated operating profit', null], ['Estimated operating margin', null],
    ]) + grid(revenueChart, panel('Monthly revenue comparison', empty(billing)), panel('Revenue versus operating costs', empty()),
      panel('Estimated operating profit over time', empty()))),
    views('users', 'Users', 'Registration windows use UTC. Activity and retention use observed AI events.', cards([
      ['Registered users', registrations?.total], ['Registrations today', registrations?.today], ['Registrations this week', registrations?.week, 'Trailing 7 days'],
      ['Registrations this month', registrations?.month], ['Daily active users', trackedCount(metrics?.daily)], ['Weekly active users', trackedCount(metrics?.weekly)],
      ['Monthly active users', trackedCount(metrics?.monthly)], ['Returning users', trackedCount(metrics?.returning, rangeMeasured), 'Active after their first recorded day'],
      ['7-day retention', retention(metrics?.retention), 'Active exactly 7 days after first tracked use'],
      ['30-day retention', retention(metrics?.retention_30), 'Active exactly 30 days after first tracked use'],
      ['Registration growth', percent(registrations?.growth), 'Trailing 30 days versus the previous 30 days'],
    ]) + grid(growthChart, timeline('Daily active users', metrics?.days, { series: [['active', 'Active accounts']], style: 'area', measured: rangeMeasured }),
      timeline('First active versus returning', metrics?.days, { series: [['first_active', 'First active'], ['returning', 'Returning']], style: 'stack', measured: rangeMeasured }))),
    views('ai', 'AI Analytics', 'Aggregate server-side outcomes. Challenge runs can include several model calls.', cards([
      ['AI requests', trackedCount(metrics?.ai_requests, rangeMeasured)], ['Successful AI requests', trackedCount(metrics?.successful_requests, rangeMeasured)],
      ['Completed chat replies', trackedCount(metrics?.ai_messages, rangeMeasured)], ['Failed AI requests', trackedCount(metrics?.failed_requests, rangeMeasured)],
      ['DeepSeek requests', rangeMeasured ? deepseek : null], ['Challenge runs', trackedCount(metrics?.challenge, rangeMeasured)],
      ['Smart Route requests', trackedCount(metrics?.smart_route, rangeMeasured)], ['Reported tokens', metrics?.tokens],
      ['Average AI latency', null], ['AI success rate', metrics?.ai_requests ? percent((metrics.successful_requests ?? 0) / metrics.ai_requests) : null],
    ]) + grid(requestsChart, distribution('Most-used models', models), distribution('Named model distribution', models, true),
      panel('Estimated AI costs by model', empty()), panel('Response latency over time', empty()))),
    views('subscriptions', 'Subscriptions', 'Current subscription counts reflect active live billing records.', '<p class="notice">' + escaped(billing) + '</p>' +
      cards([['Active Plus subscribers', subscribers], ['New paid subscriptions', null], ['Cancelled subscriptions', null],
        ['Free-to-paid conversion', null], ['Churn', null], ['Subscription revenue', revenue]]) +
      grid(planChart, panel('Subscriber growth', empty(billing)), panel('Subscription revenue over time', empty(billing)))),
    views('health', 'System Health', 'Status reflects the latest analytics source check.', cards([
      ['Analytics health', health || 'Unknown'], ['Analytics collection latency', number(collectionMs) ? collectionMs + ' ms' : null],
      ['Failed AI requests', trackedCount(metrics?.failed_requests, rangeMeasured)], ['Application errors', null], ['Server-side request volume', null], ['Rate-limit events', null],
    ]) + grid(timeline('Failed AI requests over time', metrics?.days, { series: [['failed', 'Failures']], measured: rangeMeasured }),
      panel('Operational incident history', empty()))),
  ].join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NOIR Command Center</title>
<style>
:root{color-scheme:dark;font:15px/1.5 system-ui,sans-serif;background:#101115;color:#f1f1f6;--muted:#aaaab9;--line:#323442;--violet:#a698ff;--blue:#7cbcff}*{box-sizing:border-box}body{margin:0}a{color:inherit}a:focus-visible,button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--violet);outline-offset:4px}.layout{display:grid;grid-template-columns:218px minmax(0,1fr);min-height:100dvh}.sidebar{position:sticky;top:0;align-self:start;height:100dvh;background:#14151b;border-right:1px solid var(--line);padding:24px 16px;display:flex;flex-direction:column;gap:30px}.brand{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:750;letter-spacing:.18em;padding:0 9px}.brand img{width:28px;height:28px}.sidebar nav{display:grid;gap:5px}.sidebar a{display:flex;gap:12px;align-items:center;padding:10px 12px;text-decoration:none;border-radius:8px;color:var(--muted);white-space:nowrap}.sidebar a:hover,.sidebar a[aria-current]{background:#252333;color:#fff}.sidebar a span{color:var(--violet);width:16px;text-align:center}.back{margin-top:auto}.shell{max-width:1480px;width:100%;padding:clamp(16px,3vw,42px);margin:0 auto}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-bottom:20px;border-bottom:1px solid var(--line)}h1,h2,h3,p{margin:0}h1{font-size:clamp(25px,4vw,38px);letter-spacing:-.045em;line-height:1.12}h2{font-size:24px;letter-spacing:-.025em}h3{font-size:15px;line-height:1.25}p{color:var(--muted)}.head p,.view>p{margin-top:6px}.head form{display:flex;align-items:center;gap:8px;flex-wrap:wrap}select,button{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:#1f202a;color:inherit}button{cursor:pointer}.view{scroll-margin-top:12px;padding:28px 0;border-bottom:1px solid var(--line)}.cards,.panels{display:grid;gap:12px;margin:16px 0 0}.cards{grid-template-columns:repeat(3,minmax(0,1fr))}.panels{grid-template-columns:repeat(2,minmax(0,1fr))}.cards>div,.panel{background:#191a22;border:1px solid var(--line);border-radius:13px;padding:16px;min-width:0}.cards dt{font-size:13px;color:var(--muted)}.cards dd{font-size:clamp(16px,2vw,24px);font-weight:650;margin:8px 0 0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.cards .detail,.panel p,.axis{font-size:12px;font-weight:400;color:var(--muted)}.panel p,.notice{margin-top:8px}.panel .empty{min-height:90px;display:grid;place-items:center;text-align:center;border:1px dashed var(--line);border-radius:8px;padding:12px}.panel svg{display:block;width:100%;margin-top:12px}.gridline{stroke:var(--line);fill:none}.line{fill:none;stroke:var(--violet);stroke-width:3}.area{fill:#7564df45}.point,.series-0{fill:var(--violet)}.series-1{fill:var(--blue)}.point:hover{stroke:white;stroke-width:3}.axis{display:flex;justify-content:space-between;gap:6px}.models{padding:0;list-style:none;margin-bottom:0}.models li{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:6px 0}.models span{overflow-wrap:anywhere;min-width:0}.models b{white-space:nowrap}.models i{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:var(--color);margin-right:7px}.models meter{width:28%;flex-shrink:0;accent-color:var(--violet)}.palette-0{--color:var(--violet)}.palette-1{--color:var(--blue)}.palette-2{--color:#88d9b5}.palette-3{--color:#e7aa72}.panel .donut{width:110px;margin:10px auto}.slice{stroke:var(--color);transform:rotate(-90deg);transform-origin:center}.slice:hover{stroke-width:16}details{margin-top:10px;color:var(--muted)}summary{cursor:pointer}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;text-align:left}td,th{padding:5px;border-bottom:1px solid var(--line)}.notice{border-left:2px solid var(--blue);padding-left:10px}
@media(max-width:790px){.layout{display:block}.sidebar{position:static;height:auto;gap:10px;padding:12px;border-right:0;border-bottom:1px solid var(--line)}.sidebar nav{display:flex;flex-wrap:wrap}.sidebar a{padding:6px 8px}.back{margin:0}}@media(max-width:550px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.panels{grid-template-columns:1fr}.cards>div,.panel{padding:12px}}@media(prefers-reduced-motion:no-preference){.sidebar a,.slice{transition:background .15s,stroke-width .15s}}
</style><script src="/owner-dashboard-client.js" defer></script></head><body><div class="layout">
<aside class="sidebar"><div class="brand"><img src="/logo.svg" alt="">NOIR</div><nav aria-label="Command Center">${sections.map(([id, label, icon]) =>
  '<a href="#' + id + '"><span aria-hidden="true">' + icon + '</span>' + label + '</a>').join('')}</nav><a class="back" href="/">← Back to NOIR</a></aside>
<main class="shell"><header class="head"><div><h1>NOIR Command Center</h1><p>Updated <span id="updated-at">${escaped(time(updatedAt))}</span></p><p id="refresh-status" role="status"></p></div>
<form action="/admin" method="get"><label for="range">Date range</label><select id="range" name="range">${[['7','7 days'],['30','30 days'],['90','90 days'],['all','All time']].map(([value, label]) =>
  '<option value="' + value + '"' + (range === value ? ' selected' : '') + '>' + label + '</option>').join('')}</select><noscript><button>Apply</button></noscript></form></header>
<div id="dashboard">${dashboard}</div></main></div></body></html>`;
}
