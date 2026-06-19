import React, { useEffect, useState } from "react";
import api, { formatINR, API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Receipt, Plus, FilePdf, Eye } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const STATUS_TONE = {
  draft: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  issued: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export default function DebitNotes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const q = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const r = await api.get(`/debit-notes${q}`);
      setNotes(r.data);
    } catch (e) { toast.error("Failed to load debit notes"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [statusFilter]);

  return (
    <div className="space-y-6" data-testid="debit-notes-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Returns</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Debit Notes</h1>
          <p className="text-sm text-muted-foreground mt-1">Vendor returns. Reduces hub stock automatically on issue.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9 text-sm" data-testid="dn-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setOpen(true)} data-testid="dn-new-btn"><Plus size={14} className="mr-1" /> New Debit Note</Button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">DN #</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && notes.length === 0 && (
              <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">
                <Receipt size={32} className="mx-auto mb-2 opacity-50" /> No debit notes yet.
              </td></tr>
            )}
            {notes.map((n) => (
              <tr key={n.id} className="border-t border-border hover:bg-muted/30" data-testid={`dn-row-${n.id}`}>
                <td className="px-4 py-3 font-mono text-xs">{n.dn_number || <span className="text-muted-foreground">DRAFT</span>}</td>
                <td className="px-4 py-3 text-xs">{n.dn_date}</td>
                <td className="px-4 py-3 text-xs">{n.vendor_name}</td>
                <td className="px-4 py-3 text-xs"><Badge variant="outline" className="text-[10px]">{n.source_type}</Badge></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatINR(n.grand_total)}</td>
                <td className="px-4 py-3"><Badge className={STATUS_TONE[n.status] || ""}>{n.status}</Badge></td>
                <td className="px-4 py-3 text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/debit-notes/${n.id}`)} data-testid={`dn-view-${n.id}`}><Eye size={12} /></Button>
                  {n.status === "issued" && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`${API_BASE}/debit-notes/${n.id}/pdf`} target="_blank" rel="noreferrer"><FilePdf size={12} /></a>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && <NewDebitNoteDialog onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); navigate(`/debit-notes/${id}`); }} />}
    </div>
  );
}

function NewDebitNoteDialog({ onClose, onCreated }) {
  const [mode, setMode] = useState("purchase_order");
  const [vendors, setVendors] = useState([]);
  const [pos, setPos] = useState([]);
  const [vendorId, setVendorId] = useState("");
  const [poId, setPoId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/vendors").then((r) => setVendors(r.data));
    api.get("/purchase-orders").then((r) => setPos(r.data.filter(p => p.status !== "cancelled")));
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const body = mode === "purchase_order"
        ? { source_type: "purchase_order", po_id: poId, reason }
        : { source_type: "manual", vendor_id: vendorId, reason };
      const r = await api.post("/debit-notes", body);
      toast.success("Debit note created");
      onCreated(r.data.id);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const canSubmit = mode === "purchase_order" ? !!poId : !!vendorId;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="new-dn-dialog">
        <DialogHeader><DialogTitle className="font-display">New Debit Note</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === "purchase_order" ? "default" : "outline"} onClick={() => setMode("purchase_order")} size="sm" data-testid="dn-mode-po">Against Purchase Order</Button>
            <Button variant={mode === "manual" ? "default" : "outline"} onClick={() => setMode("manual")} size="sm" data-testid="dn-mode-manual">Manual</Button>
          </div>
          {mode === "purchase_order" ? (
            <div>
              <Label>Purchase Order</Label>
              <Select value={poId} onValueChange={setPoId}>
                <SelectTrigger data-testid="dn-po-select"><SelectValue placeholder="Pick a PO" /></SelectTrigger>
                <SelectContent>
                  {pos.map((p) => <SelectItem key={p.id} value={p.id}>{p.po_number} · {p.vendor_name} · {formatINR(p.total_amount)}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-[11px] text-muted-foreground mt-1">Lines from PO will be pre-filled. Edit qty/items in the next step.</div>
            </div>
          ) : (
            <div>
              <Label>Vendor <span className="text-rose-600">*</span></Label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger data-testid="dn-vendor-select"><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name} ({v.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong items, defective, excess delivery" data-testid="dn-reason-input" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || busy} data-testid="dn-create-btn">{busy ? "Creating…" : "Create Draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
