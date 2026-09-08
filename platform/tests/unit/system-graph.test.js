import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROLE_GRANTS } from '../../src/core/rbac/matrix.js';
const graph=JSON.parse(readFileSync(new URL('../../docs/system-graph/graph.json',import.meta.url),'utf8'));
const byId=new Map(graph.nodes.map(n=>[n.id,n]));
test('graph contains source-backed journeys, schema and all canonical roles without dangling edges',()=>{
 assert.equal(byId.size,graph.nodes.length);
 for(const e of graph.edges){assert.ok(byId.has(e.from),e.from);assert.ok(byId.has(e.to),e.to);assert.ok(e.evidence);}
 for(const role of Object.keys(ROLE_GRANTS))assert.deepEqual(byId.get('role:'+role).grants,ROLE_GRANTS[role]);
 for(const name of ['employee','task','project','opportunity','deliverable','revenue_line','allocation','approval_request'])assert.ok(byId.get('table:'+name)?.columns.length);
 assert.ok(graph.edges.some(e=>e.from==='table:allocation'&&e.to==='table:employee'&&e.kind==='foreign-key'));
 assert.ok(graph.edges.some(e=>e.from==='file:src/modules/finance/finance.js'&&e.to==='table:opportunity'&&e.kind==='text-reference'));
});
test('graph distinguishes commercial year, revenue period and capacity, and does not claim external MCP exists',()=>{
 for(const id of ['metric:sale','metric:period','metric:capacity','metric:load'])assert.ok(byId.has(id));
 assert.equal(byId.get('tool:mcp').status,'غير منفذ خارجيًا');
 assert.ok(!byId.has('page:finance'));
 assert.ok(byId.has('table:invoice'),'retired screen does not remove history');
 assert.ok(graph.limitations.some(s=>s.includes('ليست مسحًا')));
});
test('standalone viewer carries the same graph safely embedded without external scripts',()=>{
 const html=readFileSync(new URL('../../docs/system-graph/index.html',import.meta.url),'utf8');
 const embedded=html.match(/const DATA=(.*);\nconst kinds=/)?.[1];
 assert.ok(embedded);
 assert.deepEqual(JSON.parse(embedded),graph);
 assert.ok(!/<script[^>]+src=/i.test(html));
 assert.ok(!embedded.includes('<'));
});
