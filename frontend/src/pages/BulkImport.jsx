import React, { useState } from "react";
import api, { BACKEND_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DownloadSimple, UploadSimple, FileXls, CheckCircle, WarningCircle, ArrowLeft } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";

export default function BulkImport() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(null);

  const downloadTemplate = async () => {
    const token = localStorage.getItem("nexus_token");
    const r = await fetch(`${BACKEND_URL}/api/inventory/template`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) { toast.error("Could not download template"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "inventory_import_template.xlsx"; a.click();
    URL.revokeObjectURL(url);
  };

  const validate = async () => {
    if (!file) { toast.error("Pick a file first"); return; }
    setBusy(true);
    setValidation(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/inventory/import/validate", fd);
      setValidation(r.data);
      if (r.data.blocking_rows > 0) {
        toast.warning(`${r.data.blocking_rows} rows blocked. ${r.data.new + r.data.updates} rows ready to commit.`);
      } else if (r.data.warnings_rows > 0) {
        toast.success(`Ready to import: ${r.data.new} new, ${r.data.updates} updates, ${r.data.warnings_rows} auto-fixed`);
      } else {
        toast.success(`Ready to import: ${r.data.new} new, ${r.data.updates} updates`);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Validation failed");
    } finally { setBusy(false); }
  };

  const commit = async () => {
    if (!validation?.upload_path) return;
    setCommitting(true);
    try {
      const r = await api.post("/inventory/import/commit", {
        upload_path: validation.upload_path,
        overwrite_existing: true,
      });
      setCommitted(r.data);
      toast.success(`Imported: ${r.data.created} new, ${r.data.updated} updated, ${r.data.skipped} skipped`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Commit failed");
    } finally { setCommitting(false); }
  };

  return (
    <div className="space-y-6" data-testid="bulk-import-page">
      <div>
        <button onClick={() => navigate("/inventory")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2" data-testid="back-to-inventory">
          <ArrowLeft size={12} /> Back to Inventory
        </button>
        <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Operations</div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Bulk Inventory Import</h1>
        <p className="text-sm text-muted-foreground mt-1">Upload products + opening stock via Excel. Download the template to start.</p>
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {[
          { n: 1, label: "Download Template", done: true },
          { n: 2, label: "Upload Excel", done: !!file },
          { n: 3, label: "Validate & Preview", done: !!validation },
          { n: 4, label: "Commit", done: !!committed },
        ].map((s) => (
          <div key={s.n} className={`rounded-md border p-4 ${s.done ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-card"}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                {s.done ? <CheckCircle size={14} weight="fill" /> : s.n}
              </div>
              <div className="text-sm font-medium">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Action panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="border border-border rounded-md p-5 bg-card">
          <DownloadSimple size={24} className="mb-2" />
          <h3 className="font-display text-base font-medium">Download Template</h3>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            14 columns: SKU, Part Number, OEM Number, Product Name, Category, HSN, Barcode, Rack Location, Vendor, Landing Price, MRP, Opening Stock, Reorder Qty, Safety Stock.
          </p>
          <p className="text-[11px] text-muted-foreground mb-3 italic">
            Also accepts Vyapar / Zoho / Tally exports — common column names are auto-mapped (e.g. <code>Item name → Product Name</code>, <code>Purchase price → Landing Price</code>).
          </p>
          <Button onClick={downloadTemplate} variant="outline" data-testid="download-template-btn">
            <DownloadSimple size={14} className="mr-2" /> Download .xlsx
          </Button>
        </div>

        <div className="border border-border rounded-md p-5 bg-card">
          <UploadSimple size={24} className="mb-2" />
          <h3 className="font-display text-base font-medium">Upload & Validate</h3>
          <p className="text-xs text-muted-foreground mt-1 mb-3">
            Fill the template, then upload here. Validation runs row-by-row before any DB write.
          </p>
          <label className="block">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setValidation(null); setCommitted(null); }}
              className="block w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-foreground file:px-3 file:py-1.5 file:text-background"
              data-testid="bulk-file-input"
            />
          </label>
          {file && <div className="mt-2 text-[11px] text-muted-foreground"><FileXls size={12} className="inline mr-1" /> {file.name}</div>}
          <Button onClick={validate} disabled={!file || busy} className="mt-3 w-full" data-testid="validate-btn">
            {busy ? "Validating…" : "Validate"}
          </Button>
        </div>

        <div className="border border-border rounded-md p-5 bg-card">
          <CheckCircle size={24} className="mb-2" weight="duotone" />
          <h3 className="font-display text-base font-medium">Commit Import</h3>
          {validation ? (
            <div className="space-y-1 text-xs mt-2">
              <div className="flex justify-between"><span className="text-muted-foreground">Total rows</span> <span className="font-medium">{validation.total_rows}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">New products</span> <span className="font-medium text-emerald-600">{validation.new}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Updates</span> <span className="font-medium text-blue-600">{validation.updates}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Auto-fixed</span> <span className="font-medium text-amber-600">{validation.warnings_rows || 0}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Blocked</span> <span className="font-medium text-destructive">{validation.blocking_rows}</span></div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-1 mb-3">Validate first to see commit summary.</p>
          )}
          <Button onClick={commit} disabled={!validation || committing || (validation && validation.new + validation.updates === 0)} className="mt-3 w-full" data-testid="commit-btn">
            {committing ? "Committing…" : `Commit ${validation ? validation.new + validation.updates : ""} rows`}
          </Button>
          {committed && (
            <div className="mt-3 rounded bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-700 dark:text-emerald-400">
              <div className="font-medium">Import complete</div>
              <div>Created: {committed.created} · Updated: {committed.updated} · Skipped: {committed.skipped}</div>
            </div>
          )}
        </div>
      </div>

      {/* Detected column mapping */}
      {validation?.detected_columns?.length > 0 && (
        <div className="rounded-md border border-border bg-card px-4 py-3" data-testid="detected-columns">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Detected & mapped columns</div>
          <div className="flex flex-wrap gap-1.5">
            {validation.detected_columns.map((c) => (
              <Badge key={c} variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] font-mono">{c}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Validation preview table */}
      {validation && (
        <div className="rounded-md border border-border overflow-hidden bg-card">
          <div className="bg-muted/40 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
            <div className="font-display text-sm font-medium">
              Row-level preview ({validation.rows.length} rows{validation.rows.length > 200 ? " — showing first 200" : ""})
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">{validation.new} new</Badge>
              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">{validation.updates} updates</Badge>
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">{validation.warnings_rows || 0} auto-fixed</Badge>
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">{validation.blocking_rows} errors</Badge>
            </div>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 sticky top-0">
                <tr className="text-left text-xs uppercase text-muted-foreground tracking-wider">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Cat</th>
                  <th className="px-3 py-2">HSN</th>
                  <th className="px-3 py-2 text-right">Landing</th>
                  <th className="px-3 py-2 text-right">Opening</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {validation.rows.slice(0, 200).map((r) => {
                  const hasWarn = (r.warnings || []).length > 0;
                  const allMsgs = [...(r.errors || []), ...(r.warnings || [])];
                  return (
                    <tr
                      key={r.row}
                      className={`border-t border-border ${r.blocking ? "bg-destructive/5" : hasWarn ? "bg-amber-500/5" : r.is_update ? "bg-blue-500/5" : ""}`}
                      data-testid={`import-row-${r.row}`}
                    >
                      <td className="px-3 py-2 text-muted-foreground">{r.row}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.data.sku}</td>
                      <td className="px-3 py-2 truncate max-w-[280px]">{r.data.name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{r.data.category}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.data.hsn || <span className="text-muted-foreground/60">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.data.landing_price}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.data.opening_stock}</td>
                      <td className="px-3 py-2 text-xs">
                        {allMsgs.length === 0 ? (
                          <span className="text-emerald-600 inline-flex items-center gap-1"><CheckCircle size={12} /> OK</span>
                        ) : (
                          <span className={`inline-flex items-start gap-1 ${r.blocking ? "text-destructive" : "text-amber-600"}`}>
                            <WarningCircle size={12} className="mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{allMsgs.join(" · ")}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
