import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateVisualization, sampleFunction, sanitizeVisualizations, wantsVisualization, calculate, clockValues, visualizationHint } from '../visualization-schema.js';
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
    await post({message:'Hello',visualizations:1});assert.match(instructions,/Use plain text for greetings/);assert.match(instructions,/clock:/);
    await post({message:'Draw a flowchart'});assert.doesNotMatch(instructions,/fenced noir-viz/);
    invalid=true;const error=await(await post({message:'Draw a chart',visualizations:1})).json();assert.match(error.chat.messages.at(-1).text,/Visualization unavailable/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(folder,{recursive:true,force:true});}
});

test('Studio diagram styles accept bounded colors/layouts and reject CSS injection',()=>{
 const spec={version:1,type:'flowchart',title:'Process',dataStatus:'conceptual',nodes:[{id:'a',label:'Start'}],edges:[],layout:'vertical',colors:['#ffffff','#111111']};
 assert.deepEqual(validateVisualization(spec).colors,spec.colors);assert.equal(validateVisualization(spec).layout,'vertical');assert.throws(()=>validateVisualization({...spec,colors:['url(https://example.com)']}));assert.throws(()=>validateVisualization({...spec,layout:'execute'}));
});

test('native clocks validate time zones and compute real instants across date boundaries and DST',()=>{
 const spec=validateVisualization({version:1,type:'clock',title:'World time',dataStatus:'live',zones:[{label:'Sydney',timeZone:'Australia/Sydney'},{label:'UTC',timeZone:'UTC'}],timestamp:'invented'});
 assert.equal(spec.timestamp,undefined);
 const values=clockValues(spec,new Date('2026-01-01T18:00:00Z'));
 assert.match(values[0].date,/2/); assert.match(values[1].date,/1/);
 assert.notEqual(clockValues(spec,new Date('2026-01-01T18:00:00Z'))[0].time,clockValues(spec,new Date('2026-01-01T18:00:01Z'))[0].time);
 for(const timeZone of ['javascript:alert(1)','Not/AZone','<script>'])assert.throws(()=>validateVisualization({...spec,zones:[{label:'Bad',timeZone}]}));
 assert.throws(()=>validateVisualization({...spec,dataStatus:'provided'}));
 assert.throws(()=>validateVisualization({...chart,dataStatus:'live'}));
});
test('native calculators support only fixed operations with bounded numeric input and clear arithmetic errors',()=>{
 for(const [operation,values,answer] of [['sum',[3,4],7],['difference',[3,4],-1],['product',[3,4],12],['quotient',[8,4],2],['percentage',[200,15],30],['compound-interest',[100,10,2],121]]){
  const spec=validateVisualization({...base,type:'calculator',operation,values,expression:'globalThis.evil()'});
  assert.equal(spec.expression,undefined); assert.ok(Math.abs(calculate(operation,values)-answer)<1e-9);
 }
 for(const [operation,values] of [['eval',[1,2]],['constructor',[1,2]],['quotient',[1,0]],['sum',[NaN,2]],['sum',[1e12,1e12]],['compound-interest',[100,10,-1]]])assert.throws(()=>calculate(operation,values));
 assert.throws(()=>validateVisualization({...base,type:'calculator',operation:'sum',values:[1]}));
});
test('information cards are bounded plain text and reject executable component types',()=>{
 const spec=validateVisualization({...base,type:'cards',items:[{label:'Key point',text:'<img src=x onerror=alert(1)>',onClick:'evil()'}]});
 assert.equal(spec.items[0].onClick,undefined);assert.equal(spec.items[0].text,'<img src=x onerror=alert(1)>');
 assert.throws(()=>validateVisualization({...spec,items:Array(9).fill(spec.items[0])}));
 assert.throws(()=>validateVisualization({...spec,items:[{label:'Long',text:'x'.repeat(1001)}]}));
 const response=sanitizeVisualizations('Text answer stays.\n```noir-viz\n'+JSON.stringify({...spec,type:'javascript'})+'\n```');
 assert.match(response,/Text answer stays/);assert.match(response,/Visualization unavailable/);
});

test('realistic prompts get automatic native component guidance without requiring UI keywords',()=>{
 const cases=[['What is the time in Sydney and London?','clock'],['I sold 10 books in January, 18 in February and 15 in March. Help me understand the trend.','line'],['Compare train and car travel to work.','comparison'],['My bill is 80 dollars. What is a 15% tip?','calculator'],['Explain how the login process works.','flowchart'],['Our budget is 50 rent, 30 food and 20 travel. Show the pie breakdown.','pie'],['Show a bar chart of apples 4 and pears 6.','bar'],['Explain these key points','cards'],['Make a mind map of my study plan','mindmap']];
 for(const [prompt,type]of cases){const hint=visualizationHint([{role:'user',text:prompt}],'Australia/Sydney');assert.match(hint,new RegExp('native '+type+' component'));assert.match(hint,/BEFORE a brief explanation/);const example=JSON.parse(hint.match(/```noir-viz\n([^\n]+)/)[1]);assert.equal(validateVisualization(example).type,type);}
 assert.equal(visualizationHint([{role:'user',text:'Hi there'}]),'');
 assert.match(visualizationHint([{role:'user',text:'What is the weather in Sydney?'}]),/No live weather tool is configured/);
});
test('alternate fences canonicalize only validated native schemas and preserve ordinary JSON code',()=>{
 for(const language of ['json','NOIR-VIZ','noir-ui']){const reply=sanitizeVisualizations('Explanation\n```'+language+'\n'+JSON.stringify(chart)+'\n```');assert.match(reply,/```noir-viz/);assert.match(reply,/Explanation/);}
 const plain='```json\n{"hello":"world"}\n```';assert.equal(sanitizeVisualizations(plain),plain);
 assert.match(sanitizeVisualizations('```json\n'+JSON.stringify({...chart,labels:[]})+'\n```'),/Visualization unavailable/);
 assert.match(sanitizeVisualizations('Readable text\n```noir-viz\n'+JSON.stringify(chart).slice(0,-10)),/Readable text/);
});
