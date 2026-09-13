import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
test("理解并发有上限、乱序完成按序投递，主 Agent 忙时继续理解但不重叠投递", async () => {
  const root = await mkdtemp(join(tmpdir(), "queue-batch-"));
  try {
    const script = join(root, "test.mjs");
    await writeFile(
      script,
      `
import assert from 'node:assert/strict';
import {ActionQueue} from ${JSON.stringify(new URL("../src/model/queue.ts", import.meta.url).href)};
let enabled=false,active=0,peak=0,delivering=0,maxDelivery=0;const batches=[],completed=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const q=new ActionQueue(':memory:',{concurrency:()=>3,read:async id=>({id,evidence:[]}),canUnderstand:()=>enabled,canDeliver:()=>enabled,change:()=>{},understand:async item=>{active++;peak=Math.max(peak,active);await pause(item.id==='a'?60:5);active--;completed.push(item.id);return {result:{action_title:item.id,action_detail:'fixture'}};},deliver:async()=>{throw Error('must_batch')},deliverBatch:async rows=>{delivering++;maxDelivery=Math.max(maxDelivery,delivering);batches.push(rows.map(r=>r.actionId));await pause(40);delivering--;}});
for(const id of ['a','b','c','d','e'])q.reserve(id);
for(const id of ['e','d','c','b'])q.enqueue(id);
enabled=true;await q.drain();assert.equal(batches.length,0,'前序仍在采集不能越过');
enabled=false;q.enqueue('a');enabled=true;await q.drain();
assert.equal(peak,3);assert.equal(maxDelivery,1);assert.notEqual(completed[0],'a');assert.deepEqual(batches.flat(),['a','b','c','d','e']);assert(q.list().every(row=>row.status==='delivered'));assert.equal(q.list()[0].actionTitle,'a');await q.close();console.log('PASS');
`,
    );
    const result = spawnSync(
      "node",
      ["--experimental-transform-types", script],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
