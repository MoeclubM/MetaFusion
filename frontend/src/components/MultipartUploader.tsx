"use client";

import React, { useState, useEffect } from "react";
import { fetchApi, Artist } from "@/lib/api";
import { X, UploadCloud, FileText, Loader2, AlertCircle, Check, ShieldCheck, Hash, Fingerprint } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

interface MultipartUploaderProps {
  isOpen: boolean;
  onClose: () => void;
  workId?: string;
  onUploadSuccess?: () => void;
}

const CHUNK_SIZE = 50 * 1024 * 1024;

export const MultipartUploader: React.FC<MultipartUploaderProps> = ({ isOpen, onClose, workId, onUploadSuccess }) => {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  // Keep initial Chinese string as canonical default edition name
  const [editionName, setEditionName] = useState(t("uploader.defaultEdition"));
  const [publisher, setPublisher] = useState("");
  const [publisherId, setPublisherId] = useState<string | null>(null);
  const [publishersList, setPublishersList] = useState<Artist[]>([]);
  const [catalogNumber, setCatalogNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [statusText, setStatusText] = useState("");
  const [progress, setProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isInstant, setIsInstant] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchApi<{ items: Artist[] }>("/catalog/artists?page_size=50")
        .then((res) => {
          const orgs = (res.items || []).filter((a) => a.entity_type !== "person");
          setPublishersList(orgs);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const calculateSha256 = async (f: File): Promise<string> => {
    setStatusText(t("uploader.calcHash"));
    const buffer = await f.slice(0, Math.min(f.size, 100 * 1024 * 1024)).arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const handleStartUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !workId) {
      setError(t("uploader.fileRequired"));
      return;
    }
    setError(null);
    setIsUploading(true);
    setProgress(0);
    setIsInstant(false);
    try {
      setStatusText(t("uploader.createRelease"));
      const release = await fetchApi<{ id: string }>("/catalog/releases", {
        method: "POST",
        body: JSON.stringify({
          work_id: workId,
          publisher_id: publisherId || undefined,
          edition_name: editionName.trim(),
          publisher: publisher.trim(),
          catalog_number: catalogNumber.trim(),
          notes: notes.trim(),
        }),
      });
      const sha256 = await calculateSha256(file);
      const partCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      setStatusText(t("uploader.negotiate"));
      const initRes = await fetchApi<{
        is_instant_upload: boolean;
        asset_id: string;
        upload_id?: string;
        s3_key?: string;
        presigned_urls?: string[];
      }>("/storage/upload/initiate", {
        method: "POST",
        body: JSON.stringify({
          release_id: release.id,
          file_name: file.name,
          file_size: file.size,
          sha256_hash: sha256,
          mime_type: file.type || "application/octet-stream",
          part_count: partCount,
        }),
      });
      if (initRes.is_instant_upload) {
        setIsInstant(true);
        setProgress(100);
        setStatusText(t("uploader.instantDone"));
        setTimeout(() => {
          onUploadSuccess?.();
          onClose();
        }, 1500);
        return;
      }
      const presignedUrls = initRes.presigned_urls || [];
      const parts: { PartNumber: number; ETag: string }[] = [];
      for (let i = 0; i < partCount; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunk = file.slice(start, end);
        setStatusText(t("uploader.chunkProgress", { current: i + 1, total: partCount, size: Math.round((end - start) / (1024 * 1024)) }));
        const uploadRes = await fetch(presignedUrls[i], { method: "PUT", body: chunk, headers: { "Content-Type": file.type || "application/octet-stream" } });
        if (!uploadRes.ok) throw new Error(t("uploader.chunkFailed", { index: i + 1, status: uploadRes.status }));
        const etag = uploadRes.headers.get("ETag") || `"${i + 1}"`;
        parts.push({ PartNumber: i + 1, ETag: etag.replaceAll('"', "") });
        setProgress(Math.round(((i + 1) / partCount) * 100));
      }
      setStatusText(t("uploader.merge"));
      await fetchApi("/storage/upload/complete", {
        method: "POST",
        body: JSON.stringify({ asset_id: initRes.asset_id, upload_id: initRes.upload_id, s3_key: initRes.s3_key, parts }),
      });
      setStatusText(t("uploader.done"));
      setTimeout(() => {
        onUploadSuccess?.();
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err.message || t("auth.requestFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm p-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-lg rounded-lg border border-black/10 dark:border-white/[0.08] bg-surface shadow-elevated overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-black/5 dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 grid place-items-center rounded-md bg-amber-500/10 border border-amber-500/20">
              <UploadCloud className="w-3.5 h-3.5 text-amber-500" strokeWidth={1.5} />
            </span>
            <div>
              <h2 className="font-display text-sm font-bold leading-none tracking-tight text-gray-900 dark:text-white">{t("uploader.title")}</h2>
              <p className="font-mono text-[10px] tracking-wide text-gray-500 mt-0.5">{t("uploader.subtitle")}</p>
            </div>
          </div>
          <button onClick={onClose} disabled={isUploading} className="w-7 h-7 grid place-items-center rounded-md bg-black/5 dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
            <X className="w-3.5 h-3.5" strokeWidth={1.6} />
          </button>
        </div>

        {error && (
          <div className="mx-4 sm:mx-5 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-300 font-mono text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleStartUpload} className="p-4 sm:p-5 space-y-3 text-xs">
          <div className="rounded-md border border-dashed border-black/15 dark:border-white/10 hover:border-primary/40 bg-black/[0.02] dark:bg-white/[0.02] p-3.5 text-center transition-colors">
            <input type="file" id="file-upload" disabled={isUploading} onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} className="hidden" />
            <label htmlFor="file-upload" className="cursor-pointer block">
              {file ? (
                <span className="inline-flex items-center gap-2 text-gray-900 dark:text-white">
                  <FileText className="w-4 h-4 text-gray-400" strokeWidth={1.5} />
                  <span className="font-medium truncate max-w-[220px]">{file.name}</span>
                  <span className="font-mono text-gray-500">({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                </span>
              ) : (
                <span className="space-y-1 py-1 block">
                  <UploadCloud className="w-5 h-5 text-gray-400 mx-auto" strokeWidth={1.4} />
                  <p className="font-medium text-gray-700 dark:text-gray-300 text-xs">{t("uploader.pickFile")}</p>
                  <p className="font-mono text-[10px] text-gray-500">{t("uploader.fileTypes")}</p>
                </span>
              )}
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("uploader.editionName")}</label>
              <input type="text" required disabled={isUploading} value={editionName} onChange={(e) => setEditionName(e.target.value)} className="w-full px-2.5 h-10 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary" />
            </div>
            <div className="space-y-1">
              <label className="font-mono text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("uploader.catalogNo")}</label>
              <input type="text" disabled={isUploading} placeholder={t("uploader.catalogPlaceholder")} value={catalogNumber} onChange={(e) => setCatalogNumber(e.target.value)} className="w-full px-2.5 h-10 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary" />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("uploader.publisherLabel")}</label>
              {publishersList.length > 0 && <span className="font-mono text-[10px] text-gray-500">{t("uploader.publisherHint")}</span>}
            </div>
            {publishersList.length > 0 && (
              <select disabled={isUploading} value={publisherId || ""} onChange={(e) => { const val = e.target.value; if (val === "") setPublisherId(null); else { setPublisherId(val); const found = publishersList.find((p) => p.id === val); if (found) setPublisher(found.name); }}} className="w-full px-2.5 h-10 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white text-xs focus:outline-none focus:border-primary">
                <option value="">{t("uploader.publisherSelectPlaceholder")}</option>
                {publishersList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.original_name ? `(${p.original_name})` : ""}
                  </option>
                ))}
              </select>
            )}
            <input type="text" disabled={isUploading} placeholder={t("uploader.publisherManualPlaceholder")} value={publisher} onChange={(e) => { setPublisher(e.target.value); const found = publishersList.find((p) => p.name === e.target.value.trim()); setPublisherId(found ? found.id : null); }} className="w-full px-2.5 h-10 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary" />
          </div>

          <div className="space-y-1">
            <label className="font-mono text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("uploader.notes")}</label>
            <textarea rows={2} disabled={isUploading} placeholder={t("uploader.notesPlaceholder")} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-2.5 py-1.5 bg-background border border-black/10 dark:border-white/10 rounded-md text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:border-primary resize-none text-xs" />
          </div>

          {isUploading && (
            <div className="rounded-md bg-background border border-black/10 dark:border-white/10 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-gray-500 inline-flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" strokeWidth={1.6} /> {statusText}
                </span>
                <span className="font-semibold text-gray-900 dark:text-white tabular-nums">{progress}%</span>
              </div>
              <div className="h-1 bg-black/5 dark:bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-200" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex items-center gap-1 font-mono text-[9px] text-gray-500">
                <Fingerprint className="w-3 h-3" strokeWidth={1.4} /> {t("uploader.progressSha")}
              </div>
            </div>
          )}

          {isInstant && (
            <div className="px-2.5 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-300 inline-flex items-center gap-1.5 font-mono text-xs">
              <Check className="w-3.5 h-3.5" strokeWidth={1.7} /> {statusText}
            </div>
          )}

          <div className="flex justify-end gap-1.5 pt-1">
            <button type="button" onClick={onClose} disabled={isUploading} className="px-3 h-7 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-xs transition-colors">
              {t("uploader.cancel")}
            </button>
            <button type="submit" disabled={!file || isUploading} className="px-3.5 h-7 rounded-md bg-primary text-white keep-white font-semibold hover:opacity-90 disabled:opacity-50 text-xs inline-flex items-center gap-1 transition-opacity shadow-xs">
              <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.6} /> <span>{isUploading ? t("common.uploading") : t("uploader.start")}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
