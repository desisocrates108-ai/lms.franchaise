import React, { useEffect, useMemo, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Plus, Lightning, Package, CheckCircle, Truck, Flag, X } from "@phosphor-icons/react";

const STATUSES = ["requested", "approved", "dispatched", "delivered"];
const STATUS_META = {
  requested: { label: "Requested", color: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  approved: { label: "Approved", color: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  dispatched: { label: "Dispatched", color: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30" },
  delivered: { label: "Delivered", color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
};

export default function Indents() {
  const { user } = useAuth();
  const [indents, setIndents] = useState([]);
  const [products, setProducts] = useState([]);
  const [franchises, setFranchises] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newIndent, setNewIndent] = useState({ franchise_id: "", priority: "routine", notes: "", line_items: [] });
  const [pickProduct, setPickProduct] = useState("");
  const [pickQty, setPickQty] = useState(1);
  const [dispatchFor, setDispatchFor] = useState(null);
  const [dispatchData, setDispatchData] = useState({ transporter_name: "", vehicle_number: "", lr_number: "", eway_bill_number: "" });

  const load = async () => {
    const r = await api.get("/indents");
    setIndents(r.data);
  };
  useEffect(() => {
    load();
    api.get("/products?limit=500").then((r) => setProducts(r.data));
    api.get("/franchises").then((r) => setFranchises(r.data));
  }, []);

  const grouped = useMemo(() => {
    const g = { requested: [], approved: [], dispatched: [], delivered: [] };
    indents.forEach((i) => { if (g[i.status]) g[i.status].push(i); });
    return g;
  }, [indents]);

  const isFranchiseMgr = user?.role === "franchise_manager";

  const addLine = () => {
    if (!pickProduct) return;
    const p = products.find((x) => x.id === pickProduct);
    if (!p) return;
    setNewIndent((s) => ({
      ...s,
      line_items: [...s.line_items, { product_id: p.id, product_name: p.name, sku: p.sku, requested_qty: pickQty, unit_price: p.franchise_price }],
    }));
    setPickProduct(""); setPickQty(1);
  };

  const removeLine = (idx) => setNewIndent((s) => ({ ...s, line_items: s.line_items.filter((_, i) => i !== idx) }));

  const submit = async () => {
    try {
      const fid = isFranchiseMgr ? user.franchise_id : newIndent.franchise_id;
      if (!fid) return toast.error("Select a franchise");
      if (newIndent.line_items.length === 0) return toast.error("Add at least 1 line item");
      await api.post("/indents", { ...newIndent, franchise_id: fid });
      toast.success("Indent raised");
      setCreating(false);
      setNewIndent({ franchise_id: "", priority: "routine", notes: "", line_items: [] });
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const approve = async (id) => {
    try {
      const r = await api.post(`/indents/${id}/approve`);
      toast.success(`Approved · Fulfillment ${r.data.fulfillment_ratio}%`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const dispatch = async () => {
    try {
      const fd = new FormData();
      Object.entries(dispatchData).forEach(([k, v]) => fd.append(k, v));
      await api.post(`/indents/${dispatchFor.id}/dispatch`, fd);
      toast.success("Dispatched. DC generated.");
      setDispatchFor(null);
      setDispatchData({ transporter_name: "", vehicle_number: "", lr_number: "", eway_bill_number: "" });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const deliver = async (id) => {
    try {
      await api.post(`/indents/${id}/deliver`);
      toast.success("Marked delivered. Invoice generated.");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-6" data-testid="indents-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Fulfillment</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Franchise Indents</h1>
          <p className="text-sm text-muted-foreground mt-1">Kanban view · Requested → Approved → Dispatched → Delivered.</p>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="new-indent-btn"><Plus size={14} className="mr-2" /> Raise Indent</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-md border border-border bg-card" data-testid={`column-${s}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="font-display font-medium text-sm flex items-center gap-2">
                {s === "requested" && <Lightning size={14} />}
                {s === "approved" && <CheckCircle size={14} />}
                {s === "dispatched" && <Truck size={14} />}
                {s === "delivered" && <Package size={14} />}
                {STATUS_META[s].label}
              </div>
              <Badge variant="outline" className="text-[11px]">{grouped[s].length}</Badge>
            </div>
            <div className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
              {grouped[s].map((i) => (
                <div key={i.id} className="border border-border rounded p-3 bg-background lift-on-hover" data-testid={`indent-${i.indent_number}`}>
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[11px] text-muted-foreground">{i.indent_number}</div>
                    {i.priority === "urgent" && (
                      <Badge variant="destructive" className="text-[10px]"><Flag size={10} className="mr-1" />URGENT</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-medium leading-tight">{i.franchise_name}</div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{i.line_items.length} items</span>
                    <span className="tabular-nums font-medium">{formatINR(i.total_amount)}</span>
                  </div>
                  {i.status !== "requested" && (
                    <div className="mt-2 text-[11px] text-muted-foreground">Fulfillment {i.fulfillment_ratio}%</div>
                  )}
                  <div className="mt-3 flex gap-1">
                    {i.status === "requested" && ["super_admin", "warehouse_manager"].includes(user.role) && (
                      <Button size="sm" className="h-7 text-xs flex-1" onClick={() => approve(i.id)} data-testid={`approve-${i.indent_number}`}>Approve</Button>
                    )}
                    {i.status === "approved" && ["super_admin", "warehouse_manager"].includes(user.role) && (
                      <Button size="sm" className="h-7 text-xs flex-1" onClick={() => setDispatchFor(i)} data-testid={`dispatch-${i.indent_number}`}>Dispatch</Button>
                    )}
                    {i.status === "dispatched" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => deliver(i.id)} data-testid={`deliver-${i.indent_number}`}>Mark Delivered</Button>
                    )}
                  </div>
                </div>
              ))}
              {grouped[s].length === 0 && <div className="text-xs text-muted-foreground text-center py-6">Empty</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Create Indent Dialog */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent className="max-w-2xl" data-testid="create-indent-dialog">
          <DialogHeader><DialogTitle className="font-display">Raise New Indent</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!isFranchiseMgr && (
              <div>
                <Label>Franchise</Label>
                <Select value={newIndent.franchise_id} onValueChange={(v) => setNewIndent({ ...newIndent, franchise_id: v })}>
                  <SelectTrigger data-testid="franchise-select"><SelectValue placeholder="Select franchise" /></SelectTrigger>
                  <SelectContent>
                    {franchises.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Priority</Label>
              <Select value={newIndent.priority} onValueChange={(v) => setNewIndent({ ...newIndent, priority: v })}>
                <SelectTrigger data-testid="priority-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="routine">Routine</SelectItem>
                  <SelectItem value="urgent">Urgent — Vehicle Down</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Add Items</Label>
              <div className="flex gap-2">
                <Select value={pickProduct} onValueChange={setPickProduct}>
                  <SelectTrigger className="flex-1" data-testid="product-picker"><SelectValue placeholder="Pick product" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input type="number" value={pickQty} min={1} onChange={(e) => setPickQty(Number(e.target.value))} className="w-24" data-testid="qty-input" />
                <Button onClick={addLine} variant="outline" data-testid="add-line-btn">Add</Button>
              </div>
              {newIndent.line_items.length > 0 && (
                <div className="border border-border rounded-md p-2 max-h-48 overflow-y-auto">
                  {newIndent.line_items.map((li, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 text-xs border-b border-border last:border-0">
                      <div className="flex-1 truncate">{li.sku} — {li.product_name}</div>
                      <div className="w-12 text-right tabular-nums">{li.requested_qty}</div>
                      <div className="w-24 text-right tabular-nums">{formatINR(li.unit_price * li.requested_qty)}</div>
                      <button onClick={() => removeLine(i)} className="ml-2 text-muted-foreground hover:text-destructive"><X size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={newIndent.notes} onChange={(e) => setNewIndent({ ...newIndent, notes: e.target.value })} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={submit} data-testid="submit-indent-btn">Submit Indent</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispatch Dialog */}
      <Dialog open={!!dispatchFor} onOpenChange={(o) => !o && setDispatchFor(null)}>
        <DialogContent data-testid="dispatch-dialog">
          <DialogHeader><DialogTitle className="font-display">Dispatch & Generate DC</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Indent: {dispatchFor?.indent_number} · {dispatchFor?.franchise_name}</div>
            <div><Label>Transporter Name</Label><Input value={dispatchData.transporter_name} onChange={(e) => setDispatchData({ ...dispatchData, transporter_name: e.target.value })} data-testid="transporter-input" /></div>
            <div><Label>Vehicle Number</Label><Input value={dispatchData.vehicle_number} onChange={(e) => setDispatchData({ ...dispatchData, vehicle_number: e.target.value })} placeholder="MH-12-AB-1234" /></div>
            <div><Label>LR Number</Label><Input value={dispatchData.lr_number} onChange={(e) => setDispatchData({ ...dispatchData, lr_number: e.target.value })} /></div>
            <div><Label>E-Way Bill #</Label><Input value={dispatchData.eway_bill_number} onChange={(e) => setDispatchData({ ...dispatchData, eway_bill_number: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchFor(null)}>Cancel</Button>
            <Button onClick={dispatch} data-testid="confirm-dispatch-btn">Dispatch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
