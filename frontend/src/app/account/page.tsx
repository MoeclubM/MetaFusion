import { Account } from "@/components/catalog/CatalogPages";
import { CatalogProvider } from "@/components/catalog/CatalogProvider";
import { Navbar } from "@/components/Navbar";
import { PageShell } from "@/components/ui/PageShell";
import "../catalog/catalog.css";

// 登录入口唯一：/login。本页是受保护页面（components/AuthGate.tsx 的 PROTECTED_PREFIXES）：
// 未登录访问会被重定向到 /login?redirect=/account，不要在 Account 里再实现用户名/密码表单，
// 也不要在标题里再分叉出"初始化"形态——实例未初始化时 AuthGate 会先引导 /setup。
export default function Page() {
  return (
    <>
      <Navbar />
      <CatalogProvider>
        {/* 容器宽度与内边距走 PageShell；cv-* 表单/表格/徽标样式的作用域仍是 .catalog-root。 */}
        <PageShell width="page" spacing="none">
          <div className="catalog-root">
            <Account />
          </div>
        </PageShell>
      </CatalogProvider>
    </>
  );
}
