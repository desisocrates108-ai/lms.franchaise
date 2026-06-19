import React, { useEffect, useMemo, useState } from "react";
import api, { formatINR, BACKEND_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Lightning, ClipboardText, Plus, Trash, FilePdf, PencilSimple, FloppyDisk, WhatsappLogo } from "@phosphor-icons/react";
import DateFilter, { dateQuery } from "@/components/DateFilter";

const STATUS_COLOR = {
  draft: "bg-zinc-500/10 text-zinc-600 border-zinc-500/30",
  sent: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  received: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  cancelled: "bg-destructive/10 text-destructive border-destructive/30",
};

export default function PurchaseOrders() {
  const { user } = useAuth();
  const [pos, setPos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dateRange, setDateRange] = useState({ preset: "all", from: "", to: "" });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // {id?, vendor_id, line_items, notes, status}
  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const canManage = ["super_admin", "warehouse_manager", "hub_accountant"].includes(user?.role);

  const load = async () => {
    const q = dateQuery(dateRange);
    const params = new URLSearchParams(q).toString();
    const url = params ? `/filtered/purchase-orders?${params}` : "/purchase-orders";
    const r = await api.get(url);
    setPos(r.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateRange]);
  useEffect(() => {
    api.get("/vendors").then((r) => setVendors(r.data));
    api.get("/products?limit=2000").then((r) => setProducts(r.data));
  }, []);

  const autoGenerate = async () => {
    setBusy(true);
    try {
      const r = await api.post("/purchase-orders/auto-generate");
      toast.success(`Auto-generated ${r.data.created} PO${r.data.created !== 1 ? "s" : ""}`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  const setStatus = async (id, status) => {
    try {
      const fd = new FormData();
      fd.append("status", status);
      await api.put(`/purchase-orders/${id}/status`, fd);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const openNew = () => {
    const today = new Date().toISOString().slice(0, 10);
    setEditing({ vendor_id: "", line_items: [], notes: "", status: "draft", po_date: today, expected_delivery: "" });
    setEditorOpen(true);
  };

  const openEdit = (po) => {
    setEditing({
      id: po.id,
      vendor_id: po.vendor_id,
      notes: po.notes || "",
      status: po.status,
      po_date: po.po_date || (po.created_at ? String(po.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10)),
      expected_delivery: po.expected_delivery || "",
      line_items: (po.line_items || []).map((li) => ({
        product_id: li.product_id, sku: li.sku, product_name: li.product_name,
        quantity: li.quantity, unit_price: li.unit_price,
      })),
    });
    setEditorOpen(true);
  };

  const downloadPdf = async (po) => {
    const token = localStorage.getItem("nexus_token");
    const r = await fetch(`${BACKEND_URL}/api/purchase-orders/${po.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) { toast.error("Could not generate PDF"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${po.po_number}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  const shareWhatsApp = async (po) => {
    const phone = prompt(`Vendor WhatsApp number (with country code, e.g. 919876543210):`, "");
    if (phone === null) return; // cancelled
    try {
      const r = await api.get(`/whatsapp/share?kind=po&doc_id=${po.id}${phone ? `&phone=${encodeURIComponent(phone)}` : ""}`);
      window.open(r.data.url, "_blank", "noopener");
    } catch (e) {
      toast.error("Failed to build share link");
    }
  };

  return (
    <div className="space-y-6" data-testid="po-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Procurement</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Edit draft POs before sending — add/remove items, change vendor or rates.</p>
        </div>
        <div className="flex items-center gap-2">
          <DateFilter value={dateRange} onChange={setDateRange} storageKey="df:purchase-orders" />
          {canManage && (
            <>
              <Button variant="outline" onClick={autoGenerate} disabled={busy} data-testid="auto-generate-po-btn">
                <Lightning size={14} className="mr-2" /> {busy ? "Scanning…" : "Auto-Generate"}
              </Button>
              <Button onClick={openNew} data-testid="new-po-btn"><Plus size={14} className="mr-2" /> New PO</Button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-md border border-border overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">PO #</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((po) => (
              <tr key={po.id} className="border-t border-border hover:bg-muted/30" data-testid={`po-row-${po.po_number}`}>
                <td className="px-4 py-3 font-mono text-xs">{po.po_number}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{po.vendor_name}</div>
                  {po.auto_generated && <div className="text-[10px] text-muted-foreground"><Lightning size={10} className="inline mr-1" />Auto</div>}
                </td>
                <td className="px-4 py-3">{po.line_items?.length || 0}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatINR(po.total_amount)}</td>
                <td className="px-4 py-3"><Badge variant="outline" className={`text-[11px] ${STATUS_COLOR[po.status]}`}>{po.status}</Badge></td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => downloadPdf(po)} title="Download PDF" data-testid={`po-pdf-${po.po_number}`}><FilePdf size={14} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => shareWhatsApp(po)} title="Share via WhatsApp" data-testid={`po-wa-${po.po_number}`}><WhatsappLogo size={14} /></Button>
                    {canManage && po.status === "draft" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => openEdit(po)} data-testid={`po-edit-${po.po_number}`}><PencilSimple size={14} className="mr-1" /> Edit</Button>
                        <Button size="sm" variant="outline" onClick={() => setStatus(po.id, "sent")} data-testid={`po-send-${po.po_number}`}>Send</Button>
                        <Button size="sm" variant="ghost" onClick={() => setStatus(po.id, "cancelled")}>Cancel</Button>
                      </>
                    )}
                    {canManage && po.status === "sent" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(po.id, "received")} data-testid={`po-receive-${po.po_number}`}>Mark Received</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {pos.length === 0 && (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">
                <ClipboardText size={32} className="mx-auto mb-2 opacity-50" />
                No purchase orders in selected range.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <POEditorDialog
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditing(null); }}
        editing={editing}
        setEditing={setEditing}
        vendors={vendors}
        products={products}
        onSaved={() => { setEditorOpen(false); setEditing(null); load(); }}
      />
    </div>
  );
}

function POEditorDialog({ open, onClose, editing, setEditing, vendors, products, onSaved }) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const isEdit = !!editing?.id;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products.filter(p =>
      p.sku?.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [products, search]);

  if (!editing) return null;

  const addLine = (p) => {
    if (editing.line_items?.find((i) => i.product_id === p.id)) return;
    setEditing({
      ...editing,
      line_items: [...editing.line_items, {
        product_id: p.id, sku: p.sku, product_name: p.name,
        quantity: 1, unit_price: p.landing_price || 0,
      }],
    });
    setSearch("");
  };

  const updateLine = (id, field, val) => {
    // For numeric fields keep the raw string so users can clear/edit freely
    // (prevents the "leading zero" issue when state is 0 and user types digits).
    // Conversion to Number happens at save time.
    const isText = field === "product_name";
    let next = val;
    if (!isText) {
      // strip leading zeros except for a single "0" or "0.x"
      if (typeof val === "string" && val.length > 1 && val.startsWith("0") && !val.startsWith("0.")) {
        next = val.replace(/^0+/, "") || "0";
      }
    }
    setEditing({
      ...editing,
      line_items: editing.line_items.map(li => li.product_id === id ? { ...li, [field]: next } : li),
    });
  };

  const removeLine = (id) => {
    setEditing({ ...editing, line_items: editing.line_items.filter(li => li.product_id !== id) });
  };

  const total = (editing.line_items || []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);

  const save = async (saveAs = editing.status || "draft") => {
    if (!editing.vendor_id) { toast.error("Pick a vendor"); return; }
    if (!editing.line_items?.length) { toast.error("Add at least one line"); return; }
    setBusy(true);
    try {
      const body = {
        vendor_id: editing.vendor_id,
        notes: editing.notes || "",
        status: saveAs,
        po_date: editing.po_date || undefined,
        expected_delivery: editing.expected_delivery || undefined,
        line_items: editing.line_items.map(li => ({
          product_id: li.product_id, quantity: Number(li.quantity) || 0, unit_price: Number(li.unit_price) || 0,
        })),
      };
      if (isEdit) await api.put(`/purchase-orders/${editing.id}`, body);
      else await api.post("/purchase-orders", body);
      toast.success(isEdit ? "PO updated" : "PO created");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle className="font-display">{isEdit ? "Edit Purchase Order" : "New Purchase Order"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label>Vendor</Label>
              <Select value={editing.vendor_id} onValueChange={(v) => setEditing({ ...editing, vendor_id: v })}>
                <SelectTrigger data-testid="po-vendor-select"><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>PO Date</Label>
              <Input type="date" value={editing.po_date || ""} onChange={(e) => setEditing({ ...editing, po_date: e.target.value })} data-testid="po-date-input" />
            </div>
            <div>
              <Label>Expected Delivery</Label>
              <Input type="date" value={editing.expected_delivery || ""} onChange={(e) => setEditing({ ...editing, expected_delivery: e.target.value })} data-testid="po-expected-input" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} placeholder="Delivery instructions…" data-testid="po-notes-input" />
            </div>
          </div>

          <div className="rounded-md border border-border">
            <div className="px-3 py-2 bg-muted/40">
              <Label>Add SKU</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SKU or product name…" className="mt-1" data-testid="po-search-input" />
              {filtered.length > 0 && (
                <div className="mt-2 rounded border border-border max-h-48 overflow-y-auto bg-background">
                  {filtered.map(p => (
                    <button key={p.id} onClick={() => addLine(p)} className="block w-full text-left px-3 py-1.5 hover:bg-muted text-sm border-b border-border last:border-b-0" data-testid={`po-add-${p.sku}`}>
                      <span className="font-mono text-xs text-muted-foreground mr-2">{p.sku}</span>{p.name}
                      <span className="float-right tabular-nums text-xs">{formatINR(p.landing_price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/20 border-t border-border">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(editing.line_items || []).map((li) => (
                  <tr key={li.product_id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{li.sku}</td>
                    <td className="px-3 py-2">{li.product_name}</td>
                    <td className="px-3 py-2 text-right">
                      <Input type="number" inputMode="numeric" min={1} value={li.quantity ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => updateLine(li.product_id, "quantity", e.target.value)} className="w-20 ml-auto h-8" data-testid={`po-qty-${li.sku}`} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input type="number" inputMode="decimal" min={0} step="0.01" value={li.unit_price ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => updateLine(li.product_id, "unit_price", e.target.value)} className="w-24 ml-auto h-8" data-testid={`po-rate-${li.sku}`} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR((Number(li.quantity) || 0) * (Number(li.unit_price) || 0))}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeLine(li.product_id)} className="rounded p-1 hover:bg-destructive/10 text-destructive" data-testid={`po-remove-${li.sku}`}><Trash size={14} /></button>
                    </td>
                  </tr>
                ))}
                {(editing.line_items || []).length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No items yet — search above to add.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40 border-t border-border font-medium">
                  <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={() => save("draft")} disabled={busy} data-testid="po-save-draft-btn">
            <FloppyDisk size={14} className="mr-1" /> Save Draft
          </Button>
          <Button onClick={() => save("sent")} disabled={busy} data-testid="po-save-send-btn">Save & Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
