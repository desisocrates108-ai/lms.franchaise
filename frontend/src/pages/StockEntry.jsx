import React, { useCallback, useState, useMemo, useRef } from "react";
import api, { BACKEND_URL, formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CloudArrowUp, FileText, WarningCircle, CheckCircle, Sparkle,
  FilePdf, WhatsappLogo, MagnifyingGlass, X, Tag, Robot, Brain, Gauge,
} from "@phosphor-icons/react";
import DateFilter, { dateQuery } from "@/components/DateFilter";

// ---------- Confidence chip helper ----------
const confColor = (c) => c > 0.8
  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
  : c > 0.5
    ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
    : "bg-destructive/10 text-destructive border-destructive/30";

const ConfidenceChip = ({ label, value, icon: Icon, tooltip }) => (
  <Badge variant="outline" className={`text-[10px] gap-1 ${confColor(value)}`} title={tooltip}>
    {Icon && <Icon size={10} weight="bold" />}
    <span className="opacity-80">{label}</span>
    <span className="font-semibold tabular-nums">{Math.round((value || 0) * 100)}%</span>
  </Badge>
);

const SourceBadge = ({ source, matched }) => {
  if (!matched) {
    return <Badge variant="outline" className="text-[10px] bg-destructive/5 text-destructive border-destructive/30">Unmatched</Badge>;
  }
  if (source === "alias") {
    return <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/30 gap-1"><Tag size={9} weight="bold" />Alias auto-match</Badge>;
  }
  if (source === "sku") {
    return <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">SKU exact</Badge>;
  }
  if (source === "name") {
    return <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-600 border-sky-500/30">Name fuzzy</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">Matched</Badge>;
};

// ---------- Inline product picker ----------
function ProductPicker({ current, onPick, onClose }) {
  const [q, setQ] = useState(current || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  // Debounced search triggered from the input's onChange (no useEffect needed)
  const scheduleSearch = (term) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!term || term.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const r = await api.get(`/products?q=${encodeURIComponent(term)}&limit=15`);
        setResults(r.data || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 280);
  };

  // Cleanup pending timer on unmount
  React.useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-80 overflow-auto" data-testid="product-picker">
      <div className="sticky top-0 bg-popover border-b border-border p-2 flex items-center gap-2">
        <MagnifyingGlass size={14} className="text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); scheduleSearch(e.target.value); }}
          placeholder="Search by name, SKU, part number..."
          className="h-7 text-xs"
          data-testid="product-picker-input"
        />
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="product-picker-close"><X size={14} /></button>
      </div>
      {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
      {!loading && results.length === 0 && q.length >= 2 && (
        <div className="px-3 py-2 text-xs text-muted-foreground">No matches.</div>
      )}
      {results.map((p) => (
        <button
          key={p.id}
          onClick={() => onPick(p)}
          className="w-full text-left px-3 py-2 hover:bg-muted/60 border-t border-border first:border-t-0 flex items-center justify-between gap-2"
          data-testid={`product-pick-${p.sku}`}
        >
          <div className="min-w-0">
            <div className="text-xs font-medium truncate">{p.name}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{p.sku} · HSN {p.hsn_code || "—"}</div>
          </div>
          <div className="text-[10px] text-muted-foreground whitespace-nowrap">
            ₹{p.landing_price || 0} • {p.hub_stock ?? 0} in stock
          </div>
        </button>
      ))}
    </div>
  );
}

// ---------- Warning label translator ----------
const WARN_LABELS = {
  missing_qty: "Missing qty",
  invalid_qty: "Invalid qty",
  missing_hsn: "Missing HSN",
  invalid_hsn: "Invalid HSN",
  missing_description: "Missing description",
  missing_unit: "Missing unit",
};

export default function StockEntry() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [llmConf, setLlmConf] = useState(0);
  const [heurConf, setHeurConf] = useState(0);
  const [autoMatched, setAutoMatched] = useState(0);
  const [ocrMeta, setOcrMeta] = useState({});
  const [recent, setRecent] = useState([]);
  const [dateRange, setDateRange] = useState({ preset: "all", from: "", to: "" });
  const [pickerOpen, setPickerOpen] = useState(null); // row index when picker open

  // Derived: invalid rows count
  const invalidRows = useMemo(
    () => (invoice?.line_items || []).filter((x) => x.row_valid === false).length,
    [invoice]
  );

  const loadRecent = async (range = dateRange) => {
    try {
      const q = dateQuery(range);
      const params = new URLSearchParams(q).toString();
      const url = params ? `/filtered/invoices?${params}` : "/invoices";
      const r = await api.get(url);
      setRecent(r.data || []);
    } catch (_e) { /* ignore */ }
  };

  // Load once on mount (no useEffect needed; ref guard avoids double-fetch)
  const mountedRef = useRef(null);
  if (mountedRef.current == null) {
    mountedRef.current = true;
    loadRecent(dateRange);
  }

  const handleDateChange = (next) => {
    setDateRange(next);
    loadRecent(next);
  };

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api.post("/invoices/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      // Default `remember_alias=true` for every line so commit will learn the alias
      const inv = r.data.invoice;
      inv.line_items = (inv.line_items || []).map((li) => ({ ...li, remember_alias: true }));
      setInvoice(inv);
      setDuplicate(!!r.data.duplicate_invoice_number);
      setError(r.data.error || null);
      setConfidence(r.data.confidence_score || 0);
      setLlmConf(r.data.llm_confidence || 0);
      setHeurConf(r.data.heuristic_confidence || 0);
      setAutoMatched(r.data.auto_matched_alias_count || 0);
      setOcrMeta({ provider: r.data.ocr_provider, model: r.data.ocr_model });
      if (r.data.error) toast.error("OCR partial: " + r.data.error);
      else toast.success(`Invoice parsed · ${(r.data.confidence_score * 100).toFixed(0)}% confidence${r.data.auto_matched_alias_count ? ` · ${r.data.auto_matched_alias_count} alias auto-match${r.data.auto_matched_alias_count > 1 ? "es" : ""}` : ""}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const updateLine = (idx, patch) => {
    setInvoice((inv) => {
      if (!inv) return inv;
      const li = [...inv.line_items];
      const next = { ...li[idx], ...patch };
      // Client-side revalidation
      const qtyOk = Number(next.quantity) > 0;
      const hsn = String(next.hsn_code || "").trim();
      const hsnOk = /^\d{4,8}$/.test(hsn);
      const descOk = !!String(next.product_name || "").trim();
      const unitOk = !!String(next.unit || "").trim();
      next.qty_valid = qtyOk;
      next.hsn_valid = hsnOk;
      next.desc_valid = descOk;
      next.unit_valid = unitOk;
      next.row_valid = qtyOk && hsnOk && descOk;
      // Rebuild warnings client-side
      const warns = [];
      if (!qtyOk) warns.push(Number(next.quantity) === 0 ? "missing_qty" : "invalid_qty");
      if (!hsnOk) warns.push(hsn ? "invalid_hsn" : "missing_hsn");
      if (!descOk) warns.push("missing_description");
      if (!unitOk) warns.push("missing_unit");
      next.warnings = warns;
      li[idx] = next;
      return { ...inv, line_items: li };
    });
  };

  const removeLine = (idx) => {
    setInvoice((inv) => inv ? { ...inv, line_items: inv.line_items.filter((_, i) => i !== idx) } : inv);
  };

  const pickProduct = (idx, prod) => {
    updateLine(idx, {
      product_id: prod.id,
      product_name: prod.name,
      sku: prod.sku,
      hsn_code: prod.hsn_code || "",
      matched: true,
      anomaly: null,
      match_source: "manual",
      auto_matched_alias: false,
      remember_alias: true, // default check
    });
    setPickerOpen(null);
    toast.success(`Linked to ${prod.sku} · alias will be remembered on commit`);
  };

  // ---------- Totals — Vendor vs System reconciliation ----------
  const totals = useMemo(() => {
    if (!invoice) return null;
    const sysSubtotal = (invoice.line_items || []).reduce(
      (acc, li) => acc + (Number(li.line_total) || 0), 0,
    );
    const sysTax = (Number(invoice.cgst) || 0) + (Number(invoice.sgst) || 0) + (Number(invoice.igst) || 0);
    const sysTotal = sysSubtotal + sysTax;
    const vendorTotal = Number(invoice.total_amount) || 0;
    const diff = sysTotal - vendorTotal;
    const pctDiff = vendorTotal > 0 ? (diff / vendorTotal) * 100 : 0;
    const tolerance = Math.max(1, vendorTotal * 0.01); // ₹1 or 1%
    return {
      sysSubtotal,
      sysTax,
      sysTotal,
      vendorTotal,
      diff,
      pctDiff,
      withinTolerance: Math.abs(diff) <= tolerance,
    };
  }, [invoice]);

  const commit = async () => {
    if (!invoice) return;
    try {
      // Strip remember_alias flag — if user unchecked it, also blank the alias so it isn't learned
      const lines = (invoice.line_items || []).map((li) => {
        const cp = { ...li };
        if (cp.remember_alias === false) cp.item_alias = "";
        delete cp.remember_alias;
        return cp;
      });
      await api.post(`/invoices/${invoice.id}/commit`, {
        invoice_number: invoice.invoice_number,
        vendor_id: invoice.vendor_id || null,
        vendor_name: invoice.vendor_name,
        invoice_date: invoice.invoice_date,
        total_amount: invoice.total_amount,
        cgst: invoice.cgst,
        sgst: invoice.sgst,
        igst: invoice.igst,
        line_items: lines,
      });
      toast.success("Stock committed to Hub");
      setInvoice(null);
      loadRecent();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Commit failed");
    }
  };

  return (
    <div className="space-y-6" data-testid="stock-entry-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Hyper-Automated Ingestion</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Stock Entry · AI OCR</h1>
          <p className="text-sm text-muted-foreground mt-1">Drop a vendor invoice (PDF or image). Gemini reads it, you confirm, stock lands in Hub.</p>
        </div>
        <DateFilter value={dateRange} onChange={handleDateChange} storageKey="df:invoices" />
      </div>

      {!invoice && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative rounded-md border-2 border-dashed p-16 text-center transition-colors ${
            dragOver ? "border-foreground bg-muted/50" : "border-border"
          }`}
          data-testid="upload-zone"
        >
          <CloudArrowUp size={48} className="mx-auto text-muted-foreground mb-4" weight="duotone" />
          <div className="font-display text-xl font-semibold">Drag & drop invoice here</div>
          <div className="text-sm text-muted-foreground mt-1">PDF, JPG, PNG · Max 10MB</div>
          <div className="mt-6">
            <label className="inline-flex">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
                disabled={uploading}
                data-testid="file-input"
              />
              <span className="cursor-pointer inline-flex items-center gap-2 rounded bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90">
                {uploading ? <><Sparkle size={14} className="animate-pulse" /> Parsing with Gemini…</> : <><CloudArrowUp size={14} /> Choose file</>}
              </span>
            </label>
          </div>
          <div className="mt-6 text-xs text-muted-foreground flex items-center justify-center gap-1">
            <Sparkle size={12} /> Powered by Gemini 3 Flash multimodal OCR
          </div>
        </div>
      )}

      {invoice && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="reconciliation-view">
          {/* Left: original */}
          <div className="border border-border rounded-md bg-card overflow-hidden">
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium"><FileText size={16} /> Original Invoice</div>
              <a className="text-xs text-muted-foreground underline" href={`${BACKEND_URL}${invoice.file_url}`} target="_blank" rel="noreferrer" data-testid="view-original-link">Open in new tab</a>
            </div>
            <div className="aspect-[3/4] bg-muted/30 flex items-center justify-center">
              {invoice.file_url?.endsWith(".pdf") ? (
                <iframe title="invoice" src={`${BACKEND_URL}${invoice.file_url}`} className="w-full h-full" />
              ) : (
                <img src={`${BACKEND_URL}${invoice.file_url}`} alt="invoice" className="max-h-full max-w-full object-contain" />
              )}
            </div>
          </div>

          {/* Right: parsed */}
          <div className="border border-border rounded-md bg-card">
            <div className="border-b border-border px-4 py-3 flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-medium flex items-center gap-2"><Sparkle size={14} /> Parsed Data — Reconcile</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {confidence > 0 && (
                  <ConfidenceChip label="Combined" value={confidence} icon={Gauge} tooltip="Weighted: LLM × heuristic" />
                )}
                {llmConf > 0 && (
                  <ConfidenceChip label="LLM" value={llmConf} icon={Brain} tooltip={`Self-reported by ${ocrMeta?.model || "model"}`} />
                )}
                {heurConf > 0 && (
                  <ConfidenceChip label="Heuristic" value={heurConf} icon={Robot} tooltip="Rule-based: qty/hsn/desc/unit validity" />
                )}
                {ocrMeta?.model && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground" title={`${ocrMeta.provider}/${ocrMeta.model}`}>
                    {ocrMeta.model}
                  </Badge>
                )}
                {autoMatched > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/30 gap-1" data-testid="auto-matched-badge">
                    <Tag size={9} weight="bold" /> {autoMatched} alias auto-match{autoMatched > 1 ? "es" : ""}
                  </Badge>
                )}
                {duplicate && (
                  <Badge variant="destructive" className="text-[10px]"><WarningCircle size={10} className="mr-1" /> Duplicate invoice #</Badge>
                )}
              </div>
            </div>

            {/* Test-ID hooks for individual confidence chips (kept for backward compat) */}
            <div className="hidden">
              <span data-testid="ocr-confidence">{Math.round((confidence || 0) * 100)}%</span>
              <span data-testid="ocr-confidence-llm">{Math.round((llmConf || 0) * 100)}%</span>
              <span data-testid="ocr-confidence-heuristic">{Math.round((heurConf || 0) * 100)}%</span>
            </div>

            {invalidRows > 0 && (
              <div className="mx-4 mt-3 rounded bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive flex items-start gap-2" data-testid="invalid-rows-banner">
                <WarningCircle size={14} className="mt-0.5" />
                <div>
                  <div className="font-medium">{invalidRows} row{invalidRows !== 1 ? "s" : ""} have validation issues</div>
                  <div className="opacity-80">Fix qty / HSN / description before committing — they cannot be auto-imported.</div>
                </div>
              </div>
            )}
            {error && (
              <div className="mx-4 mt-3 rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <WarningCircle size={14} className="mt-0.5" />
                <div><div className="font-medium">OCR returned partial data</div><div className="opacity-80">{error}</div></div>
              </div>
            )}

            <div className="p-4 grid grid-cols-2 gap-3">
              <div><Label>Vendor Name</Label><Input value={invoice.vendor_name || ""} onChange={(e) => setInvoice({ ...invoice, vendor_name: e.target.value })} data-testid="invoice-vendor" /></div>
              <div><Label>Invoice #</Label><Input value={invoice.invoice_number || ""} onChange={(e) => setInvoice({ ...invoice, invoice_number: e.target.value })} data-testid="invoice-number" /></div>
              <div><Label>Invoice Date</Label><Input value={invoice.invoice_date || ""} onChange={(e) => setInvoice({ ...invoice, invoice_date: e.target.value })} placeholder="YYYY-MM-DD" /></div>
              <div><Label>Total Amount</Label><Input type="number" value={invoice.total_amount || 0} onChange={(e) => setInvoice({ ...invoice, total_amount: Number(e.target.value) })} data-testid="invoice-total" /></div>
              <div><Label>CGST</Label><Input type="number" value={invoice.cgst || 0} onChange={(e) => setInvoice({ ...invoice, cgst: Number(e.target.value) })} /></div>
              <div><Label>SGST</Label><Input type="number" value={invoice.sgst || 0} onChange={(e) => setInvoice({ ...invoice, sgst: Number(e.target.value) })} /></div>
            </div>

            <div className="border-t border-border">
              <div className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">Line Items</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="line-items-table">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 min-w-[280px]">Product · Match · Confidence</th>
                      <th className="px-3 py-2">SKU / Alias</th>
                      <th className="px-3 py-2">HSN</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2 text-right">Unit ₹</th>
                      <th className="px-3 py-2 text-right">GST%</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoice.line_items || []).map((li, i) => {
                      const invalid = (li.row_valid === false) || !li.hsn_valid || !li.qty_valid || !li.desc_valid;
                      const combinedC = typeof li.confidence === "number" ? li.confidence : 1;
                      const llmC = typeof li.llm_confidence === "number" ? li.llm_confidence : 1;
                      const heurC = typeof li.heuristic_confidence === "number" ? li.heuristic_confidence : 1;
                      const warns = li.warnings || [];
                      const isPickerOpen = pickerOpen === i;
                      return (
                      <tr key={i} className={`border-t border-border align-top ${invalid ? "bg-destructive/5" : li.anomaly ? "bg-amber-500/5" : ""}`} data-testid={`ocr-row-${i}`}>
                        <td className="px-3 py-2 relative">
                          <Input value={li.product_name} onChange={(e) => updateLine(i, { product_name: e.target.value })} className={`h-8 text-xs ${!li.desc_valid ? "border-destructive" : ""}`} data-testid={`row-desc-${i}`} />
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <SourceBadge source={li.match_source} matched={li.matched} />
                            <ConfidenceChip label="C" value={combinedC} tooltip="Combined confidence" />
                            <ConfidenceChip label="L" value={llmC} tooltip="LLM self-reported" />
                            <ConfidenceChip label="H" value={heurC} tooltip="Heuristic" />
                            <button
                              onClick={() => setPickerOpen(isPickerOpen ? null : i)}
                              className="text-[10px] underline text-muted-foreground hover:text-foreground"
                              data-testid={`row-link-product-${i}`}
                            >
                              {li.matched ? "Re-link" : "Link product"}
                            </button>
                          </div>
                          {isPickerOpen && (
                            <ProductPicker
                              current={li.product_name}
                              onPick={(p) => pickProduct(i, p)}
                              onClose={() => setPickerOpen(null)}
                            />
                          )}
                          {li.anomaly && (
                            <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <WarningCircle size={10} /> {li.anomaly}
                            </div>
                          )}
                          {li.matched && li.item_alias && (
                            <label className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={li.remember_alias !== false}
                                onChange={(e) => updateLine(i, { remember_alias: e.target.checked })}
                                className="h-3 w-3"
                                data-testid={`row-remember-alias-${i}`}
                              />
                              Remember alias <span className="font-mono">{li.item_alias}</span> → {li.sku}
                            </label>
                          )}
                          {warns.length > 0 && (
                            <div className="mt-1 text-[10px] text-destructive flex flex-wrap items-center gap-1" data-testid={`row-warnings-${i}`}>
                              <WarningCircle size={10} />
                              {warns.map((w) => (
                                <Badge key={w} variant="outline" className="text-[9px] py-0 h-4 bg-destructive/10 text-destructive border-destructive/30">{WARN_LABELS[w] || w}</Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2"><Input value={li.sku} onChange={(e) => updateLine(i, { sku: e.target.value })} className="h-8 text-xs font-mono" data-testid={`row-sku-${i}`} /></td>
                        <td className="px-3 py-2"><Input value={li.hsn_code || ""} onChange={(e) => updateLine(i, { hsn_code: e.target.value })} className={`h-8 text-xs font-mono w-24 ${!li.hsn_valid ? "border-destructive" : ""}`} data-testid={`row-hsn-${i}`} /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} className={`h-8 text-xs text-right ${!li.qty_valid ? "border-destructive" : ""}`} data-testid={`row-qty-${i}`} /></td>
                        <td className="px-3 py-2"><Input value={li.unit || ""} onChange={(e) => updateLine(i, { unit: e.target.value })} className={`h-8 text-xs w-16 ${!li.unit_valid ? "border-destructive" : ""}`} data-testid={`row-unit-${i}`} /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.unit_price} onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) })} className="h-8 text-xs text-right" /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.gst_percent} onChange={(e) => updateLine(i, { gst_percent: Number(e.target.value) })} className="h-8 text-xs text-right w-16" /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(li.line_total)}</td>
                        <td className="px-3 py-2"><button onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive text-[11px]" data-testid={`row-remove-${i}`}>✕</button></td>
                      </tr>
                      );
                    })}
                    {(invoice.line_items || []).length === 0 && (
                      <tr><td colSpan={9} className="text-center text-muted-foreground py-6">No items parsed.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Reconciliation — Vendor vs System */}
            {totals && (
              <div className="border-t border-border p-4 bg-muted/30" data-testid="reconciliation-totals">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Reconciliation · Vendor vs System</div>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-muted-foreground">Vendor Total</div>
                    <div className="font-semibold text-base tabular-nums mt-0.5" data-testid="vendor-total">{formatINR(totals.vendorTotal)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">System Total <span className="opacity-60">(lines + tax)</span></div>
                    <div className="font-semibold text-base tabular-nums mt-0.5" data-testid="system-total">{formatINR(totals.sysTotal)}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
                      Σ lines {formatINR(totals.sysSubtotal)} + tax {formatINR(totals.sysTax)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Difference</div>
                    <div className={`font-semibold text-base tabular-nums mt-0.5 ${totals.withinTolerance ? "text-emerald-600" : "text-destructive"}`} data-testid="reconciliation-diff">
                      {totals.diff >= 0 ? "+" : ""}{formatINR(totals.diff)}
                    </div>
                    <div className={`text-[10px] mt-0.5 flex items-center gap-1 ${totals.withinTolerance ? "text-emerald-600" : "text-destructive"}`}>
                      {totals.withinTolerance
                        ? <><CheckCircle size={10} /> Within tolerance ({totals.pctDiff.toFixed(2)}%)</>
                        : <><WarningCircle size={10} /> Off by {Math.abs(totals.pctDiff).toFixed(2)}%</>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-border p-4 flex items-center justify-between">
              <Button variant="outline" onClick={() => setInvoice(null)} data-testid="discard-invoice-btn">Discard</Button>
              <Button onClick={commit} disabled={duplicate || invalidRows > 0} data-testid="commit-invoice-btn">
                <CheckCircle size={14} className="mr-2" />
                {duplicate ? "Duplicate – cannot commit" : invalidRows > 0 ? `Fix ${invalidRows} invalid row${invalidRows !== 1 ? "s" : ""}` : "Commit to Hub Stock"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Recent Invoices (date-filtered) */}
      {!invoice && (
        <div className="border border-border rounded-md bg-card" data-testid="recent-invoices-panel">
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <div className="text-sm font-medium flex items-center gap-2"><FileText size={14} /> Recent Invoices</div>
            <Badge variant="outline" className="text-[10px]">{recent.length}</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="recent-invoices-table">
              <thead className="bg-muted/40">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2">Invoice #</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Confidence</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recent.slice(0, 50).map((inv) => (
                  <tr key={inv.id} className="border-t border-border" data-testid={`recent-invoice-${inv.invoice_number}`}>
                    <td className="px-3 py-2 font-mono">{inv.invoice_number}</td>
                    <td className="px-3 py-2">{inv.vendor_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{inv.invoice_date || (inv.created_at || "").slice(0, 10)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(inv.total_amount)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={`text-[10px] ${inv.status === "committed" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : ""}`}>
                        {inv.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {inv.confidence_score ? `${Math.round((inv.confidence_score || 0) * 100)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download PDF" data-testid={`inv-pdf-${inv.invoice_number}`}
                          onClick={async () => {
                            const token = localStorage.getItem("nexus_token");
                            const r = await fetch(`${BACKEND_URL}/api/invoices/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
                            if (!r.ok) { toast.error("PDF failed"); return; }
                            const blob = await r.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a"); a.href = url; a.download = `${inv.invoice_number}.pdf`; a.click();
                            URL.revokeObjectURL(url);
                          }}
                        ><FilePdf size={13} /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Share via WhatsApp" data-testid={`inv-wa-${inv.invoice_number}`}
                          onClick={async () => {
                            const phone = prompt("Vendor WhatsApp number (with country code):", "");
                            if (phone === null) return;
                            try {
                              const r = await api.get(`/whatsapp/share?kind=invoice&doc_id=${inv.id}${phone ? `&phone=${encodeURIComponent(phone)}` : ""}`);
                              window.open(r.data.url, "_blank", "noopener");
                            } catch { toast.error("Share failed"); }
                          }}
                        ><WhatsappLogo size={13} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {recent.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-muted-foreground py-8">No invoices in selected range.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
