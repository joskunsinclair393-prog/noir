export const STUDIO_TYPES = ['document','diagram','presentation','website'];
const fail = message => { throw Object.assign(Error(message), {status:400,code:'invalid_studio_content'}); };
export function validateStudioData(raw) {
 if (!raw || !Array.isArray(raw.files) || raw.files.length>30 || JSON.stringify(raw).length>400000) fail('A project supports up to 30 files and 400 KB of text.');
 const ids=new Set();
 const files=raw.files.map(file=>{
  if(!file || typeof file.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(file.id)||ids.has(file.id))fail('Invalid or repeated file ID.');ids.add(file.id);
  if(typeof file.name!=='string'||!file.name.trim()||file.name.length>100||!STUDIO_TYPES.includes(file.type)||typeof file.content!=='string'||file.content.length>150000)fail('Check the file name, type and text size.');
  return {id:file.id,name:file.name.trim(),type:file.type,content:file.content,folder:typeof file.folder==='string'?file.folder.trim().slice(0,80):'',...(file.page&&{page:{size:['A4','Letter','Landscape'].includes(file.page.size)?file.page.size:'A4',fontSize:[10,12,14,16].includes(file.page.fontSize)?file.page.fontSize:12,margin:[40,55,75].includes(file.page.margin)?file.page.margin:55}})};
 });return {files};
}
export function prototypeSource(content) {
 let value;try{value=JSON.parse(content);}catch{throw Error('Website source must be JSON containing index.html, styles.css and script.js.');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid website files.');
 const files={};for(const name of ['index.html','styles.css','script.js']){if(value[name]!=null&&typeof value[name]!=='string')throw Error('Website files must contain text.');files[name]=value[name]||'';}
 if(Object.values(files).join('').length>150000)throw Error('Prototype is too large.');return files;
}
