import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("队列等待配置，策略改变或源记录删除时不投递，已理解结果不重复调用", async () => {
  const dir = await mkdtemp(join(tmpdir(), "queue-routing-"));
  try {
    const worker = join(dir, "worker.mjs");
    await writeFile(
      worker,
      `
import assert from 'node:assert/strict';
import {ActionQueue} from ${JSON.stringify(new URL("../src/model/queue.ts", import.meta.url).href)};
let enabled=false,allowed=true,understood=0,delivered=0;
const q=new ActionQueue(':memory:',{read:async()=>({evidence:[]}),canUnderstand:()=>enabled,canDeliver:()=>enabled,filter:async()=>allowed?undefined:'trigger_not_selected',understand:async()=>{understood++;allowed=false;return {result:{statement:'fixture'}}},deliver:async()=>{delivered++},change:()=>{}});
q.enqueue('ax-event');await q.drain();assert.equal(understood,0);enabled=true;await q.drain();assert.equal(understood,1);assert.equal(delivered,0);assert.equal(q.list()[0].status,'filtered');await q.drain();assert.equal(understood,1);await q.close();
enabled=false;const deleted=new ActionQueue(':memory:',{read:async()=>{throw new Error('should_not_read_deleted')},canUnderstand:()=>enabled,canDeliver:()=>enabled,filter:async()=> 'record_missing',understand:async()=>{understood++},deliver:async()=>{delivered++},change:()=>{}});deleted.enqueue('deleted-source');enabled=true;await deleted.drain();assert.equal(deleted.list()[0].reason,'record_missing');assert.equal(understood,1);assert.equal(delivered,0);await deleted.close();console.log('PASS');
`,
    );
    const result = spawnSync(
      "node",
      ["--experimental-transform-types", worker],
      {
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("PASS");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
