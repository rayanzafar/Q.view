#!/usr/bin/env node
// Reproducible source/schema inventory plus reviewed business relationships. Never reads .env/live DB.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROLE_GRANTS, ROLE_LABELS } from '../src/core/rbac/matrix.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
const walk = p => readdirSync(join(root,p),{withFileTypes:true}).flatMap(e => e.isDirectory()?walk(`${p}/${e.name}`):[`${p}/${e.name}`]).sort();
const code = [...walk('src'),...walk('tests'),...walk('scripts')].filter(p=>/\.m?js$/.test(p));
const migrations=walk('migrations').filter(p=>p.endsWith('.sql'));
const sources=[...new Set([...code,...migrations,'docs/KNOWN-ISSUES.md','docs/system-graph/model.json','docs/system-graph/viewer.html'])].sort();
const fingerprint=createHash('sha256');for(const p of sources) fingerprint.update(p+'\0'+read(p)+'\0');
const digest=fingerprint.digest('hex');
const output='docs/system-graph/graph.json';
if(process.argv.includes('--check')) {
 const old=JSON.parse(read(output));
 if(old.sourceDigest!==digest) throw new Error('System graph is stale: run npm run graph');
 console.log('System graph matches source fingerprint');process.exit(0);
}
const tmp=mkdtempSync(join(tmpdir(),'sanad-graph-'));let schema;
try {
 const env={...process.env,DATABASE_URL:'',SANAD_DB:join(tmp,'schema.db'),NODE_ENV:'development',AI_ENGINE:'local',MAIL_TRANSPORT:'preview'};
 for(const script of ['scripts/migrate.js','scripts/lib/graph-schema.mjs']) {
  const r=spawnSync(process.execPath,['--experimental-sqlite',script],{cwd:root,env,encoding:'utf8',maxBuffer:10*1024*1024});
  if(r.status!==0) throw new Error(`Schema extraction failed: ${script}: ${r.stderr.slice(-1000)}`);
  if(script.endsWith('graph-schema.mjs'))schema=JSON.parse(r.stdout.split('\nGRAPH_SCHEMA=')[1].trim());
 }
} finally {rmSync(tmp,{recursive:true,force:true});}
const nodes=new Map(),edges=[];
const add=n=>{if(nodes.has(n.id))throw new Error('Duplicate node '+n.id);nodes.set(n.id,n);};
const edge=(from,to,label,evidence,kind='source')=>edges.push({from,to,label,evidence,kind});
const file=p=>'file:'+p;
for(const p of code) add({id:file(p),kind:p.startsWith('tests/')?'test':p.startsWith('scripts/')?'automation':'code',label:p.split('/').pop(),detail:p,sources:[p]});
const dirs=[...new Set(code.filter(p=>p.startsWith('src/modules/')&&p.split('/').length>3).map(p=>p.split('/')[2]))];
for(const d of dirs) {
 add({id:'module:'+d,kind:'module',label:d,detail:'وحدة برمجية موجودة؛ وجودها لا يثبت اكتمال وظائفها.',sources:code.filter(p=>p.startsWith('src/modules/'+d+'/'))});
 for(const p of code.filter(p=>p.startsWith('src/modules/'+d+'/'))) edge('module:'+d,file(p),'يحتوي',p);
}
const unresolved=[];
for(const p of code) {
 const text=read(p);
 // Literal ESM imports/re-exports only. Dynamic import expressions and generated URLs are not inferred.
 const rx=/(?:^|\n)\s*(?:import\s+(?:[^;]*?\s+from\s+)?|export\s+[^;]*?\s+from\s+)["']([^"']+)["']/g;
 const imports=[...text.matchAll(rx),...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)];
 for(const m of imports) {
  if(!m[1].startsWith('.'))continue;
  const target=relative(root,resolve(root,dirname(p),m[1]));
  if(nodes.has(file(target)))edge(file(p),file(target),'استيراد صريح',p);
  else unresolved.push({file:p,target,reason:'خارج ملفات JavaScript المفهرسة أو مسار غير محلول'});
 }
 if(p.endsWith('routes.js')) {
  const rx=/(?:^|\n)\s*(\w+)\.(get|post|patch|put|delete|options|head)\(\s*(\[[^\]]*\]|['"][^'"]*['"])/g;
  for(const m of text.matchAll(rx))for(const quoted of m[3].matchAll(/['"]([^'"]+)['"]/g)) {
   const id=`route:${p}:${m.index}:${quoted[1]}`;
   add({id,kind:'route',label:m[2].toUpperCase()+' '+quoted[1],detail:'تصريح مسار محلي في '+m[1]+'؛ بادئة التثبيت والحارس في المصدر. ليس إثباتًا لاستجابة ناجحة.',sources:[p],method:m[2].toUpperCase(),path:quoted[1]});
   edge(file(p),id,'يصرح بالمسار',p);
  }
 }
}
const web=read('src/web/routes.js');const pageBlock=web.match(/const\s+PAGES\s*=\s*\{([\s\S]*?)\};/)[1];
for(const m of pageBlock.matchAll(/(?:'([^']+)'|(\w+))\s*:\s*P\.(\w+)/g)) {
 const key=m[1]||m[2];const id='page:'+key;
 add({id,kind:'page',label:'/app/'+key,detail:'واجهة مسجلة في PAGES. حارس الصفحة لا يغني عن نطاق السجل والحقول.',sources:['src/web/routes.js','src/core/policy/pages.js'],handler:m[3]});
 edge(id,file('src/core/policy/pages.js'),'سياسة فتح الصفحة','src/web/routes.js');
 for(const p of code.filter(p=>p.startsWith('src/web/views/')&&new RegExp('export\\s+(?:async\\s+)?function\\s+'+m[3]+'\\b').test(read(p))))edge(id,file(p),'دالة العرض',p);
}
for(const t of schema)add({id:'table:'+t.name,kind:'table',label:t.name,detail:'جدول من مخطط SQLite جديد بعد تطبيق الترحيلات؛ لا بيانات شركة.',sources:migrations.filter(p=>new RegExp('\\b'+t.name+'\\b').test(read(p))),columns:t.columns.map(c=>({name:c.name,type:c.type,required:!!c.notnull,primary:!!c.pk}))});
for(const t of schema)for(const fk of t.foreignKeys)edge('table:'+t.name,'table:'+fk.table,`${fk.from} → ${fk.to}`,'مفتاح أجنبي فعلي في مخطط الترحيلات','foreign-key');
for(const p of code) {
 const text=read(p);const refs=new Set();
 for(const m of text.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+["`]?([a-z_][a-z0-9_]*)\b/gi))refs.add(m[1]);
 for(const m of text.matchAll(/\b(?:insert|update)\(\s*['"]([a-z_][a-z0-9_]*)['"]/gi))refs.add(m[1]);
 for(const name of refs)if(nodes.has('table:'+name))edge(file(p),'table:'+name,'إشارة جدولية صريحة؛ تحقق من موضع الاستعمال',p,'text-reference');
}
for(const [role,grants] of Object.entries(ROLE_GRANTS)) {
 const id='role:'+role;add({id,kind:'role',label:ROLE_LABELS[role]?.ar||role,detail:'منح الدور الافتراضية من الكود؛ المنح الحية والعضويات والاستثناءات لا تستنتج منها.',sources:['src/core/rbac/matrix.js'],grants});
 for(const g of grants) {
  const target=nodes.has('table:'+g.resource)?'table:'+g.resource:'permission:'+g.resource;
  if(!nodes.has(target))add({id:target,kind:'permission',label:g.resource,detail:'مورد صلاحية قد يكون حقلاً حساسًا أو قدرة وليس جدولاً.',sources:['src/core/rbac/matrix.js']});
  edge(id,target,g.action+' @ '+g.scope,'src/core/rbac/matrix.js','grant');
 }
}
for(const line of read('docs/KNOWN-ISSUES.md').split('\n').filter(l=>/^\| KI-\d+ \|/.test(l))) {
 const parts=line.split(' | ');const id=parts[0].replace(/^\| /,'');
 add({id:'issue:'+id,kind:'issue',label:id+' · '+parts[1],detail:parts[2],status:parts[4],sources:['docs/KNOWN-ISSUES.md']});
 for(const p of code)if(line.includes(p)||line.includes(p.replace(/^src\//,'')))edge('issue:'+id,file(p),'يشير السجل إلى', 'docs/KNOWN-ISSUES.md','reported');
}
const model=JSON.parse(read('docs/system-graph/model.json'));
for(const n of model.nodes) { for(const p of n.sources||[])read(p);add(n); }
for(const e of model.edges)edge(e[0],e[1],e[2],'docs/system-graph/model.json','reviewed');
for(const e of edges)if(!nodes.has(e.from)||!nodes.has(e.to))throw new Error(`Dangling edge: ${e.from} → ${e.to}`);
const counts={};for(const n of nodes.values())counts[n.kind]=(counts[n.kind]||0)+1;
const graph={version:1,sourceDigest:digest,sourceFiles:sources.length,counts,limitations:['خريطة مصدر ومخطط فارغ، وليست مسحًا لبيانات التشغيل.','روابط الاستيراد والمسارات تستخرج من التصريحات النصية الصريحة؛ التعبيرات الديناميكية غير محلولة. الإشارات الجدولية تحليل نصي قد يشمل تعليقًا أو فرعًا غير مستخدم، وليست تتبعًا تنفيذيًا أو دليل تغطية اختبار.','العلاقات المنطقية المحررة موضحة بوسم مستقل عن المفاتيح الأجنبية.','منح الدور افتراضية؛ لا تثبت صلاحية مستخدم فعلي أو سلامة تطبيق كل حارس.','الشاشات الفرعية الثابتة ضمن عقد المسارات؛ PAGES ليست كل شاشات المنتج.','المالية ملغاة؛ جداولها التاريخية لا تعني وجود شاشة مالية نشطة.'],unresolved,nodes:[...nodes.values()],edges};
mkdirSync(join(root,'docs/system-graph'),{recursive:true});
const json=JSON.stringify(graph,null,2)+'\n';writeFileSync(join(root,output),json);
const embedded=JSON.stringify(graph).replaceAll('<','\\u003c');
writeFileSync(join(root,'docs/system-graph/index.html'),read('docs/system-graph/viewer.html').replace('/* GRAPH_DATA */',embedded));
console.log(JSON.stringify({nodes:graph.nodes.length,edges:edges.length,counts,unresolved:unresolved.length}));
