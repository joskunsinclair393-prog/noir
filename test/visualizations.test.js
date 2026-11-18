import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateVisualization, sampleFunction, sanitizeVisualizations, wantsVisualization } from '../visualization-schema.js';
import { createNoirServer } from '../server.js';
const base={version:1,title:'Example',dataStatus:'illustrative'};
const chart={...base,type:'line',labels:['Jan','Feb'],series:[{name:'Visits',values:[10,20]}]};
for(const type of ['line','bar','pie'])test(type+' validates supplied values without changing them',()=>{assert.deepEqual(validateVisualization({...chart,type}).series,chart.series);});
for(const type of ['flowchart','process','mindmap','timeline','decision-tree','architecture'])test(type+' validates bounded nodes and edges',()=>{
  const result=validateVisualization({...base,type,nodes:[{id:'a',label:'Start'},{id:'b',label:'Decide',shape:'decision'}],edges:[{from:'a',to:'b',label:'Next'}]});assert.equal(result.nodes.length,2);assert.equal(result.edges[0].to,'b');
});
for(const type of ['table','comparison'])test(type+' validates structured rows',()=>{assert.deepEqual(validateVisualization({...base,type,columns:['Name','Count'],rows:[['A',3],['B',null]]}).rows,[['A',3],['B','']]);});
test('mathematical functions are sampled without evaluating expression strings',()=>{
  const polynomial={...base,type:'function',function:{kind:'polynomial',coefficients:[0,0,1]},domain:[-2,2]};const result=sampleFunction(polynomial);assert.equal(result.length,161);assert.equal(result[0].y,4);assert.equal(result[80].y,0);
  for(const kind of ['sin','cos','log','exp','abs'])assert.equal(sampleFunction({...polynomial,function:{kind}}).length,161);
  assert.throws(()=>sampleFunction({...polynomial,function:{kind:'eval',expression:'process.exit()'}}));
  assert.throws(()=>sampleFunction({...polynomial,function:{kind:'log'},domain:[-3,-1]}));
});
test('invalid numbers, missing provenance, oversized arrays, mismatched data and invalid graph references fail closed',()=>{
  for(const value of [{...chart,dataStatus:undefined},{...chart,version:2},{...chart,type:'html'},{...chart,labels:['Jan']},{...chart,series:[{name:'A',values:[Infinity,3]}]},
    {...chart,labels:Array(101).fill('x')},{...chart,type:'pie',series:[{name:'A',values:[0,0]}]},{...chart,type:'pie',series:[{name:'A',values:[-1,2]}]},
    {...base,type:'flowchart',nodes:[{id:'a',label:'A'}],edges:[{from:'a',to:'missing'}]},
    {...base,type:'flowchart',nodes:[{id:'a',label:'A'},{id:'a',label:'B'}]},
    {...base,type:'table',columns:['A','B'],rows:[['missing']]}])assert.throws(()=>validateVisualization(value));
});
test('sanitization retains valid diagrams, removes executable fields and reports invalid or excess blocks',()=>{
  const text='Explanation\n```noir-viz\n'+JSON.stringify({...chart,html:'<script>alert(1)</script>',onClick:'evil()'})+'\n```';
  const result=sanitizeVisualizations(text);assert.match(result,/Explanation/);assert.match(result,/noir-viz/);assert.doesNotMatch(result,/evil|<script>/);
  assert.match(sanitizeVisualizations('```noir-viz\n{"bad":true}\n```'),/Visualization unavailable/);
  assert.match(sanitizeVisualizations('```noir-viz\n{"version":1'),/incomplete visualization/);
  assert.equal((sanitizeVisualizations(Array(4).fill(text).join('\n')).match(/```noir-viz/g)||[]).length,3);
});
test('normal chat is not asked for diagrams; explicit requests and diagram refinements are supported',()=>{
  assert.equal(wantsVisualization([{role:'user',text:'Hello there'}]),false);
  assert.equal(wantsVisualization([{role:'user',text:'Graph these numbers'}]),true);
  assert.equal(wantsVisualization([{role:'user',text:'Show me how photosynthesis works'}]),true);
  assert.equal(wantsVisualization([{role:'assistant',text:'```noir-viz\n{}\n```'},{role:'user',text:'Add a step'}]),true);
});
test('website chat passes the schema to free AI, streams, saves normalized diagrams and enforces conversation isolation',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'noir-visualization-test-'));let instructions='';let invalid=false;
  const server=createNoirServer({dataFile:join(folder,'store.json'),config:{authRequired:false,openRouterFreeKey:'fixture-only',paidAIEnabled:false,premiumModelAccessEnabled:false,plusBillingEnabled:false,maxRequestsPerMinute:100},
    fetchImpl:async(_url,init)=>{const request=JSON.parse(init.body);instructions=request.messages[0].content;const reply=invalid?'```noir-viz\n{"invalid":true}\n```':'Here is your chart.\n```noir-viz\n'+JSON.stringify(chart)+'\n```';if(!request.stream)return Response.json({model:'fixture/free:free',choices:[{message:{content:reply}}],usage:{prompt_tokens:10,completion_tokens:30}});return new Response('data: '+JSON.stringify({model:'fixture/free:free',choices:[{delta:{content:reply}}],usage:{prompt_tokens:10,completion_tokens:30}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  try{
    const boot=await fetch(url+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0];
    const post=body=>fetch(url+'/api/chat',{method:'POST',headers:{cookie,origin:url,'content-type':'application/json'},body:JSON.stringify(body)});
    const stream=await(await post({message:'Graph these supplied values: Jan 10, Feb 20',visualizations:1,stream:true})).text();
    const result=stream.trim().split('\n').map(line=>JSON.parse(line)).find(frame=>frame.result).result;
    assert.match(instructions,/fenced noir-viz/);assert.match(result.chat.messages.at(-1).text,/```noir-viz/);
    const saved=await(await fetch(url+'/api/chats/'+result.chat.id,{headers:{cookie}})).json();assert.equal(saved.chat.messages.at(-1).text,result.chat.messages.at(-1).text);
    assert.equal((await fetch(url+'/api/chats/'+result.chat.id)).status,404);
    await post({message:'Hello',visualizations:1});assert.doesNotMatch(instructions,/fenced noir-viz/);
    await post({message:'Draw a flowchart'});assert.doesNotMatch(instructions,/fenced noir-viz/);
    invalid=true;const error=await(await post({message:'Draw a chart',visualizations:1})).json();assert.match(error.chat.messages.at(-1).text,/Visualization unavailable/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(folder,{recursive:true,force:true});}
});
