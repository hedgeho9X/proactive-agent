import { spawn } from "node:child_process";
import { evidenceAnnotations } from "./annotations.ts";
export async function prepareEvidence(
  binary: string,
  screenshot: any,
  trigger: any,
) {
  if (!screenshot?.data || screenshot.status === "excluded")
    throw new Error("screenshot_unavailable");
  return new Promise<any>((resolve, reject) => {
    const child = spawn(binary, ["--prepare-evidence"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 24 * 1024 * 1024) child.kill("SIGTERM");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const value = JSON.parse(output);
        if (code !== 0 || value.error || !value.data)
          throw new Error("evidence_prepare_failed");
        resolve(value);
      } catch {
        reject(new Error("evidence_prepare_failed"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(
      JSON.stringify({
        data: screenshot.data,
        ...evidenceAnnotations(screenshot, trigger),
      }) + "\n",
    );
  });
}
