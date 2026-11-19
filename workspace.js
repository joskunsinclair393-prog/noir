export function mountWorkspace({ available, onMode, openStudio, feedback }) {
 const style=document.createElement('link');style.rel='stylesheet';style.href='/workspace.css';document.head.append(style);
 const logo=document.getElementById('homeButtonTop');
 const wrap=document.createElement('div');wrap.className='workspace-switcher';logo.after(wrap);wrap.append(logo);
 const toggle=document.createElement('button');toggle.type='button';toggle.className='workspace-toggle';toggle.setAttribute('aria-label','Switch NOIR workspace');toggle.setAttribute('aria-expanded','false');toggle.textContent='⌄';wrap.append(toggle);
 const menu=document.createElement('div');menu.className='workspace-menu';menu.hidden=true;menu.setAttribute('aria-label','NOIR workspace');wrap.append(menu);
 function close(){menu.hidden=true;toggle.setAttribute('aria-expanded','false');}
 toggle.onclick=()=>{if(!available())return;menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));};
 for(const [label,action]of [['NOIR Chat',()=>openStudio(false)],['NOIR Studio',()=>openStudio(true)]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{action();close();};menu.append(b);}
 document.addEventListener('click',e=>{if(!wrap.contains(e.target))close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){close();toggle.focus();}});
 const modes=document.createElement('label');modes.className='response-mode';modes.textContent='Response ';
 const select=document.createElement('select');select.setAttribute('aria-label','Response mode');for(const value of ['instant','think'])select.add(new Option(value==='instant'?'Instant':'Think',value));modes.append(select);document.querySelector('.composer').append(modes);
 select.onchange=()=>onMode(select.value);
 select.title='Think uses a supported free reasoning model when available. It may take longer and uses your existing quota. No paid fallback.';
 const report=document.createElement('button');report.type='button';report.textContent='Feedback';report.onclick=feedback;document.getElementById('workspaceNav').append(report);
 document.querySelector('.view-switch').hidden=true;
 document.querySelectorAll('[data-workspace-action="verify"],[data-workspace-action="challenge"]').forEach(b=>b.hidden=true);
 return { mode:()=>select.value, busy(value){select.disabled=value;} };
}
