import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoirServer} from '../server.js';

test('Studio is hidden, redirected and disabled without reading stored projects',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'noir-studio-disabled-'));
 const owner='11111111-1111-4111-8111-111111111111';let storageCalls=0;
 const server=createNoirServer({dataFile:join(folder,'store.json'),config:{authRequired:true,ownerId:owner,supabaseUrl:'https://auth.example',supabaseAnonKey:'fixture',supabaseServiceRoleKey:'fixture-secret'},fetchImpl:async raw=>{if(new URL(raw).pathname==='/auth/v1/user')return Response.json({id:owner,email:'owner@example.test',email_confirmed_at:'2026-01-01'});storageCalls++;throw Error('No Studio or account storage calls expected');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const path of ['/studio','/studio/project/123','/app/studio','/app?workspace=studio','/?studioInvite=old-token','/index.html?workspace=studio']){
   const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,302,path);assert.equal(r.headers.get('location'),'/app');
  }
  const callback=await fetch(base+'/?code=preserve&studioInvite=old-token',{redirect:'manual'});assert.equal(callback.headers.get('location'),'/app?code=preserve');
  for(const method of ['GET','POST','DELETE']){const r=await fetch(base+'/api/studio',{method,headers:{authorization:'Bearer owner','content-type':'application/json'},...(method==='POST'&&{body:JSON.stringify({action:'create',name:'No',studioEnabled:true})})});assert.equal(r.status,410);assert.equal((await r.json()).code,'studio_disabled');}
  assert.equal((await fetch(base+'/api/studio/files',{headers:{authorization:'Bearer owner'}})).status,410);
  assert.equal((await fetch(base+'/api/studio')).status,401);
  const context=await fetch(base+'/api/chat',{method:'POST',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify({message:'Read file',studioContext:{projectId:owner,fileId:'old'}})});assert.equal(context.status,410);assert.equal(storageCalls,0);
  for(const path of ['/studio.js','/studio.css','/studio-model.js','/studio-exports.js'])assert.equal((await fetch(base+path)).status,404);
  const html=await(await fetch(base)).text();assert.doesNotMatch(html,/Studio|studioDemoInput|href="#studio"|workspace=studio/);assert.match(html,/NOIR Voice/);assert.match(html,/Smart Route/);assert.match(html,/demo-phone/);assert.match(html,/giant-wordmark/);
  const app=await(await fetch(base+'/app')).text();assert.doesNotMatch(app,/Studio/);assert.match(app,/Chat &amp; Voice/);
  const script=await(await fetch(base+'/script.js')).text();assert.doesNotMatch(script,/import\('\.\/studio\.js'\)|mountStudio|Save to Studio/);
  const workspace=await(await fetch(base+'/workspace.js')).text();assert.doesNotMatch(workspace,/Studio|workspace-toggle/);assert.match(workspace,/'instant','think'/);
  for(const file of ['studio.js','studio.css','studio-model.js','studio-exports.js','supabase/studio.sql'])assert.ok(existsSync(new URL('../'+file,import.meta.url)));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(folder,{recursive:true,force:true});}
});
