import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Electron在入口ESM完成后才发ready；把ready保持pending即可复现这类启动循环。
test("Electron ESM入口在ready尚未触发时也能完成模块求值", () => {
  const dir = mkdtempSync(join(tmpdir(), "proactive-entry-"));
  try {
    const outfile = join(dir, "entry.mjs");
    buildSync({
      entryPoints: ["src/desktop/main.ts"],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
    });
    const result = spawnSync(
      "node",
      [
        "--experimental-vm-modules",
        "--input-type=module",
        "-e",
        `
      import {SourceTextModule,SyntheticModule} from 'node:vm';
      import {readFileSync} from 'node:fs';
      const app={setName(){},setPath(){},getPath(){return '/private/tmp/proactive-mock';},on(){},whenReady(){return new Promise(()=>{});}};
      const entry=new SourceTextModule(readFileSync(${JSON.stringify(outfile)},'utf8'));
      await entry.link(async name=>{
        const exports=name==='electron'?{app,BrowserWindow:class{},ipcMain:{},dialog:{}}:await import(name);
        return new SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value);});
      });
      await Promise.race([entry.evaluate(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('entry_waits_for_ready')),500))]);
      console.log('entry_settled_before_ready');
    `,
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 10000 },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("entry_settled_before_ready");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
