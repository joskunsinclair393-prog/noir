// Shared, dependency-free validation. No executable expressions or arbitrary SVG/HTML.
export const VISUAL_TYPES = ['line','bar','pie','flowchart','process','mindmap','comparison','timeline','decision-tree','architecture','function','table','clock','calculator','cards'];
export const VIZ_LIMITS = { bytes:24000, blocks:3, nodes:24, edges:40, points:100, series:4 };
const fail = text => { throw new Error(text); };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value,max=120) => typeof value === 'string' && value.trim() && value.length<=max ? value.trim() : fail('Check text labels and their length.');
const number = value => typeof value==='number' && Number.isFinite(value) && Math.abs(value)<=1e12 ? value : fail('Values must be finite numbers within supported bounds.');
const list = (value,max,min=1) => Array.isArray(value) && value.length>=min && value.length<=max ? value : fail('Too many, too few, or missing data items.');
export function validateVisualization(value) {
  if (!record(value) || new TextEncoder().encode(JSON.stringify(value)).length>VIZ_LIMITS.bytes) fail('Visualization is too large or is not an object.');
  if (value.version!==1 || !VISUAL_TYPES.includes(value.type)) fail('Unsupported visualization version or type.');
  const output = { version:1, type:value.type, title:text(value.title), dataStatus:value.dataStatus };
  if (!['provided','illustrative','conceptual',...(value.type==='clock'?['live']:[])].includes(output.dataStatus)) fail('A data provenance label is required.');
  if (value.layout!=null) { if (!['horizontal','vertical'].includes(value.layout)) fail('Choose a horizontal or vertical layout.'); output.layout=value.layout; }
  if (value.colors!=null) { if (!Array.isArray(value.colors)||!value.colors.length||value.colors.length>4||value.colors.some(c=>typeof c!=='string'||!/^#[a-f0-9]{6}$/i.test(c))) fail('Use up to four hexadecimal colors.'); output.colors=value.colors; }
  if (value.source!=null) output.source=text(value.source,300);
  if (value.caption!=null) output.caption=text(value.caption,400);
  if (value.unit!=null) output.unit=text(value.unit,40);
  if (value.type==='clock') {
    if (output.dataStatus!=='live') fail('Clocks must use live device time, not an AI timestamp.');
    output.zones=list(value.zones,4).map(zone=>{
      if (!record(zone)) fail('Invalid clock zone.');
      const timeZone=text(zone.timeZone,80);
      try { new Intl.DateTimeFormat('en',{timeZone}).format(0); } catch { fail('Choose a valid IANA time zone such as Australia/Sydney.'); }
      return {label:text(zone.label,60),timeZone};
    });
  } else if (value.type==='calculator') {
    if (!Object.hasOwn(CALCULATORS,value.operation)) fail('Choose a supported calculator operation.');
    output.operation=value.operation;
    const definition=CALCULATORS[value.operation];
    output.values=list(value.values,definition.labels.length,definition.labels.length).map(number);
  } else if (value.type==='cards') {
    output.items=list(value.items,8).map(item=>{
      if (!record(item)) fail('Invalid information card.');
      return {label:text(item.label,80),text:text(item.text,1000)};
    });
  } else if (['line','bar','pie'].includes(value.type)) {
    if (value.dataStatus==='conceptual') fail('Numeric charts must identify supplied or illustrative data.');
    output.labels=list(value.labels,100).map(label=>text(label,80));
    output.series=list(value.series,value.type==='pie'?1:4).map(series=>{
      if (!record(series)) fail('Invalid data series.');
      const values=list(series.values,100);
      if (values.length!==output.labels.length) fail('Every series must match its labels.');
      return {name:text(series.name,80),values:values.map(v=>v===null&&value.type!=='pie'?null:number(v))};
    });
    const values=output.series.flatMap(s=>s.values).filter(v=>v!==null);
    if (!values.length) fail('The chart has no numeric values.');
    if (value.type==='pie' && (values.some(v=>v<0)||values.reduce((a,b)=>a+b,0)<=0)) fail('Pie values must be nonnegative with a positive total.');
    if (value.type==='pie' && (values.some(v=>v<0)||values.reduce((a,b)=>a+b,0)<=0)) fail('Pie values must be nonnegative and have a positive total.');
    if (value.unit!=null) output.unit=text(value.unit,30);
  } else if (['table','comparison'].includes(value.type)) {
    output.columns=list(value.columns,12).map(label=>text(label,80));
    output.rows=list(value.rows,100).map(row=>{
      if (!Array.isArray(row)||row.length!==output.columns.length) fail('Table rows must match the columns.');
      return row.map(cell=>cell===null?'':typeof cell==='number'?number(cell):typeof cell==='string'&&cell.length<=400?cell:fail('Invalid table cell.'));
    });
    if (output.rows.length*output.columns.length>600) fail('Tables are limited to 600 cells.');
  } else if (value.type==='function') {
    const fn=value.function;
    if (!record(fn)||!['polynomial','sin','cos','exp','log','abs'].includes(fn.kind)) fail('Use a supported function, not an executable expression.');
    output.function={kind:fn.kind};
    if (fn.kind==='polynomial') output.function.coefficients=list(fn.coefficients,9).map(number);
    else for (const key of ['amplitude','frequency','offset']) output.function[key]=number(fn[key]??(key==='offset'?0:1));
    if (!Array.isArray(value.domain)||value.domain.length!==2) fail('Provide a two-number domain.');
    output.domain=value.domain.map(number);
    if (output.domain[1]-output.domain[0]<1e-6||output.domain[1]-output.domain[0]>1e6) fail('Unsupported function domain.');
  } else {
    output.nodes=list(value.nodes,24).map(node=>{
      if (!record(node)||typeof node.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(node.id)) fail('Invalid node identifier.');
      if (node.shape!=null&&!['box','decision'].includes(node.shape)) fail('Unsupported node shape.');
      return {id:node.id,label:text(node.label),...(node.shape?{shape:node.shape}:{})};
    });
    const ids=new Set(output.nodes.map(n=>n.id));
    if (ids.size!==output.nodes.length) fail('Node identifiers must be unique.');
    output.edges=list(value.edges??[],40,0).map(edge=>{
      if (!record(edge)||!ids.has(edge.from)||!ids.has(edge.to)) fail('An edge references a missing node.');
      return {from:edge.from,to:edge.to,...(edge.label?{label:text(edge.label,60)}:{})};
    });
  }
  return output;
}
// Native operations only: never evaluate a model-supplied formula or expression.
export const CALCULATORS = Object.freeze({
  sum:{labels:['First number','Second number'],formula:'First number + second number'},
  difference:{labels:['First number','Second number'],formula:'First number − second number'},
  product:{labels:['First number','Second number'],formula:'First number × second number'},
  quotient:{labels:['Numerator','Denominator'],formula:'Numerator ÷ denominator'},
  percentage:{labels:['Amount','Percent (%)'],formula:'Amount × percent ÷ 100'},
  'compound-interest':{labels:['Principal','Annual rate (%)','Years'],formula:'Principal × (1 + annual rate ÷ 100) ^ years; annual compounding, no deposits, fees or taxes'},
});
export function calculate(operation,values) {
  const definition=CALCULATORS[operation];
  if (!Object.hasOwn(CALCULATORS,operation)||!Array.isArray(values)||values.length!==definition.labels.length) fail('Unsupported calculator inputs.');
  values.forEach(number);
  const [a,b,c]=values;
  if (operation==='quotient'&&b===0) fail('Cannot divide by zero.');
  if (operation==='compound-interest'&&(a<0||b< -100||c<0||c>1000)) fail('Use a nonnegative principal, a rate of at least −100%, and 0–1,000 years.');
  const result=operation==='sum'?a+b:operation==='difference'?a-b:operation==='product'?a*b:operation==='quotient'?a/b:operation==='percentage'?a*b/100:a*(1+b/100)**c;
  return number(result);
}
export function clockValues(spec,now=new Date()) {
  return spec.zones.map(zone=>({label:zone.label,timeZone:zone.timeZone,
    time:new Intl.DateTimeFormat(undefined,{timeZone:zone.timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(now),
    date:new Intl.DateTimeFormat(undefined,{timeZone:zone.timeZone,weekday:'short',year:'numeric',month:'short',day:'numeric'}).format(now)}));
}
export function sampleFunction(spec) {
  const {function:fn,domain:[lo,hi]}=validateVisualization(spec);
  const points=Array.from({length:161},(_,i)=>{
    const x=lo+(hi-lo)*i/160;
    const y=fn.kind==='polynomial'?fn.coefficients.reduceRight((sum,c)=>sum*x+c,0):
      fn.amplitude*Math[fn.kind==='abs'?'abs':fn.kind](fn.frequency*x)+fn.offset;
    return {x,y:Number.isFinite(y)&&Math.abs(y)<=1e12?y:null};
  });
  if (!points.some(p=>p.y!==null)) fail('This function has no finite values in the selected domain.');
  return points;
}
export function sanitizeVisualizations(reply) {
  let count=0;
  return String(reply).replace(/```(noir-viz|noir-ui|json)[ \t]*\r?\n([\s\S]*?)(```|$)/gi,(_block,language,json,closing)=>{
    // Some models use a JSON fence despite the instruction. Accept only the
    // exact native schema; ordinary code examples remain ordinary code.
    if(language.toLowerCase()==='json'){
      try{const value=JSON.parse(json);if(value?.version!==1||!VISUAL_TYPES.includes(value?.type))return _block;}catch{return _block;}
    }
    try {
      if (!closing) fail('The model returned an incomplete visualization. Try a smaller diagram.');
      if (++count>3||json.length>24000) fail('Visualization size limit exceeded.');
      return '```noir-viz\n'+JSON.stringify(validateVisualization(JSON.parse(json)))+'\n```';
    } catch(error) { return 'Visualization unavailable: '+(error instanceof SyntaxError?'The model returned incomplete visualization data.':error.message); }
  });
}
export function visualizationHint(messages,timeZone='UTC') {
  const prompt=messages.at(-1)?.text?.split('\n\nStudy materials')[0]||'';
  let type;
  if(/\b(weather|forecast|temperature)\b/i.test(prompt))type='cards';
  else if(/\b(clock|time zone|timezone|time in|current time|what.?s? the time|what time|time is it)\b/i.test(prompt))type='clock';
  else if(/\bpie chart\b/i.test(prompt))type='pie';
  else if(/\bbar (?:chart|graph)\b/i.test(prompt))type='bar';
  else if(/\bline (?:chart|graph)\b/i.test(prompt))type='line';
  else if(/\b(calculat\w*|percent\w*|compound interest|split.{0,15}bill|tip)\b|\d\s*%/i.test(prompt))type='calculator';
  else if(/\b(pie|proportion|share of|breakdown)\b/i.test(prompt)&&/\d/.test(prompt))type='pie';
  else if(/\b(compare|comparison|versus|vs\.?|difference between)\b/i.test(prompt))type='comparison';
  else if(/\b(bar chart|bar graph)\b/i.test(prompt))type='bar';
  else if(/\b(line chart|line graph|trend|monthly|growth|sales)\b/i.test(prompt)&&/\d/.test(prompt))type='line';
  else if(/\b(chart|graph|plot)\b/i.test(prompt))type='bar';
  else if(/\b(mind ?map)\b/i.test(prompt))type='mindmap';
  else if(/\btimeline\b/i.test(prompt))type='timeline';
  else if(/\bdecision tree\b/i.test(prompt))type='decision-tree';
  else if(/\barchitecture\b/i.test(prompt))type='architecture';
  else if(/\b(flowchart|flow chart|diagram|process|workflow|how.{0,40}works?|steps to|step.by.step)\b/i.test(prompt))type='flowchart';
  else if(/\b(key facts|key points|information cards|summarize.{0,30}options)\b/i.test(prompt))type='cards';
  if(!type)return '';
  const base={version:1,type,title:'Short title',dataStatus:'conceptual'};
  const example=type==='clock'?{...base,dataStatus:'live',zones:[{label:'Your time zone',timeZone}]}:
    type==='calculator'?{...base,dataStatus:'illustrative',operation:'percentage',values:[100,10]}:
    type==='comparison'?{...base,columns:['Attribute','Option A','Option B'],rows:[['Approach','First description','Second description']]}:
    type==='cards'?{...base,items:[{label:'Key point',text:'Grounded description'}]}:
    ['flowchart','mindmap','timeline','decision-tree','architecture'].includes(type)?{...base,nodes:[{id:'a',label:'First step'},{id:'b',label:'Next step'}],edges:[{from:'a',to:'b'}]}:
    {...base,dataStatus:'illustrative',labels:['Category A','Category B'],series:[{name:'Value',values:[1,2]}]};
  return `For this request prefer one native ${type} component, automatically, rather than offering to create one later. Put the complete fenced noir-viz JSON block BEFORE a brief explanation so it fits the response budget. Use the exact schema, not Python, Mermaid, ASCII art or a Markdown table. Keep it compact (at most 10 points/nodes unless essential). Adapt labels, values and provenance to the user's actual request; NEVER copy example data or invent missing statistics. If the required data is absent, ask for it instead. Schema example only: \n\`\`\`noir-viz\n${JSON.stringify(example)}\n\`\`\`\n`+
    (type==='clock'?`The user's default time zone is ${timeZone}; use requested cities when specified. The UI CAN read live device time, so do not say it cannot show a clock.`:'')+
    (/\b(weather|forecast|temperature)\b/i.test(prompt)?' No live weather tool is configured. You may show cards ONLY for weather observations supplied by the user or retrieved by an authorized tool, clearly labelled with source and observation time. Otherwise explain that live weather is unavailable; never invent a forecast.':'');
}
export function wantsVisualization(messages) {
  const last=messages.at(-1)?.text||'';
  return /\b(visuali[sz]e|diagram|flowchart|flow chart|mind map|mindmap|chart|graph|plot|timeline|decision tree|architecture diagram|process diagram|data table|structured table|show me how|compare.{0,40}visually)\b/i.test(last) ||
    (messages.some(m=>m.role==='assistant'&&m.text?.includes('```noir-viz'))&&/\b(change|update|add|remove|redraw|instead|make|adjust)\b/i.test(last));
}
export const VISUALIZATION_INSTRUCTIONS = `When a native component would materially help (time zones, supplied data, a process, an adjustable calculation or organized facts), include a short text explanation plus up to 3 fenced noir-viz JSON blocks. Use plain text for greetings and ordinary prose; do not force components into every reply. Never invent real statistics: use only numbers supplied in the conversation or retrieved by authorized tools; otherwise ask for data, or mark explicitly requested example data illustrative. All conceptual diagrams use dataStatus conceptual. Do not claim sources were verified. Only this schema is supported:
Common: {"version":1,"type":"...","title":"...","dataStatus":"provided|illustrative|conceptual","source":"brief honest provenance","caption":"optional caveat"}.
line, bar, pie: add labels:[strings], series:[{name:string,values:[numbers]}], optional unit. Labels and values must align. Pie takes one nonnegative series. Max 100 labels and 4 series.
table or comparison: add columns:[strings],rows:[[string|number|null]]. Max 12 columns, 100 rows, 600 cells. Comparison uses the first column as an attribute and the remaining columns as options.
flowchart, process, mindmap, timeline, decision-tree, architecture: add nodes:[{id:"alphanumeric_id",label:"...",shape:"box|decision"}],edges:[{from:"id",to:"id",label:"optional"}]. Max 24 nodes and 40 edges. Timeline nodes must already be ordered. Include explicit edges where meaningful.
function: add function:{kind:"polynomial",coefficients:[constant,x coefficient,x^2 coefficient,...]} OR function:{kind:"sin|cos|exp|log|abs",amplitude:1,frequency:1,offset:0}, domain:[min,max]. Functions use radians and natural log. Never supply arbitrary expression strings or code.
clock: dataStatus MUST be live; add zones:[{label:"Sydney",timeZone:"Australia/Sydney"}]. Use 1–4 valid IANA time zones. The UI computes actual device time and daylight saving; NEVER supply a timestamp or invent the current time. Ask the user for an ambiguous location. Describe time in text only if retrieved accurately.
calculator: add operation:"sum|difference|product|quotient|percentage|compound-interest", values:[numbers]. Exactly 2 values except compound-interest takes 3. Input order: first/second number; numerator/denominator; amount/percent; or principal/annual rate percent/years. UI computes results; no formula strings. Use user-provided starting values, or honestly labeled illustrative defaults. Compound interest assumes annual compounding without deposits, fees or taxes; not financial advice or a forecast.
cards: add items:[{label:"...",text:"..."}]. Up to 8 cards. Text only, no HTML or clickable actions. Keep facts grounded in the conversation or authorized sources. Never claim live access for cards or numeric charts; explain missing live data.
Use valid JSON, no HTML, scripts, Markdown inside JSON, URLs as executable content, or unsupported fields. Keep blocks compact. Diagrams can accompany an explanation, not replace it. If a requested visualization is unsupported, explain that honestly.`;
