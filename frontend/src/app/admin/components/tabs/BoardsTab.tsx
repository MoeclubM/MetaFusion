"use client";

import { useEffect, useState } from "react";
import { fetchApi, ForumBoard } from "@/lib/api";
import { useI18n } from "@/i18n/I18nProvider";
import { DynamicNamesEditor, MultilingualBadges } from "@/components/common/DynamicNamesEditor";
import { LayoutGrid, Plus, Pencil, Trash2, Search, Megaphone, Bug, MessageCircle, BookOpen, Cpu, Archive, Coffee, Layers, Hash, Tag, Sparkles, Flame, Bookmark, MessageSquare, Globe } from "lucide-react";

const COLORS = ["emerald","amber","sky","purple","cyan","rose","indigo","teal"] as const;
const ICONS = ["BookOpen","Cpu","Archive","Coffee","Layers","Hash","Tag","Sparkles","Flame","Bookmark","MessageSquare","Globe","Megaphone","Bug","MessageCircle"] as const;
const ICON_MAP: Record<string, any> = { BookOpen, Cpu, Archive, Coffee, Layers, Hash, Tag, Sparkles, Flame, Bookmark, MessageSquare, Globe, Megaphone, Bug, MessageCircle };

function colorDot(c: string) {
  const m: Record<string,string> = { emerald:"bg-emerald-500", amber:"bg-amber-500", sky:"bg-sky-500", purple:"bg-purple-500", cyan:"bg-cyan-500", rose:"bg-rose-500", indigo:"bg-indigo-500", teal:"bg-teal-500" };
  return m[c] || "bg-gray-500";
}

type BoardItem = ForumBoard & { topic_count?: number };

export function BoardsTab() {
  const { t } = useI18n();
  const [items, setItems] = useState<BoardItem[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BoardItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<ForumBoard>>({ code:"", name_zh:"", name_en:"", description:"", color:"emerald", icon:"BookOpen", sort_order:10, is_enabled:true, show_in_feed:true });
  const [saveErr, setSaveErr] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetchApi<{items: BoardItem[]; total:number}>(`/admin/boards?q=${encodeURIComponent(q)}&include_disabled=true`);
      setItems(r.items || []);
    } catch {
      // fallback to public boards if admin endpoint unreachable (should not happen for archivist)
      try {
        const raw = await fetchApi<ForumBoard[]>(`/community/boards?include_disabled=true`);
        setItems(raw as BoardItem[]);
      } catch { setItems([]); }
    } finally { setLoading(false); }
  };

  useEffect(()=>{ load(); },[]);

  const startCreate=()=>{
    const nextOrder = items.length ? Math.max(...items.map(i=>i.sort_order ?? 0))+10 : 10;
    setForm({ code:"", name_zh:"", name_en:"", names: { "zh-CN": "", "en-US": "" }, description:"", color:"emerald", icon:"BookOpen", sort_order: nextOrder, is_enabled:true, show_in_feed:true });
    setEditing(null); setSaveErr(""); setCreating(true);
  };
  const startEdit=(b: BoardItem)=>{
    const names = b.names || { "zh-CN": b.name_zh || "", "en-US": b.name_en || "" };
    setForm({ ...b, names });
    setEditing(b);
    setSaveErr("");
    setCreating(true);
  };

  const save=async()=>{
    const code=(form.code||"").trim();
    const names = form.names || {};
    const nameZh = (names["zh-CN"] || form.name_zh || Object.values(names)[0] || "").trim();
    const nameEn = (names["en-US"] || form.name_en || nameZh).trim();
    if(!code || !nameZh){ setSaveErr(t("admin.boards.codeRequired")); return; }
    setSaveErr(""); setSaving(true);
    try{
      const payload = {
        ...form,
        code,
        name_zh: nameZh,
        name_en: nameEn,
        names: { ...names, "zh-CN": nameZh, "en-US": nameEn },
      };
      if(editing){
        await fetchApi(`/admin/boards/${encodeURIComponent(code)}`,{ method:"PUT", body: JSON.stringify(payload) });
      } else {
        await fetchApi("/admin/boards",{ method:"POST", body: JSON.stringify(payload) });
      }
      setCreating(false); setEditing(null); load();
    }catch(e:any){ setSaveErr(e.message || "Save failed"); }
    finally{ setSaving(false); }
  };

  const del=async(code: string)=>{
    if(code==="announcement" || code==="comment"){ alert(t("admin.boards.systemProtected", { code })); return; }
    if(!confirm(t("admin.boards.deleteConfirm", { code }))) return;
    try{
      await fetchApi(`/admin/boards/${encodeURIComponent(code)}`,{ method:"DELETE" });
      load();
    } catch(e:any){ alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2 text-white"><LayoutGrid className="w-4 h-4 text-sky-400" />{t("admin.boards.title")}</h2>
          <p className="text-[11px] text-gray-400 font-mono mt-0.5">{t("admin.boards.subtitle")}</p>
        </div>
        <button onClick={startCreate} className="shrink-0 px-3 py-1.5 rounded-lg bg-white text-black text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-gray-100 transition-colors"><Plus className="w-3.5 h-3.5" />{t("admin.boards.new")}</button>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2.5" />
          <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load()} placeholder={t("admin.boards.searchPlaceholder")} className="pl-8 pr-3 py-2 rounded-lg bg-[#0c0c0f] border border-white/10 text-xs w-72 placeholder:text-gray-600 focus:outline-none focus:border-white/20" />
        </div>
        <button onClick={load} className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-xs text-gray-300 hover:text-white">{t("admin.boards.search")}</button>
        {loading && <span className="text-[11px] font-mono text-gray-500">{t("common.loadingGeneric")}</span>}
      </div>

      {creating && (
        <div className="rounded-xl border border-white/10 bg-surface p-4 space-y-3">
          <div className="text-[11px] font-mono tracking-widest text-sky-300 flex items-center gap-1.5"><LayoutGrid className="w-3 h-3" /> {editing ? t("admin.boards.editTitle") : t("admin.boards.createTitle")}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-gray-500">{t("admin.boards.codeLabel")}</label>
              <input value={form.code||""} onChange={e=>setForm({...form,code:e.target.value})} disabled={!!editing} placeholder="e.g. announcement" className={`w-full px-3 py-2 rounded-lg bg-[#0a0a0c] border text-xs font-mono ${editing?"bg-white/[0.03] border-white/5 text-gray-500 cursor-not-allowed":"border-white/10 text-white focus:border-sky-500/30 focus:outline-none"}`} />
              {editing && <div className="text-[11px] text-gray-500 font-mono">{t("admin.boards.codeImmutableHint")}</div>}
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-mono text-gray-500">{t("admin.boards.sortLabel")}</label>
              <input type="number" value={form.sort_order ?? 0} onChange={e=>setForm({...form,sort_order: Number(e.target.value)})} className="w-full px-3 py-2 rounded-lg bg-[#0a0a0c] border border-white/10 text-xs focus:outline-none focus:border-sky-500/30" />
            </div>
          </div>
          <DynamicNamesEditor
            value={form.names}
            onChange={(nextNames) => {
              setForm({
                ...form,
                names: nextNames,
                name_zh: nextNames["zh-CN"] || form.name_zh || "",
                name_en: nextNames["en-US"] || form.name_en || "",
              });
            }}
            label={t("admin.boards.colName")}
          />
          <div className="space-y-1">
            <label className="text-[11px] font-mono text-gray-500">{t("admin.boards.descLabel")}</label>
            <input value={form.description||""} onChange={e=>setForm({...form,description:e.target.value})} className="w-full px-3 py-2 rounded-lg bg-[#0a0a0c] border border-white/10 text-xs focus:outline-none" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-mono text-gray-500">{t("admin.boards.colorLabel")}</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c=>(
                <button key={c} onClick={()=>setForm({...form,color:c})} className={`px-3 py-1.5 rounded-full border text-xs font-mono flex items-center gap-1.5 ${form.color===c?"bg-white text-black border-white":"bg-white/[0.04] border-white/10 text-gray-400 hover:text-white"}`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${colorDot(c)}`} />{c}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-mono text-gray-500">{t("admin.boards.iconLabel")}</label>
            <div className="flex flex-wrap gap-1.5">
              {ICONS.map(name=>{
                const Icon=ICON_MAP[name];
                const active=form.icon===name;
                return <button key={name} onClick={()=>setForm({...form,icon:name})} className={`w-9 h-9 grid place-items-center rounded-lg border ${active?"bg-white text-black border-white":"bg-white/[0.04] border-white/10 text-gray-400 hover:text-white"}`} title={name}><Icon className="w-4 h-4" /></button>
              })}
            </div>
          </div>
          <div className="flex gap-6 text-xs flex-wrap">
            <label className="flex items-center gap-2 text-gray-300"><input type="checkbox" checked={!!form.is_enabled} onChange={e=>setForm({...form,is_enabled:e.target.checked})} /> {t("admin.boards.enabled")}</label>
            <label className="flex items-center gap-2 text-gray-300"><input type="checkbox" checked={!!form.show_in_feed} onChange={e=>setForm({...form,show_in_feed:e.target.checked})} disabled={form.code==="comment"} /> {t("admin.boards.feed")}{form.code==="comment" && <span className="text-[11px] text-gray-500">{t("admin.boards.feedHint")}</span>}</label>
          </div>
          {saveErr && <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{saveErr}</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={()=>{setCreating(false);setEditing(null);}} className="px-3 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-gray-300">{t("admin.boards.cancel")}</button>
            <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-white text-black text-xs font-semibold disabled:opacity-60">{saving ? t("common.saving") : editing ? t("admin.boards.save") : t("admin.boards.create")}</button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-surfaceBorder bg-surface overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[#0a0a0c]/60 text-[11px] font-mono text-gray-500"><tr><th className="text-left p-2.5">{t("admin.boards.colCode")}</th><th className="text-left p-2.5">{t("admin.boards.colName")}</th><th className="text-left p-2.5">{t("admin.boards.colDesc")}</th><th className="text-left p-2.5">{t("admin.boards.colOrder")}</th><th className="text-left p-2.5">{t("admin.boards.colTopics")}</th><th className="text-left p-2.5">{t("admin.boards.colEnabled")}</th><th className="text-left p-2.5">{t("admin.boards.colFeed")}</th><th className="text-right p-2.5">{t("admin.boards.colAction")}</th></tr></thead>
          <tbody className="divide-y divide-white/[0.06]">
            {items.map(b=>{
              const Icon=ICON_MAP[b.icon || "BookOpen"] || BookOpen;
              // resolve default icons for known codes
              const isSystem = b.code==="announcement" || b.code==="comment";
              return (
                <tr key={b.code} className="hover:bg-white/[0.03]">
                  <td className="p-2.5 font-mono flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${colorDot(b.color)}`} /><Icon className="w-3.5 h-3.5 text-gray-500" />{b.code}{isSystem && <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/20 text-amber-300 text-[10px] font-mono">{t("admin.boards.systemBadge")}</span>}</td>
                  <td className="p-2.5">
                    <div className="font-medium text-white">{b.name_zh || b.name_en || b.code}</div>
                    <div className="mt-1">
                      <MultilingualBadges names={b.names} fallbackZh={b.name_zh} fallbackEn={b.name_en} />
                    </div>
                  </td>
                  <td className="p-2.5 text-gray-400 max-w-[220px] truncate" title={b.description}>{b.description}</td>
                  <td className="p-2.5 font-mono">{b.sort_order}</td>
                  <td className="p-2.5 font-mono text-gray-300">{typeof b.topic_count==="number" ? b.topic_count : "—"}</td>
                  <td className="p-2.5">{b.is_enabled? <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px]">{t("admin.boards.enableBadge")}</span> : <span className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-gray-500 text-[11px]">{t("admin.boards.disableBadge")}</span>}</td>
                  <td className="p-2.5">{b.show_in_feed ? <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[11px]">{t("admin.boards.feedBadge")}</span> : <span className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-gray-500 text-[11px]">{t("admin.boards.noFeedBadge")}</span>}</td>
                  <td className="p-2.5 text-right space-x-1">
                    <button onClick={()=>startEdit(b)} className="px-2 py-1 rounded-lg bg-white/[0.06] border border-white/10 text-gray-300 hover:text-white inline-flex items-center gap-1"><Pencil className="w-3 h-3" />{t("admin.boards.edit")}</button>
                    <button onClick={()=>del(b.code)} disabled={isSystem} title={isSystem ? t("admin.boards.systemProtected", { code: b.code }) : undefined} className={`px-2 py-1 rounded-lg border inline-flex items-center gap-1 ${isSystem ? "bg-white/[0.02] border-white/5 text-gray-600 cursor-not-allowed" : "bg-rose-500/10 border-rose-500/20 text-rose-300 hover:bg-rose-500/15"}`}><Trash2 className="w-3 h-3" />{t("admin.boards.delete")}</button>
                  </td>
                </tr>
              )
            })}
            {items.length===0 && !loading && <tr><td colSpan={8} className="p-8 text-center text-gray-500">{t("admin.boards.noData")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
