import React, { useCallback, useState } from "react";
import api, { BACKEND_URL, formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CloudArrowUp, FileText, WarningCircle, CheckCircle, Sparkle, FilePdf, WhatsappLogo } from "@phosphor-icons/react";
import DateFilter, { dateQuery } from "@/components/DateFilter";

export default function StockEntry() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [invalidRows, setInvalidRows] = useState(0);
  const [ocrMeta, setOcrMeta] = useState({});
  const [recent, setRecent] = useState([]);
  const [dateRange, setDateRange] = useState({ preset: "all", from: "", to: "" });

  const loadRecent = useCallback(async () => {
    try {
      const q = dateQuery(dateRange);
      const params = new URLSearchParams(q).toString();
      const url = params ? `/filtered/invoices?${params}` : "/invoices";
      const r = await api.get(url);
      setRecent(r.data || []);
    } catch (_e) { /* ignore */ }
  }, [dateRange]);

  React.useEffect(() => { loadRecent(); }, [loadRecent]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api.post("/invoices/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      setInvoice(r.data.invoice);
      setDuplicate(!!r.data.duplicate_invoice_number);
      setError(r.data.error || null);
      setConfidence(r.data.confidence_score || 0);
      setInvalidRows(r.data.invalid_rows || 0);
      setOcrMeta({ provider: r.data.ocr_provider, model: r.data.ocr_model });
      if (r.data.error) toast.error("OCR partial: " + r.data.error);
      else toast.success(`Invoice parsed · ${(r.data.confidence_score * 100).toFixed(0)}% confidence`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const updateLine = (idx, key, value) => {
    setInvoice((inv) => {
      const li = [...inv.line_items];
      const next = { ...li[idx], [key]: value };
      // Re-validate row client-side so the red banner updates on edit
      const qtyOk = Number(next.quantity) > 0;
      const hsn = String(next.hsn_code || "").trim();
      const hsnOk = /^\d{4,8}$/.test(hsn);
      const descOk = !!String(next.product_name || "").trim();
      next.qty_valid = qtyOk;
      next.hsn_valid = hsnOk;
      next.desc_valid = descOk;
      next.row_valid = qtyOk && hsnOk && descOk;
      li[idx] = next;
      const invalid = li.filter((x) => x.row_valid === false).length;
      setInvalidRows(invalid);
      return { ...inv, line_items: li };
    });
  };

  const removeLine = (idx) => {
    setInvoice((inv) => {
      const li = inv.line_items.filter((_, i) => i !== idx);
      return { ...inv, line_items: li };
    });
  };

  const commit = async () => {
    if (!invoice) return;
    try {
      await api.post(`/invoices/${invoice.id}/commit`, {
        invoice_number: invoice.invoice_number,
        vendor_id: invoice.vendor_id || null,
        vendor_name: invoice.vendor_name,
        invoice_date: invoice.invoice_date,
        total_amount: invoice.total_amount,
        cgst: invoice.cgst,
        sgst: invoice.sgst,
        igst: invoice.igst,
        line_items: invoice.line_items,
      });
      toast.success("Stock committed to Hub");
      setInvoice(null);
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
        <DateFilter value={dateRange} onChange={setDateRange} storageKey="df:invoices" />
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
              {invoice.file_url.endsWith(".pdf") ? (
                <iframe title="invoice" src={`${BACKEND_URL}${invoice.file_url}`} className="w-full h-full" />
              ) : (
                <img src={`${BACKEND_URL}${invoice.file_url}`} alt="invoice" className="max-h-full max-w-full object-contain" />
              )}
            </div>
          </div>

          {/* Right: parsed */}
          <div className="border border-border rounded-md bg-card">
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-medium flex items-center gap-2"><Sparkle size={14} /> Parsed Data — Reconcile</div>
              <div className="flex items-center gap-2">
                {confidence > 0 && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${confidence > 0.8 ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : confidence > 0.5 ? "bg-amber-500/10 text-amber-600 border-amber-500/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}
                    data-testid="ocr-confidence"
                  >
                    {(confidence * 100).toFixed(0)}% confidence
                  </Badge>
                )}
                {ocrMeta?.model && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground" title={`${ocrMeta.provider}/${ocrMeta.model}`}>
                    {ocrMeta.model}
                  </Badge>
                )}
                {duplicate && (
                  <Badge variant="destructive" className="text-[10px]"><WarningCircle size={10} className="mr-1" /> Duplicate invoice #</Badge>
                )}
              </div>
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
              <div><Label>Total Amount</Label><Input type="number" value={invoice.total_amount || 0} onChange={(e) => setInvoice({ ...invoice, total_amount: Number(e.target.value) })} /></div>
              <div><Label>CGST</Label><Input type="number" value={invoice.cgst || 0} onChange={(e) => setInvoice({ ...invoice, cgst: Number(e.target.value) })} /></div>
              <div><Label>SGST</Label><Input type="number" value={invoice.sgst || 0} onChange={(e) => setInvoice({ ...invoice, sgst: Number(e.target.value) })} /></div>
            </div>

            <div className="border-t border-border">
              <div className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">Line Items</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="line-items-table">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">SKU / Alias</th>
                      <th className="px-3 py-2">HSN</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit ₹</th>
                      <th className="px-3 py-2 text-right">GST%</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoice.line_items || []).map((li, i) => {
                      const invalid = (li.row_valid === false) || !li.hsn_valid || !li.qty_valid || !li.desc_valid;
                      const conf = typeof li.confidence === "number" ? li.confidence : 1;
                      return (
                      <tr key={i} className={`border-t border-border ${invalid ? "bg-destructive/5" : li.anomaly ? "bg-amber-500/5" : ""}`} data-testid={`ocr-row-${i}`}>
                        <td className="px-3 py-2">
                          <Input value={li.product_name} onChange={(e) => updateLine(i, "product_name", e.target.value)} className={`h-8 text-xs ${!li.desc_valid ? "border-destructive" : ""}`} data-testid={`row-desc-${i}`} />
                          {li.anomaly && (
                            <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <WarningCircle size={10} /> {li.anomaly}
                            </div>
                          )}
                          {!li.anomaly && li.matched && (
                            <div className="mt-1 text-[10px] text-emerald-600 flex items-center gap-1">
                              <CheckCircle size={10} /> Matched to catalog
                              {li.item_alias && <span className="text-muted-foreground">· alias: <span className="font-mono">{li.item_alias}</span></span>}
                            </div>
                          )}
                          {invalid && (
                            <div className="mt-1 text-[10px] text-destructive flex items-center gap-1">
                              <WarningCircle size={10} />
                              {!li.qty_valid && "Qty invalid · "}
                              {!li.hsn_valid && "HSN missing · "}
                              {!li.desc_valid && "Description missing · "}
                              conf {Math.round(conf * 100)}%
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2"><Input value={li.sku} onChange={(e) => updateLine(i, "sku", e.target.value)} className="h-8 text-xs font-mono" data-testid={`row-sku-${i}`} /></td>
                        <td className="px-3 py-2"><Input value={li.hsn_code || ""} onChange={(e) => updateLine(i, "hsn_code", e.target.value)} className={`h-8 text-xs font-mono w-24 ${!li.hsn_valid ? "border-destructive" : ""}`} data-testid={`row-hsn-${i}`} /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.quantity} onChange={(e) => updateLine(i, "quantity", Number(e.target.value))} className={`h-8 text-xs text-right ${!li.qty_valid ? "border-destructive" : ""}`} data-testid={`row-qty-${i}`} /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.unit_price} onChange={(e) => updateLine(i, "unit_price", Number(e.target.value))} className="h-8 text-xs text-right" /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.gst_percent} onChange={(e) => updateLine(i, "gst_percent", Number(e.target.value))} className="h-8 text-xs text-right w-16" /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(li.line_total)}</td>
                        <td className="px-3 py-2"><button onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive text-[11px]">✕</button></td>
                      </tr>
                      );
                    })}
                    {(invoice.line_items || []).length === 0 && (
                      <tr><td colSpan={8} className="text-center text-muted-foreground py-6">No items parsed.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

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
