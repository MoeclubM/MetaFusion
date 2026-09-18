// 校验时间戳展示口径统一为 ISO 8601（审计 2026-09-19 第 16 条：
// 用户页修订时间是 2026/9/17 01:32:13 这种斜杠写法，全站其余位置是 ISO）。
// 用法：node frontend/scripts/check-datetime-format.mjs（用仓内钉住的 typescript 编译后断言）
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "mf-datetime-"));
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) console.log("ok   " + name);
  else { failed += 1; console.error("FAIL " + name + (detail ? " :: " + detail : "")); }
};

try {
  execFileSync(process.execPath, [
    join(root, "node_modules", "typescript", "bin", "tsc"), join(root, "src", "lib", "datetime.ts"),
    "--outDir", out, "--module", "esnext", "--target", "es2019", "--skipLibCheck",
  ], { stdio: "inherit", cwd: root });
  const { isoDate, isoTimestamp, localDateTime } = await import(pathToFileURL(join(out, "datetime.js")).href);
  const at = "2026-09-17T01:32:13Z";
  check("时间戳按 ISO 8601 秒精度展示", isoTimestamp(at) === "2026-09-17T01:32:13Z", isoTimestamp(at));
  check("日期按 ISO 日期展示（补零）", isoDate(at) === "2026-09-17", isoDate(at));
  check("正文不再出现斜杠写法", !isoTimestamp(at).includes("/") && !isoDate(at).includes("/"));
  check("本地化写法仍可读（只进 title）", typeof localDateTime(at, "zh-CN") === "string" && localDateTime(at, "zh-CN").length > 0);
  check("无效值返回空串而不抛错",
    isoTimestamp("") === "" && isoTimestamp("not-a-date") === "" && isoDate(null) === "" && localDateTime(undefined, "zh-CN") === "");
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) { console.error("\n" + failed + " 项失败"); process.exit(1); }
console.log("\n时间戳展示口径统一为 ISO 8601：全部通过");
