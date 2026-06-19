import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api, { formatINR, API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Trash, FilePdf, FloppyDisk, CheckCircle, Prohibit } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function CreditNoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cn, setCn] = useState(null);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [r1, r2] = await Promise.all([
        api.get(`/credit-notes/${id}`),
        api.get("/products?limit=500"),
      ]);
      setCn(r1.data);
      setProducts(r2.data);
    } catch (e) { toast.error("Failed to load"); navigate("/credit-notes"); }
  };
  useEffect(() => { load(); }, [id]);

  if (!cn) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const editable = cn.status !== "cancelled";
  const issued = cn.status === "issued";

  const filtered = products.filter(p => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return p.sku?.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q);
  }).slice(0, 6);

  const addLine = (p) => {
    setCn({ ...cn, line_items: [...(cn.line_items || []), {
      product_id: p.id, sku: p.sku, description: p.name, hsn: p.hsn_code || "",
      qty: 1, unit: p.unit || "PCS", unit_price: p.franchise_price || p.mrp || 0,
      discount_percent: 0, gst_percent: p.gst_rate || 18, reason: "",
    }]});
    setSearch("");
  };
  const updateLine = (idx, field, val) => {
    let next = val;
    if (typeof val === "string" && ["qty", "unit_price", "discount_percent", "gst_percent"].includes(field)) {
      if (val.length > 1 && val.startsWith("0") && !val.startsWith("0.")) next = val.replace(/^0+/, "") || "0";
    }
    const items = [...cn.line_items];
    items[idx] = { ...items[idx], [field]: next };
    setCn({ ...cn, line_items: items });
  };
  const removeLine = (idx) => {
    const items = cn.line_items.filter((_, i) => i !== idx);
    setCn({ ...cn, line_items: items });
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        source_type: cn.source_type,
        tax_invoice_id: cn.tax_invoice_id,
        franchise_id: cn.franchise_id,
        cn_date: cn.cn_date,
        reason: cn.reason || "",
        notes: cn.notes || "",
        line_items: (cn.line_items || []).map(li => ({
          product_id: li.product_id, sku: li.sku, description: li.description, hsn: li.hsn,
          qty: Number(li.qty) || 0, unit: li.unit, unit_price: Number(li.unit_price) || 0,
          discount_percent: Number(li.discount_percent) || 0, gst_percent: Number(li.gst_percent) || 0,
          reason: li.reason || "",
        })),
      };
      await api.put(`/credit-notes/${id}`, body);
      toast.success("Saved");
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };

  const issue = async () => {
    if (!(cn.line_items || []).some(li => Number(li.qty) > 0)) {
      toast.error("Add at least one line with qty > 0"); return;
    }
    await save();
    setBusy(true);
    try {
      const r = await api.post(`/credit-notes/${id}/issue`);
      toast.success(`Issued as ${r.data.cn_number}`);
      await load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Issue failed"); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    const reason = window.prompt("Cancel reason?");
    if (reason === null) return;
    setBusy(true);
    try {
      await api.post(`/credit-notes/${id}/cancel`, null, { params: { reason } });
      toast.success("Cancelled");
      await load();
    } catch (e) { toast.error("Cancel failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-testid="cn-detail-page">
      <button onClick={() => navigate("/credit-notes")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="cn-back">
        <ArrowLeft size={12} /> Back to Credit Notes
      </button>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Credit Note</div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-2">
            {cn.cn_number || "DRAFT"}
            <Badge className="ml-3 align-middle" variant="outline">{cn.status}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{cn.franchise_name} · Source: {cn.source_type}{cn.tax_invoice_number ? ` (${cn.tax_invoice_number})` : ""}</p>
        </div>
        <div className="flex gap-2">
          {editable && <Button variant="outline" onClick={save} disabled={busy} data-testid="cn-save-btn"><FloppyDisk size={14} className="mr-1" />Save</Button>}
          {cn.status === "draft" && <Button onClick={issue} disabled={busy} data-testid="cn-issue-btn"><CheckCircle size={14} className="mr-1" />Issue & Restock</Button>}
          {issued && <Button variant="outline" asChild data-testid="cn-pdf-btn"><a href={`${API_BASE}/credit-notes/${id}/pdf`} target="_blank" rel="noreferrer"><FilePdf size={14} className="mr-1" />PDF</a></Button>}
          {cn.status !== "cancelled" && <Button variant="outline" onClick={cancel} disabled={busy} data-testid="cn-cancel-btn"><Prohibit size={14} className="mr-1" />Cancel</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-md border border-border bg-card p-4">
        <div><Label>Date</Label><Input type="date" value={cn.cn_date || ""} onChange={(e) => setCn({ ...cn, cn_date: e.target.value })} disabled={!editable} data-testid="cn-date" /></div>
        <div><Label>Reason</Label><Input value={cn.reason || ""} onChange={(e) => setCn({ ...cn, reason: e.target.value })} disabled={!editable} data-testid="cn-reason" /></div>
        <div className="md:col-span-2"><Label>Notes</Label><Input value={cn.notes || ""} onChange={(e) => setCn({ ...cn, notes: e.target.value })} disabled={!editable} data-testid="cn-notes" /></div>
      </div>

      {editable && (
        <div className="rounded-md border border-border bg-card p-4">
          <Label>Add product</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or name…" data-testid="cn-search" />
          {filtered.length > 0 && (
            <div className="mt-2 rounded border border-border max-h-48 overflow-y-auto">
              {filtered.map(p => (
                <button key={p.id} onClick={() => addLine(p)} className="block w-full text-left px-3 py-2 hover:bg-muted text-sm border-b border-border last:border-b-0">
                  <span className="font-mono text-xs">{p.sku}</span> · {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Disc%</th>
              <th className="px-3 py-2 text-right">GST%</th>
              <th className="px-3 py-2 text-right">Total</th>
              {editable && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {(cn.line_items || []).length === 0 && (
              <tr><td colSpan={editable ? 8 : 7} className="p-6 text-center text-muted-foreground text-xs">No line items yet. Add products above.</td></tr>
            )}
            {(cn.line_items || []).map((li, idx) => (
              <tr key={idx} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">{li.sku}</td>
                <td className="px-3 py-2 text-xs">{li.description}</td>
                <td className="px-3 py-2 text-right"><Input type="number" inputMode="numeric" min={0} value={li.qty ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => updateLine(idx, "qty", e.target.value)} disabled={!editable} className="w-20 ml-auto h-8" data-testid={`cn-qty-${li.sku}`} /></td>
                <td className="px-3 py-2 text-right"><Input type="number" min={0} value={li.unit_price ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => updateLine(idx, "unit_price", e.target.value)} disabled={!editable} className="w-24 ml-auto h-8" /></td>
                <td className="px-3 py-2 text-right"><Input type="number" min={0} max={100} value={li.discount_percent ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => updateLine(idx, "discount_percent", e.target.value)} disabled={!editable} className="w-16 ml-auto h-8" /></td>
                <td className="px-3 py-2 text-right"><Input type="number" min={0} max={28} value={li.gst_percent ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => updateLine(idx, "gst_percent", e.target.value)} disabled={!editable} className="w-16 ml-auto h-8" /></td>
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(li.line_total || 0)}</td>
                {editable && <td className="px-3 py-2 text-right"><button onClick={() => removeLine(idx)} className="rounded p-1 hover:bg-destructive/10 text-destructive"><Trash size={14} /></button></td>}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/40 border-t border-border font-medium">
            <tr><td colSpan={editable ? 6 : 5} className="px-3 py-2 text-right text-xs">Subtotal</td><td className="px-3 py-2 text-right tabular-nums">{formatINR(cn.subtotal)}</td>{editable && <td></td>}</tr>
            <tr><td colSpan={editable ? 6 : 5} className="px-3 py-2 text-right text-xs">CGST + SGST + IGST</td><td className="px-3 py-2 text-right tabular-nums">{formatINR((cn.cgst_total || 0) + (cn.sgst_total || 0) + (cn.igst_total || 0))}</td>{editable && <td></td>}</tr>
            <tr><td colSpan={editable ? 6 : 5} className="px-3 py-2 text-right text-sm">Grand Total</td><td className="px-3 py-2 text-right tabular-nums text-sm">{formatINR(cn.grand_total)}</td>{editable && <td></td>}</tr>
          </tfoot>
        </table>
      </div>

      <div className="text-xs text-muted-foreground">
        Amount in words: <span className="text-foreground font-medium">{cn.amount_in_words || "—"}</span>
      </div>
    </div>
  );
}
