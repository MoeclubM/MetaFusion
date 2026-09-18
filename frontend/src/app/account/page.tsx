import { Account } from "@/components/catalog/CatalogPages";
import { Navbar } from "@/components/Navbar";
import { PageShell } from "@/components/ui/PageShell";

// 登录入口唯一：/login。本页是受保护页面（components/AuthGate.tsx 的 PROTECTED_PREFIXES）：
// 未登录访问会被重定向到 /login?redirect=/account，不要在 Account 里再实现用户名/密码表单，
// 也不要在标题里再分叉出"初始化"形态——实例未初始化时 AuthGate 会先引导 /setup。
export default function Page() {
  return (
    <>
      <Navbar />
      {/* CatalogProvider 已在 app/layout.tsx 全站挂载，这里不再重复挂。 */}
      {/* 容器宽度与内边距走 PageShell；本页是表单/资料类页面，用 narrow 档（与 /settings 同宽）。 */}
      <PageShell width="narrow">
        <Account />
      </PageShell>
    </>
  );
}
