// Local Chromium verification; no AI API requests or real analytics data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2] || path.join(__dirname,'..'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'noir-monitor-'));
app.setPath('userData',path.join(temporary,'profile'));
let win;
app.on('window-all-closed',event=>event.preventDefault());
const deadline = setTimeout(()=>{console.error('FAIL monitor test timeout');app.exit(1)},60000);
app.whenReady().then(async()=>{
  const { createNoirServer } = await import(pathToFileURL(path.join(root,'server.js')));
  const server=createNoirServer({dataFile:path.join(temporary,'store.json'),config:{paidAIEnabled:false,premiumModelAccessEnabled:false,plusBillingEnabled:false},fetchImpl:()=>{throw Error('Unexpected network request')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  win=new BrowserWindow({show:false,width:1400,height:1000,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  win.webContents.setUserAgent('Mozilla/5.0 Chrome/130 Safari/537.36');
  const run=code=>win.webContents.executeJavaScript(code);
  const wait=async code=>{for(let i=0;i<150;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out: '+code)};
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message)});
  const base='http://127.0.0.1:'+server.address().port;
  await win.loadURL(base);
  const state=async p=>{
    await run(`(()=>{document.documentElement.style.scrollBehavior='auto';const j=document.querySelector('[data-monitor-journey]');scrollTo(0,j.getBoundingClientRect().top+scrollY-100+(j.offsetHeight-innerHeight+115)*${p})})()`);
    await new Promise(resolve=>setTimeout(resolve,100));
    return run(`({transform:getComputedStyle(document.querySelector('.monitor-device')).transform,prompt:document.querySelector('#monitor-typed').textContent,answer:document.querySelector('#monitor-answer').textContent,line:getComputedStyle(document.querySelector('.monitor-line')).strokeDashoffset,visits:document.querySelector('#monitor-visits').textContent,bars:getComputedStyle(document.querySelector('.monitor-bars span')).transform})`);
  };
  const start=await state(0),typing=await state(.25),answer=await state(.45),chart=await state(.64),complete=await state(.85),exit=await state(1),back=await state(0);
  assert(start.prompt.length<typing.prompt.length);
  assert(answer.answer.length<complete.answer.length);
  assert.notEqual(start.transform,complete.transform);assert.notEqual(complete.transform,exit.transform);
  assert.notEqual(chart.line,complete.line);assert.notEqual(chart.bars,complete.bars);
  assert.equal(complete.visits,'18,000');assert.deepEqual(start,back);
  await state(.85);
  assert(await run(`(()=>{const s=document.querySelector('.monitor-screen'),g=document.querySelector('.monitor-graph');return s.scrollHeight<=s.clientHeight+1&&g.getBoundingClientRect().height>90})()`));
  await run(`document.querySelectorAll('.monitor-point')[3].click()`);
  assert(await run(`(()=>{const p=document.querySelectorAll('.monitor-point')[3];return p.getAttribute('aria-expanded')==='true'&&getComputedStyle(p.querySelector('.monitor-tooltip')).display==='block'})()`));
  fs.writeFileSync(path.join(temporary,'desktop-monitor.png'),(await win.webContents.capturePage()).toPNG());
  await run(`document.querySelectorAll('.monitor-point')[3].focus()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  await wait(`document.querySelectorAll('.monitor-point')[3].getAttribute('aria-expanded')==='false'`);
  console.log('PASS monitor movement, perspective, reverse scrolling, typing, answer, SVG line, bars, counters and keyboard tooltip');
  for(const width of [320,375,390,430,768]){
    win.setContentSize(width,900);await wait(`innerWidth===${width} && innerHeight===900`);
    await win.loadURL(base);await new Promise(r=>setTimeout(r,100));
    assert(await run('document.documentElement.scrollWidth<=innerWidth'),'overflow '+width);
    if(width<=760){
      console.log('Mobile monitor metrics',width,await run(`(()=>{const s=document.querySelector('.monitor-screen'),g=document.querySelector('.monitor-graph');return {screen:s.clientHeight,scroll:s.scrollHeight,graph:g.getBoundingClientRect().height,workspace:document.querySelector('.monitor-workspace').scrollHeight}})()`));
      if(width===320){await run(`document.querySelector('.monitor-device').scrollIntoView({block:'center',behavior:'instant'})`);await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(temporary,'small-monitor.png'),(await win.webContents.capturePage()).toPNG());console.log('Screenshot',temporary)}
      assert(await run(`document.querySelector('#monitor-visits').textContent==='18,000' && document.querySelector('#monitor-answer').textContent.length>100`));
      assert(await run(`(()=>{const s=document.querySelector('.monitor-screen');return s.scrollHeight<=s.clientHeight+1&&document.querySelector('.monitor-graph').getBoundingClientRect().height>20})()`),'screen content clipped '+width);
      if(width===390){await run(`document.querySelector('.monitor-device').scrollIntoView({block:'center',behavior:'instant'})`);await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(temporary,'mobile-monitor.png'),(await win.webContents.capturePage()).toPNG())}
    }
    console.log('PASS monitor layout '+width+'px');
  }
  win.setContentSize(1400,1000);await wait('innerWidth===1400');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await win.loadURL(base);await new Promise(r=>setTimeout(r,100));
  assert(await run(`getComputedStyle(document.querySelector('.monitor-device')).transform==='none' && document.querySelector('#monitor-visits').textContent==='18,000' && document.querySelector('#phone-response').textContent.length>70`));
  assert(await run(`document.querySelector('.giant-wordmark') && document.querySelectorAll('.flow-diagram').length===4 && document.querySelector('.demo-phone')`));
  assert.deepEqual(errors,[]);
  console.log('PASS reduced motion, existing logo/phone/diagrams, no renderer errors. Screenshots: '+temporary);
  clearTimeout(deadline);server.closeAllConnections();await new Promise(r=>server.close(r));app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});
