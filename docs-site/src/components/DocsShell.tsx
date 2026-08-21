"use client";
import { useState } from "react";
import { DocsHeader } from "./DocsHeader";
import { DocsSidebar } from "./DocsSidebar";
import type { NavGroup } from "@/lib/docs";

export function DocsShell({ groups, children }: { groups: NavGroup[]; children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <DocsHeader onMenu={() => setDrawer(true)} />
      <div className="flex-1 max-w-[1440px] w-full mx-auto flex">
        <aside className="hidden lg:block w-[280px] shrink-0 border-r border-black/5 dark:border-white/[0.06] sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden bg-white/60 dark:bg-white/[0.02] backdrop-blur">
          <DocsSidebar groups={groups} />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-[300px] max-w-[85vw] bg-white dark:bg-[#0f1117] border-r border-black/10 dark:border-white/10 overflow-y-auto shadow-xl">
              <DocsSidebar groups={groups} onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        )}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
