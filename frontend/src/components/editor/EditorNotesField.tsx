"use client";

import React from "react";
import { useI18n } from "@/i18n/I18nProvider";

interface Props {
  editNote: string;
  setEditNote: (val: string) => void;
  sourceUrlsStr: string;
  setSourceUrlsStr: (val: string) => void;
  mode: "create" | "edit";
}

export function EditorNotesField({
  editNote,
  setEditNote,
  sourceUrlsStr,
  setSourceUrlsStr,
  mode,
}: Props) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="block text-xs sm:text-sm font-mono text-gray-300">
          {t("editor.notes.editNoteLabel")} <span className="text-amber-400">*</span>
        </label>
        <textarea
          rows={3}
          required={mode === "edit"}
          value={editNote}
          onChange={(e) => setEditNote(e.target.value)}
          placeholder={t("editor.notes.editNotePlaceholder")}
          className="w-full p-3.5 rounded-lg bg-background border border-white/10 text-white text-sm leading-relaxed resize-none focus:outline-none focus:border-amber-400"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs sm:text-sm font-mono text-gray-300">
          {t("editor.notes.sourcesLabel")}
        </label>
        <textarea
          rows={3}
          value={sourceUrlsStr}
          onChange={(e) => setSourceUrlsStr(e.target.value)}
          placeholder={t("editor.notes.sourcesPlaceholder")}
          className="w-full p-3.5 rounded-lg bg-background border border-white/10 text-white font-mono text-sm leading-relaxed resize-none focus:outline-none focus:border-amber-400"
        />
      </div>
    </div>
  );
}
