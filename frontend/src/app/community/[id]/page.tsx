"use client";

import React, { useEffect } from "react";
import { FORUM_SERVICE_URL } from "@/lib/services";

// 本仓库后端不提供主题详情端点（讨论按实体聚合，不建独立主题模型）。
// 外部论坛已配置时跳转论坛首页；否则回落到站内社区讨论流，避免死胡同。
const FORUM_IS_EXTERNAL = FORUM_SERVICE_URL.startsWith("http");

export default function TopicDetailPage() {
  useEffect(() => {
    window.location.replace(FORUM_IS_EXTERNAL ? FORUM_SERVICE_URL : "/community");
  }, []);

  return (
    <div className="min-h-screen bg-background grid place-items-center text-xs font-mono text-gray-500">
      Loading...
    </div>
  );
}
