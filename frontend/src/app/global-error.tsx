"use client";

import React from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="font-sans min-h-screen bg-[#0a0c10] text-gray-100 flex flex-col items-center justify-center p-6 antialiased">
        <div className="max-w-md w-full text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center text-2xl font-bold mb-6">
            !
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">系统发生致命错误</h1>
          <p className="text-sm text-gray-400 mb-6">
            根布局初始化失败，请尝试刷新页面。
          </p>
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            重新加载
          </button>
        </div>
      </body>
    </html>
  );
}
