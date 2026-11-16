// The dashboard receives aggregate values only.
const escaped = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const count = value => Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat().format(value) : 'Not yet available';

function bars(rows, label) {
  if (!rows?.length) return '<p>Not yet available</p>';
  const max = Math.max(1, ...rows.map(row => row.requests));
  return '<ul class="bars">' + rows.map(row =>
    '<li><span>' + escaped(row[label]) + '</span><meter min="0" max="' + max + '" value="' + row.requests + '"></meter><b>' + count(row.requests) + '</b></li>'
  ).join('') + '</ul>';
}

export function ownerDashboard({ metrics, registrations, subscribers }) {
  const cards = [
    ['Registered users', registrations?.total], ['Daily active users', metrics?.daily], ['Weekly active users', metrics?.weekly],
    ['Monthly active users', metrics?.monthly], ['AI requests', metrics?.ai_requests], ['Completed chat replies', metrics?.ai_messages],
    ['Challenge runs', metrics?.challenge], ['Smart Route requests', metrics?.smart_route], ['Reported tokens', metrics?.tokens],
    ['Failed AI requests', metrics?.failed_requests], ['NOIR Plus subscribers', subscribers],
    ['Application errors', null], ['Estimated operating costs', null],
  ];
  const retention = metrics?.retention;
  cards.push(['7-day AI activity retention', retention?.eligible ? Math.round(retention.returned / retention.eligible * 100) + '%' : null]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NOIR Admin Dashboard</title>
<style>
:root{color-scheme:dark;font:15px/1.55 system-ui,sans-serif;background:#111;color:#eee}body{max-width:1080px;margin:auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}a{color:#ddd}h1{font-size:clamp(24px,5vw,42px);margin:.4em 0}p{color:#b0b0b0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,185px),1fr));gap:12px}.cards>div,.chart{padding:16px;border:1px solid #3d3d3d;border-radius:12px;background:#1d1d1d}.cards dt{color:#b0b0b0}.cards dd{font-size:20px;margin:6px 0 0}.chart{margin:18px 0}.bars{padding:0;list-style:none}.bars li{display:grid;grid-template-columns:minmax(85px,1fr) 1fr auto;gap:8px;align-items:center}.bars span{overflow-wrap:anywhere}meter{width:100%}
</style></head><body><header><h1>NOIR Admin Dashboard</h1><a href="/">Back to NOIR</a></header>
<p>${metrics?.since ? 'AI activity tracked since ' + escaped(metrics.since) + ' (UTC). Activity metrics cover up to 90 days.' : 'AI activity metrics will appear once requests are recorded.'}</p>
<dl class="cards">${cards.map(([label, value]) => '<div><dt>' + escaped(label) + '</dt><dd>' + (typeof value === 'string' ? escaped(value) : count(value)) + '</dd></div>').join('')}</dl>
<section class="chart"><h2>Registrations over time</h2>${bars(registrations?.days, 'day')}</section>
<section class="chart"><h2>Requests by model</h2>${bars(metrics?.models, 'model')}</section>
<p>Active users are accounts with recorded AI activity. Day 7 retention counts accounts active exactly seven days after their first tracked AI activity.</p></body></html>`;
}
