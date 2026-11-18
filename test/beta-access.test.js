import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoirServer } from '../server.js';

test('private beta protects APIs, verifies emails, preserves owner and revokes immediately', async () => {
 const folder=mkdtempSync(join(tmpdir(),'noir-beta-'));
 const ownerId='11111111-1111-4111-8111-111111111111';
 let approved=true, unavailable=false, databaseCalls=0;
 const server=createNoirServer({dataFile:join(folder,'store.json'),config:{authRequired:true,privateBetaEnabled:true,ownerId,supabaseUrl:'https://db.example',supabaseAnonKey:'anon',supabaseServiceRoleKey:'secret'},fetchImpl:async(raw,init)=>{
  const url=new URL(raw);
  if(url.pathname==='/auth/v1/user') {
   const who=init.headers.authorization.slice(7);
   return Response.json({id:who==='owner'?ownerId:'22222222-2222-4222-8222-222222222222',email:who+'@example.com',confirmed_at:'2026-01-01',email_confirmed_at:who==='unverified'?null:'2026-01-01'});
  }
  if(url.pathname.endsWith('/noir_set_beta_access')) { const body=JSON.parse(init.body); assert.equal(body.p_email,'tester@example.com'); approved=body.p_grant; return Response.json(true); }
  if(url.pathname.endsWith('/noir_beta_applications')) {
   databaseCalls++; assert.equal(init.headers.apikey,'secret');
   if(url.searchParams.has('order')) return Response.json([]);
   assert.equal(url.searchParams.get('status'),'eq.approved');
   assert.equal(url.searchParams.get('pilot_slot'),'not.is.null');
   if(unavailable) return new Response(null,{status:503});
   return Response.json(approved && url.searchParams.get('email')==='eq.tester@example.com'?[{id:'approved'}]:[]);
  }
  throw Error('Unexpected external call: '+url.pathname);
 }});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(who,path='/api/not-found')=>fetch(base+path,{headers:who?{authorization:'Bearer '+who}:{}});
 try {
  assert.equal((await request(null)).status,401);
  for(const who of ['other','unverified']) {const r=await request(who);assert.equal(r.status,403);assert.equal((await r.json()).code,'private_beta_required');}
  assert.equal((await request('tester')).status,404); // passed access check
  approved=false;assert.equal((await request('tester')).status,403);
  unavailable=true;assert.equal((await request('tester')).status,503);
  unavailable=false;
  const session=await fetch(base+'/api/admin/session',{method:'POST',headers:{authorization:'Bearer owner'}});
  const cookie=session.headers.get('set-cookie').split(';')[0];
  const manage=async(action,email='tester@example.com')=>fetch(base+'/admin/beta',{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action,email})});
  assert.match(await (await manage('grant')).text(),/Beta access updated/);
  assert.equal((await request('tester')).status,404);
  await manage('revoke');assert.equal((await request('tester')).status,403);
  assert.match(await (await manage('grant','owner@example.com')).text(),/Owner access is preserved/);
  const calls=databaseCalls;assert.equal((await request('owner')).status,404);assert.equal(databaseCalls,calls);
  assert.equal((await request('other','/api/admin/analytics')).status,403);
  assert.equal((await fetch(base)).status,200);
  const screen=await fetch(base+'/private-beta');assert.equal(screen.status,200);assert.match(await screen.text(),/https:\/\/tally.so\/r\/BEp0DN/);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(folder,{recursive:true,force:true});}
});
