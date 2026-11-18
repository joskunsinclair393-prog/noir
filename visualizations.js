import { validateVisualization, sampleFunction } from './visualization-schema.js';
const NS='http://www.w3.org/2000/svg';
let sequence=0;
const node=(tag,attributes={},content)=>{const element=document.createElement(tag);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));if(content!=null)element.textContent=String(content);return element;};
const svgNode=(tag,attributes={},content)=>{const element=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));if(content!=null)element.textContent=String(content);return element;};
const format=value=>typeof value==='number'?new Intl.NumberFormat(undefined,{maximumSignificantDigits:5}).format(value):String(value??'');
const colors=['#dedee3','#9d9da6','#72727e','#4e4e5c'];
const provenance={provided:'Conversation / supplied data · Not independently verified',illustrative:'Illustrative sample data · Not real statistics',conceptual:'Conceptual explanation · Check important details'};
function button(label,action){const b=node('button',{type:'button'},label);b.onclick=action;return b;}
function rootSVG(title,width=760,height=360){const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':title,tabindex:'0'});svg.append(svgNode('title',{},title));return svg;}
function tooltip(target,label,frame){target.setAttribute('tabindex','0');target.setAttribute('role','img');target.setAttribute('aria-label',label);target.append(svgNode('title',{},label));
  const show=()=>{const bounds=target.getBoundingClientRect(),host=frame.getBoundingClientRect();const tip=frame.querySelector('.viz-tooltip');tip.textContent=label;tip.hidden=false;tip.style.left=Math.max(8,Math.min(host.width-160,bounds.x-host.x))+'px';tip.style.top=Math.max(4,bounds.y-host.y-38)+'px';};
  const hide=()=>{frame.querySelector('.viz-tooltip').hidden=true;};target.addEventListener('pointerenter',show);target.addEventListener('focus',show);target.addEventListener('pointerleave',hide);target.addEventListener('blur',hide);target.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
}
function chart(spec,frame){
  const svg=rootSVG(spec.title);let labels=spec.labels,series=spec.series;
  if(spec.type==='function'){const points=sampleFunction(spec);labels=points.map(p=>p.x);series=[{name:spec.function.kind,values:points.map(p=>p.y)}];}
  if(spec.type==='pie'){
    const values=series[0].values,total=values.reduce((sum,v)=>sum+v,0);let angle=-Math.PI/2;
    values.forEach((value,i)=>{if(!value)return;const end=angle+value/total*Math.PI*2,x=260+120*Math.cos(angle),y=170+120*Math.sin(angle),ex=260+120*Math.cos(end),ey=170+120*Math.sin(end);
      const slice=value===total?svgNode('circle',{cx:260,cy:170,r:120,fill:colors[i%4]}):svgNode('path',{d:`M260 170L${x} ${y}A120 120 0 ${value/total>.5?1:0} 1 ${ex} ${ey}Z`,fill:colors[i%4],stroke:'#151517','stroke-width':2});
      tooltip(slice,`${labels[i]}: ${format(value)} (${format(value/total*100)}%)`,frame);svg.append(slice);angle=end;});
    const legend=node('div',{class:'viz-legend'});labels.forEach((label,i)=>legend.append(node('span',{},`${label}: ${format(values[i])} (${format(values[i]/total*100)}%)`)));frame.append(legend);return svg;
  }
  const values=series.flatMap(s=>s.values).filter(v=>v!==null);let low=Math.min(...values),high=Math.max(...values);
  if(spec.type==='bar'){low=Math.min(0,low);high=Math.max(0,high);}if(low===high){low-=1;high+=1;}
  const y=v=>300-(v-low)/(high-low)*250,x=i=>spec.type==='bar'?60+(i+.5)*650/labels.length:60+(labels.length===1?320:i/(labels.length-1)*650);
  for(let i=0;i<5;i++){const level=low+(high-low)*i/4;svg.append(svgNode('path',{d:`M60 ${y(level)}H720`,stroke:'#4a4a50','stroke-width':.6,fill:'none'}),svgNode('text',{x:52,y:y(level)+4,'text-anchor':'end',fill:'#92929b','font-size':10},format(level)));}
  labels.forEach((label,i)=>{if(i%Math.ceil(labels.length/8)===0||i===labels.length-1)svg.append(svgNode('text',{x:x(i),y:326,'text-anchor':'middle',fill:'#92929b','font-size':10},format(label).slice(0,18)));});
  series.forEach((s,index)=>{
    if(spec.type==='bar'){
      const groupWidth=650/labels.length,barWidth=Math.max(.5,groupWidth/series.length*.75);
      s.values.forEach((value,i)=>{if(value===null)return;const baseline=y(0),top=y(value),bar=svgNode('rect',{x:60+i*groupWidth+index*groupWidth/series.length+2,y:Math.min(top,baseline),width:barWidth,height:Math.max(.5,Math.abs(top-baseline)),rx:2,fill:colors[index],class:'viz-bar'});tooltip(bar,`${s.name} · ${labels[i]}: ${format(value)}`,frame);svg.append(bar);});
    }else{
      let path='',gap=true;s.values.forEach((v,i)=>{if(v===null){gap=true;return;}path+=(gap?'M':'L')+x(i)+' '+y(v);gap=false;});
      svg.append(svgNode('path',{d:path,fill:'none',stroke:colors[index],'stroke-width':2.3,'stroke-dasharray':index?`${6-index} ${index+2}`:'none',class:'viz-line'}));
      s.values.forEach((value,i)=>{if(value===null)return;const point=svgNode('circle',{cx:x(i),cy:y(value),r:spec.type==='function'?2:4,fill:colors[index],stroke:'#111','stroke-width':1});tooltip(point,`${s.name} · ${format(labels[i])}: ${format(value)}`,frame);svg.append(point);});
    }
  });
  const legend=node('div',{class:'viz-legend'});series.forEach(s=>legend.append(node('span',{},s.name)));frame.append(legend);return svg;
}
function graph(spec,frame){
  const positions=new Map();let width=760,height=400;
  if(spec.type==='timeline'){height=Math.max(300,spec.nodes.length*115+40);spec.nodes.forEach((n,i)=>positions.set(n.id,{x:380,y:70+i*115}));}
  else if(spec.type==='mindmap'){
    const radius=Math.max(210,(spec.nodes.length-1)*28);width=height=radius*2+240;
    spec.nodes.forEach((n,i)=>{const angle=(i-1)/Math.max(1,spec.nodes.length-1)*2*Math.PI;positions.set(n.id,{x:width/2+(i?Math.cos(angle)*radius:0),y:height/2+(i?Math.sin(angle)*radius:0)});});
  }else{
    const pending=new Map(spec.nodes.map(n=>[n.id,0])),levels=new Map();for(const edge of spec.edges)pending.set(edge.to,pending.get(edge.to)+1);
    const queue=spec.nodes.filter(n=>pending.get(n.id)===0).map(n=>n.id);queue.forEach(id=>levels.set(id,0));
    for(let i=0;i<queue.length;i++){const id=queue[i];for(const edge of spec.edges.filter(e=>e.from===id)){levels.set(edge.to,Math.max(levels.get(edge.to)||0,levels.get(id)+1));pending.set(edge.to,pending.get(edge.to)-1);if(pending.get(edge.to)===0)queue.push(edge.to);}}
    // Cycles remain finite and visible; there is no recursive layout or code execution.
    let next=Math.max(0,...levels.values())+1;for(const n of spec.nodes)if(!queue.includes(n.id))levels.set(n.id,next++);
    const groups=new Map();for(const n of spec.nodes){const rank=levels.get(n.id)||0;if(!groups.has(rank))groups.set(rank,[]);groups.get(rank).push(n);}
    width=Math.max(760,(Math.max(...groups.keys())+1)*230+50);height=Math.max(300,...[...groups.values()].map(g=>g.length*120+40));
    for(const [rank,nodes] of groups)nodes.forEach((n,i)=>positions.set(n.id,{x:135+rank*230,y:height/2+(i-(nodes.length-1)/2)*120}));
  }
  const svg=rootSVG(spec.title,width,height),marker='noir-arrow-'+(++sequence),defs=svgNode('defs'),arrow=svgNode('marker',{id:marker,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});arrow.append(svgNode('path',{d:'M0 0L10 5L0 10Z',fill:'#aaa'}));defs.append(arrow);svg.append(defs);
  if(spec.type==='timeline'&&spec.nodes.length>1)svg.append(svgNode('path',{d:`M380 60V${height-60}`,stroke:'#666','stroke-width':2}));
  for(const edge of spec.edges){const a=positions.get(edge.from),b=positions.get(edge.to);const vertical=spec.type==='timeline';const x1=a.x+(vertical?0:85),y1=a.y+(vertical?38:0),x2=b.x-(vertical?0:85),y2=b.y-(vertical?38:0);
    svg.append(svgNode('path',{d:vertical?`M${x1} ${y1}L${x2} ${y2}`:`M${x1} ${y1}C${(x1+x2)/2} ${y1} ${(x1+x2)/2} ${y2} ${x2} ${y2}`,fill:'none',stroke:'#999','stroke-width':1.5,'marker-end':`url(#${marker})`}));
    if(edge.label)svg.append(svgNode('text',{x:(x1+x2)/2,y:(y1+y2)/2-8,'text-anchor':'middle',fill:'#bbb','font-size':11},edge.label));
  }
  for(const n of spec.nodes){const {x,y}=positions.get(n.id),g=svgNode('g',{class:'viz-node'});g.append(n.shape==='decision'?svgNode('path',{d:`M${x} ${y-48}L${x+94} ${y}L${x} ${y+48}L${x-94} ${y}Z`,fill:'#202023',stroke:'#74747d'}):svgNode('rect',{x:x-85,y:y-38,width:170,height:76,rx:11,fill:'#202023',stroke:'#74747d'}));
    const words=n.label.match(/.{1,23}(?:\s|$)|.{1,23}/g)||[n.label];words.slice(0,4).forEach((word,i)=>g.append(svgNode('text',{x,y:y+(i-(Math.min(words.length,4)-1)/2)*15,'text-anchor':'middle',fill:'#eee','font-size':12},word.trim())));tooltip(g,n.label,frame);svg.append(g);
  }return svg;
}
function dataTable(spec){const table=node('table'),head=node('tr');spec.columns.forEach(c=>head.append(node('th',{scope:'col'},c)));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');spec.rows.forEach(row=>{const tr=node('tr');row.forEach(c=>tr.append(node('td',{},c)));body.append(tr);});table.append(body);return table;}
function tableImage(spec){const width=Math.max(760,spec.columns.length*170),height=(spec.rows.length+2)*40,svg=rootSVG(spec.title,width,height);svg.append(svgNode('rect',{width,height,fill:'#131315'}));[spec.columns,...spec.rows].forEach((row,r)=>row.forEach((cell,c)=>svg.append(svgNode('text',{x:12+c*width/spec.columns.length,y:30+r*40,fill:r?'#ccc':'#fff','font-size':12},String(cell).slice(0,25)))));return svg;}
function enableView(svg,frame){const original=svg.getAttribute('viewBox').split(' ').map(Number);let view=[...original],drag;
  const update=()=>svg.setAttribute('viewBox',view.join(' '));
  const zoom=factor=>{const next=view[2]*factor;if(next<original[2]/8||next>original[2]*2)return;view=[view[0]+(view[2]-next)/2,view[1]+(view[3]-view[3]*factor)/2,next,view[3]*factor];update();};
  const controls=node('div',{class:'viz-view-controls','aria-label':'Diagram view'});controls.append(button('−',()=>zoom(1.25)),button('+',()=>zoom(.8)),button('Reset view',()=>{view=[...original];update();}));frame.append(controls);
  controls.children[0].setAttribute('aria-label','Zoom out');controls.children[1].setAttribute('aria-label','Zoom in');
  svg.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('[tabindex="0"]')!==svg)return;drag={x:e.clientX,y:e.clientY,view:[...view]};svg.setPointerCapture(e.pointerId);});
  svg.addEventListener('pointermove',e=>{if(!drag)return;const rect=svg.getBoundingClientRect();view[0]=drag.view[0]-(e.clientX-drag.x)/rect.width*view[2];view[1]=drag.view[1]-(e.clientY-drag.y)/rect.height*view[3];update();});
  const stop=()=>{drag=undefined;};svg.addEventListener('pointerup',stop);svg.addEventListener('pointercancel',stop);svg.addEventListener('lostpointercapture',stop);
  svg.addEventListener('keydown',e=>{if(e.target!==svg)return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key)){e.preventDefault();if(e.key==='+')zoom(.8);else if(e.key==='-')zoom(1.25);else {view[e.key.includes('Left')||e.key.includes('Right')?0:1]+=(e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1)*view[2]*.08;update();}}});
}
export function createVisualization(input,expanded=false){
  const spec=validateVisualization(input),card=node('figure',{class:'noir-visualization','data-viz-type':spec.type});
  const heading=node('header'),title=node('h4',{},spec.title),badge=node('small',{},provenance[spec.dataStatus]);heading.append(title,badge);card.append(heading);
  const frame=node('div',{class:'viz-frame'}),tip=node('div',{class:'viz-tooltip',role:'status',hidden:''});frame.append(tip);let svg;
  if(['table','comparison'].includes(spec.type)){
    if(spec.type==='comparison'&&spec.columns.length>1){const cards=node('div',{class:'viz-comparison'});spec.columns.slice(1).forEach((name,i)=>{const option=node('section');option.append(node('h5',{},name));spec.rows.forEach(row=>option.append(node('strong',{},row[0]),node('p',{},row[i+1])));cards.append(option);});frame.append(cards);}else frame.append(dataTable(spec));
  }else{svg=['line','bar','pie','function'].includes(spec.type)?chart(spec,frame):graph(spec,frame);frame.prepend(svg);enableView(svg,frame);}
  card.append(frame);
  const caption=node('figcaption');if(spec.caption)caption.append(node('p',{},spec.caption));if(spec.source)caption.append(node('p',{},'Source / context: '+spec.source));card.append(caption);
  const toolbar=node('div',{class:'viz-toolbar'}),status=node('span',{role:'status'});
  toolbar.append(button('Copy data',async()=>{try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(JSON.stringify(spec,null,2));status.textContent='Data copied.';}catch{status.textContent='Clipboard unavailable. Use Download data.';}}),button('Download data',()=>saveBlob(new Blob([JSON.stringify(spec,null,2)],{type:'application/json'}),spec.title+'.json')),
    button('Export SVG',()=>{const image=(svg||tableImage(spec)).cloneNode(true);image.setAttribute('viewBox',(svg||image).getAttribute('viewBox'));image.setAttribute('width','1200');image.setAttribute('height',String(1200*image.viewBox.baseVal.height/image.viewBox.baseVal.width));image.querySelectorAll('[tabindex]').forEach(n=>n.removeAttribute('tabindex'));const bg=svgNode('rect',{x:image.viewBox.baseVal.x,y:image.viewBox.baseVal.y,width:image.viewBox.baseVal.width,height:image.viewBox.baseVal.height,fill:'#131315'});image.insertBefore(bg,image.firstChild);saveBlob(new Blob([new XMLSerializer().serializeToString(image)],{type:'image/svg+xml'}),spec.title+'.svg');}));
  if(!expanded)toolbar.append(button('Expand',()=>{const dialog=node('dialog',{class:'viz-dialog','aria-label':spec.title}),close=button('×',()=>dialog.close());close.setAttribute('aria-label','Close visualization');dialog.append(close,createVisualization(spec,true));dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();}));
  toolbar.append(status);card.append(toolbar);return card;
}
function saveBlob(blob,name){const url=URL.createObjectURL(blob),link=node('a',{href:url,download:name.replace(/[^a-zA-Z0-9._ -]/g,'').slice(0,100)||'noir-visualization'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
export function renderVisualizations(bubble){let count=0;for(const block of bubble.querySelectorAll('.code-block')){if(block.querySelector('.code-toolbar span')?.textContent!=='noir-viz')continue;try{if(++count>3)throw Error('Only three visualizations can be rendered per answer.');const raw=block.querySelector('code').textContent;if(raw.length>24000)throw Error('Visualization is too large.');block.replaceWith(createVisualization(JSON.parse(raw)));}catch(error){const warning=node('p',{class:'viz-error',role:'status'},'Visualization could not be displayed: '+(error instanceof SyntaxError?'Invalid or incomplete JSON.':error.message));block.before(warning);}}}
