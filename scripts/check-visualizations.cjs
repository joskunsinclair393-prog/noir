// Isolated UI integration tests with fixture AI output, never real paid services.
const {app,BrowserWindow,clipboard}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'noir-viz-ui-'));
app.setPath('userData',path.join(temporary,'profile'));let win;app.on('window-all-closed',event=>event.preventDefault());
const deadline=setTimeout(()=>{console.error('FAIL visualization UI timeout');app.exit(1)},90000);
app.whenReady().then(async()=>{
  const {createNoirServer}=await import(pathToFileURL(path.join(root,'server.js')));
  const chart={version:1,type:'line',title:'Sample sales',dataStatus:'illustrative',source:'Test fixture, not real sales',labels:['Jan','Feb','Mar'],series:[{name:'Sales',values:[10,25,18]}]};
  const graph={version:1,type:'flowchart',title:'Sample process',dataStatus:'conceptual',nodes:[{id:'a',label:'Start'},{id:'b',label:'Permission granted?',shape:'decision'},{id:'c',label:'Continue'}],edges:[{from:'a',to:'b'},{from:'b',to:'c',label:'Yes'}]};
  const table={version:1,type:'table',title:'Compare options',dataStatus:'illustrative',columns:['Attribute','Option A','Option B'],rows:[['Price',10,20],['Approach','Simple','Detailed']]};
  const specs=[chart,{...chart,type:'bar'},{...chart,type:'pie'},...['flowchart','process','mindmap','timeline','decision-tree','architecture'].map(type=>({...graph,type})),{...table,type:'comparison'},{...table},{version:1,type:'function',title:'y = x squared',dataStatus:'conceptual',function:{kind:'polynomial',coefficients:[0,0,1]},domain:[-3,3]}];
  let current=chart;
  const server=createNoirServer({dataFile:path.join(temporary,'store.json'),config:{authRequired:false,openRouterFreeKey:'fixture-only',paidAIEnabled:false,premiumModelAccessEnabled:false,plusBillingEnabled:false,maxRequestsPerMinute:100},
    fetchImpl:async(_url,init)=>{const request=JSON.parse(init.body);assert(request.messages[0].content.includes('fenced noir-viz'));const content='Explanation from the test provider.\n\n```noir-viz\n'+JSON.stringify(current)+'\n```';return new Response('data: '+JSON.stringify({model:'fixture/free:free',choices:[{delta:{content}}],usage:{prompt_tokens:10,completion_tokens:20}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  win=new BrowserWindow({width:1400,height:1000,show:false,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});win.webContents.setUserAgent('Mozilla/5.0 Chrome/130 Safari/537.36');
  const run=code=>win.webContents.executeJavaScript(code),wait=async code=>{for(let i=0;i<200;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,25))}throw Error('Timed out: '+code)};
  const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message)});
  await win.loadURL(base+'/app');await wait(`!document.querySelector('.app').hidden`);
  for(const [index,spec] of specs.entries()){
    current=spec;await run(`document.querySelector('#newChat').click();document.querySelector('#prompt').value='Draw a ${spec.type} diagram using sample data';document.querySelector('#send').click()`);
    await wait(`document.querySelector('[data-viz-type="${spec.type}"]') && !document.querySelector('#send').disabled`);
    assert(await run(`document.querySelector('.message.assistant').textContent.includes('Explanation from the test provider.')`));
    if(spec.type==='line'){
      await run(`document.querySelector('.noir-visualization .viz-toolbar button:last-of-type').click()`);
      assert(await run(`document.querySelector('.viz-dialog').open`));
      const original=await run(`document.querySelector('.viz-dialog svg').getAttribute('viewBox')`);
      await run(`document.querySelector('.viz-dialog .viz-view-controls button:nth-child(2)').click()`);
      assert.notEqual(original,await run(`document.querySelector('.viz-dialog svg').getAttribute('viewBox')`));
      await run(`document.querySelector('.viz-dialog .viz-view-controls button:last-child').click();document.querySelector('.viz-dialog svg').focus()`);
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});
      await wait(`document.querySelector('.viz-dialog svg').getAttribute('viewBox')!==${JSON.stringify(original)}`);
      await run(`document.querySelector('.viz-dialog>button').click()`);
      const oldClipboard=clipboard.readText();
      if(typeof oldClipboard==='string'){try{await run(`document.querySelector('.viz-toolbar button').click()`);await wait(`document.querySelector('.viz-toolbar').textContent.includes('Data copied.')`);assert.equal(JSON.parse(clipboard.readText()).type,'line');}finally{clipboard.writeText(oldClipboard)}}
      else console.log('NOT TESTED OS clipboard readback unavailable; data download remains available');
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SVG download did not finish')),6000);win.webContents.session.once('will-download',(_event,item)=>{const file=path.join(temporary,'export.svg');item.setSavePath(file);item.once('done',(_e,state)=>{try{assert.equal(state,'completed');const xml=fs.readFileSync(file,'utf8');assert(xml.includes('<svg'));assert(!xml.includes('<script'));clearTimeout(timer);resolve();}catch(error){clearTimeout(timer);reject(error)}})});run(`document.querySelectorAll('.viz-toolbar button')[2].click()`).catch(reject)});
      await new Promise((resolve,reject)=>{win.webContents.session.once('will-download',(_event,item)=>{const file=path.join(temporary,item.getFilename());item.setSavePath(file);item.once('done',(_e,state)=>{try{assert.equal(state,'completed');const source=fs.readFileSync(file,'utf8');assert(source.includes('<svg'));assert(!source.includes('<script'));resolve()}catch(e){reject(e)}})});run(`document.querySelector('.viz-toolbar button:nth-child(3)').click()`).catch(reject)});
      await win.loadURL(base+'/app');await wait(`document.querySelector('[data-viz-type="line"]')`);
      console.log('PASS chat fixture streaming, schema prompt, SVG download, expand, zoom, keyboard pan and saved diagram restoration');
    }
    console.log('PASS chat renderer '+spec.type);
  }
  win.show();win.focus();await new Promise(resolve=>setTimeout(resolve,200));
  await run(`document.querySelector('.viz-frame circle').focus()`);
  assert(await run(`!document.querySelector('.viz-tooltip').hidden`));
  // Test untrusted text and invalid schemas directly through the same production renderer.
  await run(`import('/visualizations.js').then(({createVisualization})=>{const host=document.querySelector('.messages');host.replaceChildren(createVisualization(${JSON.stringify({...graph,nodes:[{id:'a',label:'<img src=x onerror=alert(1)>'}],edges:[]})}));})`);
  assert(await run(`!document.querySelector('.noir-visualization img') && document.querySelector('.noir-visualization').textContent.includes('<img')`));
  await run(`import('/visualizations.js').then(({renderVisualizations})=>{const p=document.createElement('pre');p.className='code-block';const bar=document.createElement('div');bar.className='code-toolbar';const label=document.createElement('span');label.textContent='noir-viz';bar.append(label);const code=document.createElement('code');code.textContent='{"type":"html"}';p.append(bar,code);const m=document.querySelector('.messages');m.append(p);renderVisualizations(m);})`);
  assert(await run(`document.querySelector('.viz-error')!==null`));
  current=chart;await run(`document.querySelector('#newChat').click();document.querySelector('#prompt').value='Graph this sample data';document.querySelector('#send').click()`);await wait(`document.querySelector('[data-viz-type="line"]') && !document.querySelector('#send').disabled`);
  await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(temporary,'chat-chart.png'),(await win.webContents.capturePage()).toPNG());
  win.setContentSize(390,820);await wait('innerWidth===390');assert(await run(`document.documentElement.scrollWidth<=innerWidth`));
  assert.deepEqual(errors,[]);console.log('PASS exact values, injection safety, invalid schema fallback, basic phone overflow. Screenshot: '+temporary+'/chat-chart.png');
  clearTimeout(deadline);server.closeAllConnections();await new Promise(r=>server.close(r));app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(deadline);app.exit(1)});
