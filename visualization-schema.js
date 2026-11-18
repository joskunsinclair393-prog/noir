// Shared, dependency-free validation. No executable expressions or arbitrary SVG/HTML.
export const VISUAL_TYPES = ['line','bar','pie','flowchart','process','mindmap','comparison','timeline','decision-tree','architecture','function','table'];
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
  if (!['provided','illustrative','conceptual'].includes(output.dataStatus)) fail('A data provenance label is required.');
  if (value.source!=null) output.source=text(value.source,300);
  if (value.caption!=null) output.caption=text(value.caption,400);
  if (['line','bar','pie'].includes(value.type)) {
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
  return String(reply).replace(/```noir-viz\s*\n([\s\S]*?)(```|$)/g,(_block,json,closing)=>{
    try {
      if (!closing) fail('The model returned an incomplete visualization. Try a smaller diagram.');
      if (++count>3||json.length>24000) fail('Visualization size limit exceeded.');
      return '```noir-viz\n'+JSON.stringify(validateVisualization(JSON.parse(json)))+'\n```';
    } catch(error) { return 'Visualization unavailable: '+(error instanceof SyntaxError?'The model returned incomplete visualization data.':error.message); }
  });
}
export function wantsVisualization(messages) {
  const last=messages.at(-1)?.text||'';
  return /\b(visuali[sz]e|diagram|flowchart|flow chart|mind map|mindmap|chart|graph|plot|timeline|decision tree|architecture diagram|process diagram|data table|structured table|compare.{0,40}visually)\b/i.test(last) ||
    (messages.some(m=>m.role==='assistant'&&m.text?.includes('```noir-viz'))&&/\b(change|update|add|remove|redraw|instead|make|adjust)\b/i.test(last));
}
export const VISUALIZATION_INSTRUCTIONS = `When the user requests a visualization, include a short explanation plus up to 3 fenced noir-viz JSON blocks. Do not add a diagram to ordinary replies. Never invent real statistics: use only numbers supplied in the conversation or retrieved by authorized tools; otherwise ask for data, or mark explicitly requested example data illustrative. All conceptual diagrams use dataStatus conceptual. Do not claim sources were verified. Only this schema is supported:
Common: {"version":1,"type":"...","title":"...","dataStatus":"provided|illustrative|conceptual","source":"brief honest provenance","caption":"optional caveat"}.
line, bar, pie: add labels:[strings], series:[{name:string,values:[numbers]}], optional unit. Labels and values must align. Pie takes one nonnegative series. Max 100 labels and 4 series.
table or comparison: add columns:[strings],rows:[[string|number|null]]. Max 12 columns, 100 rows, 600 cells. Comparison uses the first column as an attribute and the remaining columns as options.
flowchart, process, mindmap, timeline, decision-tree, architecture: add nodes:[{id:"alphanumeric_id",label:"...",shape:"box|decision"}],edges:[{from:"id",to:"id",label:"optional"}]. Max 24 nodes and 40 edges. Timeline nodes must already be ordered. Include explicit edges where meaningful.
function: add function:{kind:"polynomial",coefficients:[constant,x coefficient,x^2 coefficient,...]} OR function:{kind:"sin|cos|exp|log|abs",amplitude:1,frequency:1,offset:0}, domain:[min,max]. Functions use radians and natural log. Never supply arbitrary expression strings or code.
Use valid JSON, no HTML, scripts, Markdown inside JSON, URLs as executable content, or unsupported fields. Keep blocks compact. Diagrams can accompany an explanation, not replace it. If a requested visualization is unsupported, explain that honestly.`;
