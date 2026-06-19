import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShieldCheck } from "@phosphor-icons/react";
import DateFilter, { dateQuery } from "@/components/DateFilter";

const ACTION_COLORS = {
  create: "text-emerald-600",
  update: "text-blue-600",
  delete: "text-destructive",
  approve: "text-emerald-600",
  dispatch: "text-violet-600",
  commit: "text-amber-600",
  adjust: "text-blue-600",
};

const getActionTone = (action) => {
  for (const k of Object.keys(ACTION_COLORS)) {
    if (action.toLowerCase().includes(k)) return ACTION_COLORS[k];
  }
  return "text-muted-foreground";
};

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ preset: "all", from: "", to: "" });
  const [actionFilter, setActionFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    const q = dateQuery(dateRange);
    if (actionFilter) q.action = actionFilter;
    const params = new URLSearchParams(q).toString();
    const url = params ? `/filtered/audit-logs?${params}` : "/audit-logs?limit=200";
    api.get(url).then((r) => { setLogs(r.data); setLoading(false); });
  }, [dateRange, actionFilter]);

  return (
    <div className="space-y-6" data-testid="audit-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Compliance</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Audit Logs</h1>
          <p className="text-sm text-muted-foreground mt-1">Immutable trail of every action across Servall.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder="Filter action…" className="w-44 h-9 text-sm" data-testid="audit-action-filter" />
          <DateFilter value={dateRange} onChange={setDateRange} storageKey="df:audit-logs" />
        </div>
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">IP</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && logs.length === 0 && (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">
                <ShieldCheck size={32} className="mx-auto mb-2 opacity-50" /> No audit events yet.
              </td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-border hover:bg-muted/30" data-testid={`audit-row-${l.id}`}>
                <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{(l.timestamp || "").replace("T", " ").slice(0, 19)}</td>
                <td className="px-4 py-3 text-xs">{l.user_email}</td>
                <td className={`px-4 py-3 text-xs font-mono ${getActionTone(l.action)}`}>{l.action}</td>
                <td className="px-4 py-3 text-xs">
                  <Badge variant="outline" className="text-[10px]">{l.entity_type}</Badge>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{(l.entity_id || "").slice(0, 8)}</div>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{l.ip_address || "—"}</td>
                <td className="px-4 py-3 text-[11px] text-muted-foreground max-w-md truncate">
                  {l.after ? JSON.stringify(l.after).slice(0, 100) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
