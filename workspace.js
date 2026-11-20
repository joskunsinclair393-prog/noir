export function mountWorkspace({ onMode, feedback }) {
 const style=document.createElement('link');style.rel='stylesheet';style.href='/workspace.css';document.head.append(style);
 const modes=document.createElement('label');modes.className='response-mode';modes.textContent='Response ';
 const select=document.createElement('select');select.setAttribute('aria-label','Response mode');for(const value of ['instant','think'])select.add(new Option(value==='instant'?'Instant':'Think',value));modes.append(select);document.querySelector('.composer').append(modes);
 select.onchange=()=>onMode(select.value);
 select.title='Think uses a supported free reasoning model when available. It may take longer and uses your existing quota. No paid fallback.';
 const report=document.createElement('button');report.type='button';report.textContent='Feedback';report.onclick=feedback;document.getElementById('workspaceNav').append(report);
 document.querySelector('.view-switch').hidden=true;
 document.querySelectorAll('[data-workspace-action="verify"],[data-workspace-action="challenge"]').forEach(b=>b.hidden=true);
 return { mode:()=>select.value, busy(value){select.disabled=value;} };
}
