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

export default function CreditNotes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const q = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const r = await api.get(`/credit-notes${q}`);
      setNotes(r.data);
    } catch (e) { toast.error("Failed to load credit notes"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [statusFilter]);

  return (
    <div className="space-y-6" data-testid="credit-notes-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Returns</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Credit Notes</h1>
          <p className="text-sm text-muted-foreground mt-1">Franchise returns. Restocks hub automatically on issue.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9 text-sm" data-testid="cn-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setOpen(true)} data-testid="cn-new-btn"><Plus size={14} className="mr-1" /> New Credit Note</Button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">CN #</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Franchise</th>
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
                <Receipt size={32} className="mx-auto mb-2 opacity-50" /> No credit notes yet.
              </td></tr>
            )}
            {notes.map((n) => (
              <tr key={n.id} className="border-t border-border hover:bg-muted/30" data-testid={`cn-row-${n.id}`}>
                <td className="px-4 py-3 font-mono text-xs">{n.cn_number || <span className="text-muted-foreground">DRAFT</span>}</td>
                <td className="px-4 py-3 text-xs">{n.cn_date}</td>
                <td className="px-4 py-3 text-xs">{n.franchise_name}</td>
                <td className="px-4 py-3 text-xs"><Badge variant="outline" className="text-[10px]">{n.source_type}</Badge></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatINR(n.grand_total)}</td>
                <td className="px-4 py-3"><Badge className={STATUS_TONE[n.status] || ""}>{n.status}</Badge></td>
                <td className="px-4 py-3 text-right space-x-1">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/credit-notes/${n.id}`)} data-testid={`cn-view-${n.id}`}><Eye size={12} /></Button>
                  {n.status === "issued" && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`${API_BASE}/credit-notes/${n.id}/pdf`} target="_blank" rel="noreferrer"><FilePdf size={12} /></a>
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && <NewCreditNoteDialog onClose={() => setOpen(false)} onCreated={(id) => { setOpen(false); navigate(`/credit-notes/${id}`); }} />}
    </div>
  );
}

function NewCreditNoteDialog({ onClose, onCreated }) {
  const [mode, setMode] = useState("invoice");
  const [franchises, setFranchises] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [franchiseId, setFranchiseId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/franchises").then((r) => setFranchises(r.data));
    api.get("/tax-invoices?status=issued").then((r) => setInvoices(r.data)).catch(() => {});
  }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const body = mode === "invoice"
        ? { source_type: "invoice", tax_invoice_id: invoiceId, reason }
        : { source_type: "manual", franchise_id: franchiseId, reason };
      const r = await api.post("/credit-notes", body);
      toast.success("Credit note created");
      onCreated(r.data.id);
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const canSubmit = mode === "invoice" ? !!invoiceId : !!franchiseId;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="new-cn-dialog">
        <DialogHeader><DialogTitle className="font-display">New Credit Note</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === "invoice" ? "default" : "outline"} onClick={() => setMode("invoice")} size="sm" data-testid="cn-mode-invoice">Against Tax Invoice</Button>
            <Button variant={mode === "manual" ? "default" : "outline"} onClick={() => setMode("manual")} size="sm" data-testid="cn-mode-manual">Manual</Button>
          </div>
          {mode === "invoice" ? (
            <div>
              <Label>Tax Invoice</Label>
              <Select value={invoiceId} onValueChange={setInvoiceId}>
                <SelectTrigger data-testid="cn-invoice-select"><SelectValue placeholder="Pick an issued invoice" /></SelectTrigger>
                <SelectContent>
                  {invoices.map((i) => <SelectItem key={i.id} value={i.id}>{i.invoice_number} · {i.franchise_name} · {formatINR(i.grand_total)}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-[11px] text-muted-foreground mt-1">Lines from the invoice will be pre-filled. Edit qty/items in the next step.</div>
            </div>
          ) : (
            <div>
              <Label>Franchise <span className="text-rose-600">*</span></Label>
              <Select value={franchiseId} onValueChange={setFranchiseId}>
                <SelectTrigger data-testid="cn-franchise-select"><SelectValue placeholder="Pick a franchise" /></SelectTrigger>
                <SelectContent>
                  {franchises.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} ({f.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged in transit, wrong items, excess delivery" data-testid="cn-reason-input" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit || busy} data-testid="cn-create-btn">{busy ? "Creating…" : "Create Draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
