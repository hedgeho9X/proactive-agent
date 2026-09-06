import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// node:sqlite 在真正的 Node worker 验证，Bun 只负责测试驱动。
test("Node SQLite evidence, retention, grouping and protected context", () => {
  const dir = mkdtempSync(join(tmpdir(), "proactive-evidence-"));
  const storeURL = new URL("../src/observation/store.ts", import.meta.url).href;
  const filterURL = new URL("../src/observation/filter.ts", import.meta.url)
    .href;
  const worker = join(dir, "worker.mjs");
  writeFileSync(
    worker,
    `import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {writeFileSync,chmodSync} from 'node:fs';
import {NativeCollectorHost} from ${JSON.stringify(new URL("../src/observation/native-host.ts", import.meta.url).href)};
import { EvidenceStore } from ${JSON.stringify(storeURL)};
import { filterAX } from ${JSON.stringify(filterURL)};
const store = new EvidenceStore(${JSON.stringify(join(dir, "evidence.sqlite"))},{evidenceTTL:1000,metadataTTL:10000,maxBytes:10000,burstMs:500});
const action=(id,seq,time,kind='key_down')=>({schema_version:'1',action_id:id,capture_session_id:'test',collector_epoch:'test',source_sequence:String(seq),occurred_at:new Date(time).toISOString(),received_at:new Date(time).toISOString(),monotonic_ns:String(seq),timezone:'UTC',kind,actor:'human',origin:'fixture',trust_class:'untrusted_observation',policy_status:'allowed',reason_codes:[],input:{key_category:'ordinary'}});
store.recordAction(action('a',1,1000)); store.recordAction(action('b',2,1100,'key_up'));
assert.equal(store.listActivities().length,1);
const png = new Uint8Array([137,80,78,71]);
const image = store.putArtifact('a',{kind:'screenshot',status:'captured',capturedAt:new Date(1000).toISOString(),bytes:png});
store.putArtifact('a',{kind:'ax',status:'captured',capturedAt:new Date(1000).toISOString(),payload:{nodes:[{node_id:'x',parent_id:null}]}});
store.putArtifact('a',{kind:'ocr',status:'captured',capturedAt:new Date(1000).toISOString(),payload:{text:'fixture'},screenshotArtifactId:image});
store.putArtifact('a',{kind:'screenshot',slot:'screenshot_before',status:'captured',capturedAt:new Date(900).toISOString(),bytes:new Uint8Array([1,2,3])});
assert.equal(store.getObservation('a').evidence.filter(e=>e.kind==='screenshot').length,2);
assert.equal(store.getObservation('a').evidence.find(e=>e.slot==='screenshot').artifact_id,image);
assert.deepEqual(Buffer.from(store.getArtifact(image).bytes,'base64'),Buffer.from(png));
assert.throws(()=>store.putArtifact('b',{kind:'ocr',status:'captured',capturedAt:new Date(1000).toISOString(),payload:{text:'wrong'},screenshotArtifactId:image}));
store.putArtifact('b',{kind:'screenshot',status:'captured',capturedAt:new Date(1800).toISOString(),bytes:png});
assert.equal(store.getObservation('b').evidence.find(e=>e.kind==='screenshot').status,'shared');
store.prune(2200); assert.ok(store.getArtifact(image));
assert.equal(store.getObservation('a').evidence.find(e=>e.slot==='screenshot').status,'expired');
assert.equal(store.getObservation('b').evidence.find(e=>e.slot==='screenshot').status,'shared');
store.pin(image,'fixture'); store.prune(4000); assert.ok(store.getArtifact(image));
store.unpin(image,'fixture'); store.prune(4000); assert.equal(store.getArtifact(image),null);
assert.equal(store.getObservation('a').evidence.find(e=>e.kind==='screenshot').status,'expired');
const filtered=filterAX([{node_id:'child',parent_id:'secure',value:'secret'},{node_id:'target',parent_id:'root',role:'AXButton',clicked:true},{node_id:'root',parent_id:null},{node_id:'secure',parent_id:null,protected:true}]);
assert.equal(filtered.normalized.find(n=>n.node_id==='child').value,undefined);
assert.ok(filtered.context.some(n=>n.node_id==='target')); assert.ok(filtered.context.some(n=>n.node_id==='root'));
store.close();
const legacy = new DatabaseSync(${JSON.stringify(join(dir, "evidence.sqlite"))});
legacy.exec("ALTER TABLE evidence RENAME TO evidence_v2; CREATE TABLE evidence AS SELECT action_id,kind,status,artifact_id,original_artifact_id,reason,delta_ms FROM evidence_v2 WHERE slot!='screenshot_before'; DROP TABLE evidence_v2; PRAGMA user_version=1;"); legacy.close();
const reopened=new EvidenceStore(${JSON.stringify(join(dir, "evidence.sqlite"))});
assert.equal(reopened.getObservation('a').evidence.find(e=>e.slot==='screenshot').status,'expired'); reopened.close();
const mockPath=${JSON.stringify(join(dir, "mock-collector"))};
writeFileSync(mockPath, '#!/usr/bin/env node\\n'+${JSON.stringify("import {createInterface} from 'node:readline'; createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line); if(request.command==='shutdown'){setTimeout(()=>process.exit(0),30);return;} setTimeout(()=>{console.log(JSON.stringify(request.command==='permissions'?{type:'permissions',permissions:{accessibility:true}}:{type:'status',state:'running'}));console.log(JSON.stringify({type:'ack',request_id:request.request_id}));},50);});")}); chmodSync(mockPath,0o755);
const hostStore=new EvidenceStore(':memory:'); const host=new NativeCollectorHost({binaryPath:mockPath,store:hostStore});
assert.equal(host.status().state,'stopped'); assert.equal((await host.checkPermissions()).permissions.accessibility,true);
assert.equal((await host.start({allowedBundleIds:['fixture.only']})).state,'running');
await assert.rejects(host.start({allowedBundleIds:[]}),/explicit_allowlist_required/);
await assert.rejects(host.requestPermission('invalid'),/invalid_permission/);
assert.equal((await host.start({allowedBundleIds:[],allApps:true})).state,'running');
const stopping=host.stop(); assert.equal(host.status().state,'stopping'); await stopping; assert.equal(host.status().state,'stopped'); hostStore.close();
console.log('PASS');`,
  );
  try {
    const result = spawnSync("node", ["--experimental-strip-types", worker], {
      encoding: "utf8",
    });
    expect(result.stderr + result.stdout).toContain("PASS");
    expect(result.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
