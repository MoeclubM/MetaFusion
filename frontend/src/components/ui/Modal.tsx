"use client";
import React from "react";
import { X } from "lucide-react";

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  maxWidth = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`w-full ${maxWidth} rounded-lg border border-surfaceBorder bg-surface p-4 sm:p-5 space-y-4 shadow-elevated max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between border-b border-surfaceBorder/60 pb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            {icon}
            {title}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 dark:hover:text-white p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
