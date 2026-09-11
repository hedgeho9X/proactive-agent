/** 验证应用背景通过真实 SQLite 队列恢复和投递，不依赖当前知识表。 */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("ready 队列重启后仍投递理解当时的 app_info", () => {
  const queue = new URL("../src/model/queue.ts", import.meta.url).href;
  const registry = new URL("../src/model/app-info.ts", import.meta.url).href;
  const result = spawnSync(
    "node",
    [
      "--experimental-transform-types",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import {mkdtemp,rm} from 'node:fs/promises';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    import {ActionQueue} from ${JSON.stringify(queue)};
    import {resolveAppInfo,appInfoMap} from ${JSON.stringify(registry)};
    const root=await mkdtemp(join(tmpdir(),'app-info-queue-'));
    try {
      const path=join(root,'queue.sqlite');
      const info=resolveAppInfo({bundle_id:'dev.zed.Zed',name:'Zed'});
      let enabled=false;
      const handlers={read:id=>({id,evidence:[]}),canUnderstand:()=>enabled,canDeliver:()=>false,change:()=>{},understand:async()=>({result:{action_title:'测试',action_detail:'测试描述'},app_info:info}),deliver:async()=>{}};
      let queue=new ActionQueue(path,handlers);
      queue.enqueue('action-test');
      enabled=true;
      await queue.drain();
      assert.equal(queue.list()[0].status,'ready');
      await queue.close();
      appInfoMap['dev.zed.Zed'].purpose='新的应用用途';
      let delivered;
      queue=new ActionQueue(path,{...handlers,canDeliver:()=>true,deliverBatch:async rows=>{delivered=rows[0].result.app_info}});
      await queue.drain();
      assert.deepEqual(delivered,info);
      assert.notEqual(delivered.definition.purpose,appInfoMap['dev.zed.Zed'].purpose);
      assert.equal(queue.list()[0].status,'delivered');
      await queue.close();
    } finally {await rm(root,{recursive:true,force:true});}
  `,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.status, result.stderr).toBe(0);
});
