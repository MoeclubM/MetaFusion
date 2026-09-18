// 校验程序封面的身份串与引用码与界面语言无关（2026-09-19 审计第 14 条：
// 同一作品 zh-CN 显示 MF-6A5580、en-US 显示 MF-5AEDB1、ja-JP 显示 MF-1F8D5E）。
//
// 用法（在 frontend/ 或仓库根目录皆可）：node frontend/scripts/check-cover-identity.mjs
// 它用**仓内钉住的** typescript（node_modules/typescript/bin/tsc）把
// src/lib/coverIdentity.ts 编译到临时目录后直接断言，不依赖 Next 运行时。
// 失败以非零码退出。
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
const out = mkdtempSync(join(tmpdir(), "mf-cover-identity-"));
let failed = 0;
const check = (name, cond, detail) => {
  if (cond) {
    console.log("ok   " + name);
  } else {
    failed += 1;
    console.error("FAIL " + name + (detail ? " :: " + detail : ""));
  }
};

try {
  // stdio: inherit —— 沙箱里捕获子进程管道输出会失败，这里也不需要它的输出。
  execFileSync(process.execPath, [
    tsc, join(root, "src", "lib", "coverIdentity.ts"),
    "--outDir", out, "--module", "esnext", "--target", "es2019", "--skipLibCheck",
  ], { stdio: "inherit", cwd: root });
  const { coverIdentity, coverHash, coverRefCode } = await import(pathToFileURL(join(out, "coverIdentity.js")).href);
  const refOf = (input) => coverRefCode(coverHash(coverIdentity(input)));
  const id = "01a0aafa-a044-74d5-9e69-e9d5b3262f0b";

  const zh = refOf({ id, title: "美国恐怖故事：天启" });
  const en = refOf({ id, title: "American Horror Story: Apocalypse" });
  const ja = refOf({ id, title: "アメリカン・ホラー・ストーリー: アポカリプス" });
  check("同一实体三种界面语言得到同一个 REF 码", zh === en && en === ja, [zh, en, ja].join(" / "));
  check("REF 码形如 MF-XXXXXX", /^MF-[0-9A-F]{6}$/.test(zh), zh);
  check("身份串在有 id 时不包含展示题名", !coverIdentity({ id, title: "美国恐怖故事：天启" }).includes("美国恐怖故事"));
  check("不同实体的 REF 码不同",
    refOf({ id: "01a0aafa-a044-74d5-9e69-e9d5b3262f0b" }) !== refOf({ id: "01a0a816-7592-7157-9839-b741b6269329" }));
  // 无 id 的临时封面：退到原语言题名，同样不随界面语言变化。
  const noIdZh = refOf({ originalTitle: "Original Title", title: "中文题名" });
  const noIdJa = refOf({ originalTitle: "Original Title", title: "日本語題名" });
  check("无 id 时用原语言题名作身份（不随界面语言变化）", noIdZh === noIdJa, noIdZh + " / " + noIdJa);
  check("既无 id 也无原语言题名时才用展示题名（画面仍可渲染）",
    coverIdentity({ title: "只有展示题名" }) === "title:只有展示题名");
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed > 0) {
  console.error("\n" + failed + " 项失败");
  process.exit(1);
}
console.log("\n程序封面身份/引用码与界面语言无关：全部通过");
