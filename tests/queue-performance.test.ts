import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";

test("大型旧结果只投影一次，列表不读库，状态与重启后摘要保持一致", () => {
  const source = new URL("../src/model/queue.ts", import.meta.url).href;
  const result = spawnSync(
    "node",
    [
      "--experimental-transform-types",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import {DatabaseSync} from 'node:sqlite';
    import {mkdtemp,rm} from 'node:fs/promises';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    import {ActionQueue} from ${JSON.stringify(source)};
    const root=await mkdtemp(join(tmpdir(),'queue-performance-'));
    try {
      const file=join(root,'queue.sqlite');
      let enabled=false;
      const handlers={read:id=>({action:{action_id:id},evidence:[]}),canUnderstand:()=>enabled,canDeliver:()=>enabled,change:()=>{},understand:async()=>({result:{action_title:'新标题',action_detail:'新描述'},debug:{imageFile:'fixture.png'},large:'x'.repeat(1024*1024)}),deliver:async()=>{}};
      let queue=new ActionQueue(file,handlers);
      await queue.close();
      const db=new DatabaseSync(file);
      const insert=db.prepare('INSERT INTO queue(actionId,status,result,createdAt) VALUES(?,?,?,?)');
      const payload=JSON.stringify({result:{action_title:'旧标题',action_detail:'旧描述'},debug:{imageFile:'old.png'},large:'x'.repeat(512*1024)});
      db.exec('BEGIN');
      for(let i=0;i<80;i++) insert.run('old-'+i,'delivered',payload,Date.now());
      db.exec('COMMIT');
      db.close();
      queue=new ActionQueue(file,handlers);
      const initial=queue.list();
      assert.equal(initial.length,80);
      assert.equal(initial[0].actionTitle,'旧标题');
      assert.equal(initial[0].inputImageFile,'old.png');
      // 列表必须完全绕开 SQLite，不只是隐藏了返回值里的原始正文。
      const prepare=DatabaseSync.prototype.prepare;
      DatabaseSync.prototype.prepare=function(){throw Error('list_must_not_query_database')};
      try {for(let i=0;i<100;i++) assert.equal(queue.list(),initial);} finally {DatabaseSync.prototype.prepare=prepare;}
      queue.enqueue('new');
      queue.enqueue('new');
      assert.equal(queue.list().length,81);
      enabled=true;
      await queue.drain();
      const row=queue.list().at(-1);
      assert.equal(row.status,'delivered');
      assert.equal(row.attempts,1);
      assert.equal(row.actionTitle,'新标题');
      assert.equal(queue.result('new').large.length,1024*1024);
      assert.equal(initial.length,80);
      await queue.close();
      queue=new ActionQueue(file,handlers);
      assert.deepEqual({...queue.list().at(-1)},{...row});
      await queue.close();
      console.log('PASS');
    } finally { await rm(root,{recursive:true,force:true}); }
  `,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
});
