import React, { useCallback, useState } from "react";
import api, { BACKEND_URL, formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CloudArrowUp, FileText, WarningCircle, CheckCircle, Sparkle } from "@phosphor-icons/react";

export default function StockEntry() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState(null);

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
      if (r.data.error) toast.error("OCR partial: " + r.data.error);
      else toast.success("Invoice parsed");
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
      li[idx] = { ...li[idx], [key]: value };
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
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Hyper-Automated Ingestion</div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Stock Entry · AI OCR</h1>
        <p className="text-sm text-muted-foreground mt-1">Drop a vendor invoice (PDF or image). Gemini reads it, you confirm, stock lands in Hub.</p>
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
              {duplicate && (
                <Badge variant="destructive" className="text-[10px]"><WarningCircle size={10} className="mr-1" /> Duplicate invoice #</Badge>
              )}
            </div>
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
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit ₹</th>
                      <th className="px-3 py-2 text-right">GST%</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoice.line_items || []).map((li, i) => (
                      <tr key={i} className={`border-t border-border ${li.anomaly ? "bg-amber-500/5" : ""}`}>
                        <td className="px-3 py-2">
                          <Input value={li.product_name} onChange={(e) => updateLine(i, "product_name", e.target.value)} className="h-8 text-xs" />
                          {li.anomaly && (
                            <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <WarningCircle size={10} /> {li.anomaly}
                            </div>
                          )}
                          {!li.anomaly && li.matched && (
                            <div className="mt-1 text-[10px] text-emerald-600 flex items-center gap-1">
                              <CheckCircle size={10} /> Matched to catalog
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2"><Input value={li.sku} onChange={(e) => updateLine(i, "sku", e.target.value)} className="h-8 text-xs font-mono" /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.quantity} onChange={(e) => updateLine(i, "quantity", Number(e.target.value))} className="h-8 text-xs text-right" /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.unit_price} onChange={(e) => updateLine(i, "unit_price", Number(e.target.value))} className="h-8 text-xs text-right" /></td>
                        <td className="px-3 py-2 text-right"><Input type="number" value={li.gst_percent} onChange={(e) => updateLine(i, "gst_percent", Number(e.target.value))} className="h-8 text-xs text-right w-16" /></td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(li.line_total)}</td>
                        <td className="px-3 py-2"><button onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive text-[11px]">✕</button></td>
                      </tr>
                    ))}
                    {(invoice.line_items || []).length === 0 && (
                      <tr><td colSpan={7} className="text-center text-muted-foreground py-6">No items parsed.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t border-border p-4 flex items-center justify-between">
              <Button variant="outline" onClick={() => setInvoice(null)} data-testid="discard-invoice-btn">Discard</Button>
              <Button onClick={commit} disabled={duplicate} data-testid="commit-invoice-btn">
                <CheckCircle size={14} className="mr-2" />
                {duplicate ? "Duplicate – cannot commit" : "Commit to Hub Stock"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
