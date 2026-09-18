import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "mf-duration-"));
let failed = 0;
const check = (n, c, d) => { if (c) console.log("ok   " + n); else { failed++; console.error("FAIL " + n + (d ? " :: " + d : "")); } };
try {
  execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), join(root, "src", "lib", "duration.ts"), "--outDir", out, "--module", "esnext", "--target", "es2019", "--skipLibCheck"], { stdio: "inherit", cwd: root });
  const { formatDuration } = await import(pathToFileURL(join(out, "duration.js")).href);
  check("分秒：483 → 8:03", formatDuration(483) === "8:03", formatDuration(483));
  check("小时段：7200 → 2:00:00", formatDuration(7200) === "2:00:00", formatDuration(7200));
  check("小时+分秒：3907 → 1:05:07", formatDuration(3907) === "1:05:07", formatDuration(3907));
  check("不足一分钟补零：7 → 0:07", formatDuration(7) === "0:07", formatDuration(7));
  check("空值/零/负数返回空串（显示交调用方）", formatDuration(0) === "" && formatDuration(undefined) === "" && formatDuration(-3) === "");
} finally { rmSync(out, { recursive: true, force: true }); }
if (failed) { console.error("\n" + failed + " 项失败"); process.exit(1); }
console.log("\n时长展示口径：全部通过");
