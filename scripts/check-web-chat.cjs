// Run with Electron: electron scripts/check-web-chat.cjs [isolated release directory]
// Local HTTP + auth/provider fixtures only. This is not a live-provider verification.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'noir-chat-ui-'));
app.setPath('userData', path.join(temporary, 'profile'));
app.on('window-all-closed', event => event.preventDefault());
let win;
const timeout = setTimeout(() => { console.error('FAIL browser suite timed out'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const { createNoirServer } = await import(pathToFileURL(path.join(root, 'server.js')));
  let generations = 0;
  const server = createNoirServer({
    dataFile:path.join(temporary, 'store.json'),
    config:{ authRequired:true, supabaseUrl:'https://fixture.invalid', supabaseAnonKey:'test-only',
      supabaseServiceRoleKey:'', openRouterFreeKey:'test-only', paidAIEnabled:false,
      premiumModelAccessEnabled:false, plusBillingEnabled:false, maxRequestsPerMinute:100 },
    fetchImpl:async url => {
      if (String(url).includes('/auth/v1/user')) return Response.json({ id:'presentation-test-user', email:'fixture@example.test' });
      if (String(url).includes('openrouter.ai')) {
        generations++;
        const text = '# Test fixture reply\n\nA clear answer with **formatted text**.\n\n```js\nconst greeting = "Hello NOIR";\nconsole.log(greeting);\n```\n\n' +
          Array.from({length:24}, (_,i) => 'Paragraph '+i+'. Readable conversation content for scroll testing.').join('\n\n');
        return new Response('data: '+JSON.stringify({ model:'fixture/free:free', choices:[{delta:{content:text}}], usage:{prompt_tokens:8,completion_tokens:40} })+'\n\ndata: [DONE]\n\n', { headers:{'content-type':'text/event-stream'} });
      }
      throw Error('Unexpected external request in isolated UI test');
    },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  win = new BrowserWindow({ width:1440, height:900, show:false, useContentSize:true, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  const run = code => win.webContents.executeJavaScript(code);
  const wait = async (code,label) => {
    for (let i=0;i<150;i++) { if (await run(code)) return; await new Promise(resolve=>setTimeout(resolve,30)); }
    throw Error('Timed out: '+label);
  };
  const capture = async name => {
    await new Promise(resolve=>setTimeout(resolve,550));
    fs.writeFileSync(path.join(temporary,name+'.png'), (await win.webContents.capturePage()).toPNG());
  };
  await win.loadURL(base+'/app');
  await run(`localStorage.setItem('noirAuthSession', JSON.stringify({access_token:'fixture-token',refresh_token:'fixture-refresh'}))`);
  await win.loadURL(base+'/app');
  await wait(`!document.querySelector('.app').hidden && !document.querySelector('#welcomeProjects').hidden`, 'signed-in workspace');
  assert(await run(`document.querySelector('.welcome h1').textContent === 'What are we working on?'`));
  assert(await run(`(()=>{const w=document.querySelector('#welcome').getBoundingClientRect(), c=document.querySelector('.composer').getBoundingClientRect();return c.top>w.bottom && c.top-w.bottom<65 && c.width>650 && c.bottom<innerHeight-60})()`));
  await capture('desktop-welcome');
  console.log('PASS desktop welcome and centered, functional composer');
  await run(`document.querySelector('#welcomeProjects').click();document.querySelector('#projectCreate').click();document.querySelector('#projectForm').elements.name.value='UI test project';document.querySelector('#projectForm').requestSubmit()`);
  await wait(`!document.querySelector('#projectDialog').open && [...document.querySelector('#projectFilter').options].some(o=>o.textContent==='UI test project')`, 'project save');
  await run(`document.querySelector('[data-model-shortcut="free-cloud"]').click()`);
  assert(await run(`document.querySelector('#modelChoice').value==='free-cloud'`));
  assert.equal(generations,0);
  await run(`document.querySelector('#prompt').value='Test the polished workspace';document.querySelector('#send').click()`);
  await wait(`document.querySelector('.message.assistant .code-block') && !document.querySelector('#send').disabled`, 'chat response');
  assert.equal(generations,1);
  assert(await run(`document.querySelector('.message-actions button[aria-label="Copy response"]') && document.querySelector('.code-toolbar button')`));
  assert(await run(`(()=>{const m=document.querySelector('#messages');m.scrollTop=0;m.scrollTop=40;const c=document.querySelector('.composer').getBoundingClientRect();return m.scrollTop>0&&c.bottom<=innerHeight&&document.querySelector('#welcomeTools').getBoundingClientRect().height===0})()`));
  await capture('desktop-conversation');
  await run(`document.querySelector('[data-workspace-action="verify"]').click()`);
  assert(await run(`!document.querySelector('#settingsBackdrop').hidden && !document.querySelector('[data-settings-panel="plan"]').hidden`));
  await run(`document.querySelector('#settingsClose').click();document.querySelector('[data-workspace-action="models"]').click()`);
  assert(await run(`document.activeElement===document.querySelector('#modelChoice')`));
  await run(`document.querySelector('#settingsClose').click()`);
  await win.loadURL(base+'/app');
  await wait(`document.querySelector('#messages').textContent.includes('Test fixture reply')`, 'conversation restoration');
  console.log('PASS project save, model selection, fixture response, formatting, scrolling, review entitlement and history restoration');
  for (const width of [320,375,390,430,768]) {
    win.setContentSize(width,820);
    await wait(`innerWidth===${width} && innerHeight===820`, 'viewport resize '+width);
    await run(`document.querySelector('#newChat').click()`);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert(await run(`document.documentElement.scrollWidth<=innerWidth`), 'page overflow '+width);
    assert(await run(`(()=>{const a=document.querySelector('.topbar-leading').getBoundingClientRect(),b=document.querySelector('.view-switch').getBoundingClientRect(),c=document.querySelector('.topbar-actions').getBoundingClientRect();return (a.right<=b.left||a.bottom<=b.top)&&(b.right<=c.left||b.top>=c.bottom)})()`), 'header controls overlap '+width);
    assert(await run(`(()=>{const c=document.querySelector('.composer').getBoundingClientRect();return c.left>=0&&c.right<=innerWidth&&c.bottom<=innerHeight&&getComputedStyle(document.querySelector('#prompt')).fontSize==='16px'})()`), 'composer '+width);
    if (width<=700) {
      await run(`document.querySelector('#sidebarToggle').click()`);
      assert(await run(`document.querySelector('.app').classList.contains('sidebar-open-mobile')`));
      await run(`document.querySelector('[data-workspace-action="settings"]').click()`);
      assert(await run(`!document.querySelector('#settingsBackdrop').hidden && !document.querySelector('.app').classList.contains('sidebar-open-mobile')`));
      await run(`document.querySelector('#settingsClose').click()`);
    }
    await run(`document.querySelector('#settingsTrigger').click();document.querySelector('#lightAppearanceToggle').click();document.querySelector('#settingsClose').click()`);
    assert(await run(`document.body.classList.contains('light-theme')`));
    assert(await run(`document.documentElement.scrollWidth<=innerWidth`));
    if (width===390) await capture('mobile-welcome-light');
    await run(`document.querySelector('#settingsTrigger').click();document.querySelector('#lightAppearanceToggle').click();document.querySelector('#settingsClose').click()`);
    if (width===390) await capture('mobile-welcome-dark');
    console.log('PASS responsive dark/light workspace, navigation and input at '+width+'px');
  }
  // Reopen a saved conversation at phone width and verify it scrolls independently.
  win.setContentSize(390,700);
  await wait('innerWidth===390 && innerHeight===700', 'phone conversation resize');
  await run(`document.querySelector('#sidebarToggle').click();document.querySelector('.chat-history-item').click()`);
  await wait(`document.querySelector('#messages').textContent.includes('Test fixture reply')`, 'mobile history');
  await new Promise(resolve=>setTimeout(resolve,150));
  await run(`document.querySelector('#messages').style.scrollBehavior='auto'`);
  assert(await run(`(()=>{const m=document.querySelector('#messages');m.scrollTop=0;m.scrollTop=50;return m.scrollTop>0&&document.querySelector('#send').getBoundingClientRect().bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()`));
  await capture('mobile-conversation');
  console.log('Conversation visibility', await run(`(()=>{const row=document.querySelector('.message.assistant'),bubble=row.querySelector('.bubble');return {opacity:getComputedStyle(row).opacity,display:getComputedStyle(bubble).display,rect:JSON.stringify(bubble.getBoundingClientRect()),color:getComputedStyle(bubble).color}})()`));
  console.log('PASS phone conversation history, independent message scroll and accessible composer');
  assert.deepEqual(errors,[]);
  console.log('PASS no renderer console errors. Screenshots: '+temporary);
  clearTimeout(timeout);
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
