import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNoirServer} from '../server.js';

test('Google can read public verification and SEO metadata while private routes stay protected',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'noir-seo-'));
 const server=createNoirServer({dataFile:join(folder,'store.json'),config:{authRequired:true,supabaseUrl:'https://auth.example',supabaseAnonKey:'fixture',googleSiteVerification:'other-environment-token'}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/',{headers:{'user-agent':'Googlebot'}});assert.equal(response.status,200);assert.doesNotMatch(response.headers.get('x-robots-tag')||'',/noindex|nofollow/);
  const html=await response.text(),head=/<head>([\s\S]*?)<\/head>/i.exec(html)[1];
  assert.match(head,/<meta name="google-site-verification" content="bjzxMg7JHi2mLmscaWsIbjcOdG4XCsgAHRHBuo0FlRw" \/>/);
  assert.equal((head.match(/name="google-site-verification"/g)||[]).length,1);assert.doesNotMatch(head,/other-environment-token/);
  assert.match(head,/<title>NOIR AI — Chat, Voice &amp; Studio<\/title>/);assert.match(head,/<link rel="canonical" href="https:\/\/noir-buhz.onrender.com\/">/);
  for(const property of ['og:title','og:description','og:url','og:image','og:type'])assert.ok(head.includes('property="'+property+'"'));
  for(const name of ['description','twitter:card','twitter:title','twitter:description','twitter:image'])assert.ok(head.includes('name="'+name+'"'));
  assert.match(html,/class="giant-wordmark"/);assert.match(html,/studioDemoInput/);
  const sitemapResponse=await fetch(base+'/sitemap.xml');assert.equal(sitemapResponse.status,200);assert.match(sitemapResponse.headers.get('content-type'),/xml/);const sitemap=await sitemapResponse.text();assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]),['https://noir-buhz.onrender.com/']);
  const robotsResponse=await fetch(base+'/robots.txt');assert.equal(robotsResponse.status,200);const robots=await robotsResponse.text();assert.match(robots,/^Allow: \/$/m);assert.doesNotMatch(robots,/^Disallow: \/$/m);
  for(const path of ['/app','/index.html','/api/','/admin','/studio','/private-beta','/account','/chat','/settings'])assert.ok(robots.includes('Disallow: '+path));
  assert.match(robots,/Sitemap: https:\/\/noir-buhz.onrender.com\/sitemap.xml/);
  for(const path of ['/app','/index.html','/private-beta'])assert.match((await fetch(base+path)).headers.get('x-robots-tag'),/noindex/);
  for(const path of ['/api/chats','/api/studio','/api/session'])assert.equal((await fetch(base+path)).status,401);
  for(const path of ['/admin','/admin/beta','/api/admin/analytics'])assert.equal((await fetch(base+path)).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(folder,{recursive:true,force:true});}
});
