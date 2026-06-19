import React, { useEffect, useMemo, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  Plus, Lightning, Package, CheckCircle, Truck, Flag, X, Warning, Stack,
  ArrowsClockwise, XCircle, MagicWand, Hourglass, Camera, FileXls, Keyboard, Paperclip,
} from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import DateFilter, { dateQuery } from "@/components/DateFilter";
import { BACKEND_URL } from "@/lib/api";

const STATUSES = [
  "pending",
  "partially_fulfilled",
  "awaiting_stock",
  "fulfilled",
  "dispatched",
  "delivered",
];
const STATUS_META = {
  pending: { label: "Pending Review", color: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30", icon: Hourglass },
  partially_fulfilled: { label: "Partially Allocated", color: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", icon: ArrowsClockwise },
  awaiting_stock: { label: "Awaiting Stock", color: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30", icon: Warning },
  fulfilled: { label: "Ready to Dispatch", color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", icon: CheckCircle },
  dispatched: { label: "Dispatched", color: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30", icon: Truck },
  delivered: { label: "Delivered", color: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/30", icon: Package },
  rejected: { label: "Rejected", color: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30", icon: XCircle },
  cancelled: { label: "Cancelled", color: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/30", icon: XCircle },
};

const FULFILLABLE = new Set(["pending", "partially_fulfilled", "awaiting_stock"]);

export default function Indents() {
  const { user } = useAuth();
  const isFranchiseMgr = user?.role === "franchise_manager";
  const canFulfill = ["super_admin", "warehouse_manager"].includes(user?.role);

  const [indents, setIndents] = useState([]);
  const [products, setProducts] = useState([]);
  const [franchises, setFranchises] = useState([]);
  const [hubStockMap, setHubStockMap] = useState({}); // product_id -> qty (admin/wh only)
  const [dateRange, setDateRange] = useState({ preset: "all", from: "", to: "" });
  const [sourceFilter, setSourceFilter] = useState("");

  // Dialogs
  const [creating, setCreating] = useState(false);
  const [newIndent, setNewIndent] = useState({ franchise_id: "", priority: "routine", notes: "", line_items: [] });
  const [pickProduct, setPickProduct] = useState("");
  const [pickQty, setPickQty] = useState(1);

  const [fulfillFor, setFulfillFor] = useState(null);
  const [fulfillQtys, setFulfillQtys] = useState({}); // product_id -> qty
  const [submitting, setSubmitting] = useState(false);

  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const [dispatchFor, setDispatchFor] = useState(null);
  const [dispatchData, setDispatchData] = useState({ transporter_name: "", vehicle_number: "", lr_number: "", eway_bill_number: "" });

  const load = async () => {
    const q = dateQuery(dateRange);
    if (sourceFilter) q.source = sourceFilter;
    const params = new URLSearchParams(q).toString();
    const url = params ? `/filtered/indents?${params}` : "/indents";
    const r = await api.get(url);
    setIndents(r.data);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateRange, sourceFilter]);

  useEffect(() => {
    api.get("/products?limit=500").then((r) => {
      setProducts(r.data);
      if (!isFranchiseMgr) {
        const map = {};
        r.data.forEach((p) => { map[p.id] = p.hub_stock ?? 0; });
        setHubStockMap(map);
      }
    });
    if (!isFranchiseMgr) api.get("/franchises").then((r) => setFranchises(r.data));
    // eslint-disable-next-line
  }, []);

  const grouped = useMemo(() => {
    const g = {};
    STATUSES.forEach((s) => (g[s] = []));
    indents.forEach((i) => {
      if (g[i.status]) g[i.status].push(i);
    });
    return g;
  }, [indents]);

  // ---- New indent ----
  const addLine = () => {
    if (!pickProduct) return;
    const p = products.find((x) => x.id === pickProduct);
    if (!p) return;
    setNewIndent((s) => ({
      ...s,
      line_items: [...s.line_items, { product_id: p.id, product_name: p.name, sku: p.sku, requested_qty: pickQty, unit_price: p.franchise_price ?? 0 }],
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

  // ---- Fulfill ----
  const openFulfill = (indent) => {
    setFulfillFor(indent);
    const init = {};
    indent.line_items.forEach((li) => {
      const pending = (li.requested_qty || 0) - (li.allocated_qty || 0);
      if (pending > 0) init[li.product_id] = 0;
    });
    setFulfillQtys(init);
  };

  const autofillMax = () => {
    if (!fulfillFor) return;
    const next = {};
    fulfillFor.line_items.forEach((li) => {
      const pending = (li.requested_qty || 0) - (li.allocated_qty || 0);
      if (pending > 0) {
        const avail = hubStockMap[li.product_id] ?? 0;
        next[li.product_id] = Math.max(0, Math.min(pending, avail));
      }
    });
    setFulfillQtys(next);
  };

  const submitFulfill = async () => {
    if (!fulfillFor) return;
    const items = Object.entries(fulfillQtys)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([product_id, fulfill_qty]) => ({ product_id, fulfill_qty: Number(fulfill_qty) }));
    if (items.length === 0) return toast.error("Enter at least one fulfillment quantity");
    setSubmitting(true);
    try {
      const r = await api.post(`/indents/${fulfillFor.id}/fulfill`, { items });
      toast.success(`Allocated. Status: ${r.data.status} · ${r.data.fulfillment_ratio}%`);
      setFulfillFor(null);
      setFulfillQtys({});
      // Refresh products to get latest hub_stock
      const pr = await api.get("/products?limit=500");
      setProducts(pr.data);
      const map = {};
      pr.data.forEach((p) => { map[p.id] = p.hub_stock ?? 0; });
      setHubStockMap(map);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Reject ----
  const submitReject = async () => {
    if (!rejectFor) return;
    try {
      const fd = new FormData();
      fd.append("reason", rejectReason);
      await api.post(`/indents/${rejectFor.id}/reject`, fd);
      toast.success("Indent rejected. Franchise notified.");
      setRejectFor(null);
      setRejectReason("");
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  // ---- Dispatch / Deliver ----
  const dispatch = async () => {
    try {
      const fd = new FormData();
      Object.entries(dispatchData).forEach(([k, v]) => fd.append(k, v));
      await api.post(`/indents/${dispatchFor.id}/dispatch`, fd);
      toast.success("Dispatched · DC generated");
      setDispatchFor(null);
      setDispatchData({ transporter_name: "", vehicle_number: "", lr_number: "", eway_bill_number: "" });
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };
  const deliver = async (id) => {
    try {
      await api.post(`/indents/${id}/deliver`);
      toast.success("Delivered · Invoice generated");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  // Live remaining hub stock during fulfill modal interaction
  const liveStockFor = (productId) => {
    const base = hubStockMap[productId] ?? 0;
    const used = Number(fulfillQtys[productId] || 0);
    return base - used;
  };

  // ---- Sub-component: Indent Card ----
  const IndentCard = ({ i }) => {
    const meta = STATUS_META[i.status] || STATUS_META.pending;
    const Icon = meta.icon || Stack;
    const pendingItems = i.line_items.filter((li) => (li.requested_qty - (li.allocated_qty || 0)) > 0).length;
    return (
      <div className="border border-border rounded-md p-3 bg-background lift-on-hover" data-testid={`indent-${i.indent_number}`}>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[11px] text-muted-foreground">{i.indent_number}</div>
          <div className="flex items-center gap-1">
            {i.source && i.source !== "system" && (
              <Badge variant="outline" className={`text-[9px] ${i.source === "photo" ? "bg-violet-500/10 text-violet-600 border-violet-500/30" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"}`}>
                {i.source === "photo" ? <Camera size={9} className="mr-0.5" /> : <FileXls size={9} className="mr-0.5" />}
                {i.source.toUpperCase()}
              </Badge>
            )}
            {i.source_attachment_url && (
              <a href={`${BACKEND_URL}${i.source_attachment_url}`} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="View original" data-testid={`view-source-${i.indent_number}`}>
                <Paperclip size={12} />
              </a>
            )}
            {i.priority === "urgent" && (
              <Badge variant="destructive" className="text-[10px]"><Flag size={10} className="mr-1" />URGENT</Badge>
            )}
          </div>
        </div>
        <div className="mt-1 text-sm font-medium leading-tight">{i.franchise_name}</div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{i.line_items.length} items</span>
          <span className="tabular-nums font-medium">{formatINR(i.total_amount)}</span>
        </div>

        {/* Fulfillment progress bar */}
        {i.status !== "pending" && i.status !== "rejected" && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Fulfilled</span>
              <span className="tabular-nums">{i.fulfillment_ratio || 0}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded overflow-hidden">
              <div
                className={`h-full ${i.fulfillment_ratio >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${Math.min(100, i.fulfillment_ratio || 0)}%` }}
              />
            </div>
          </div>
        )}

        {pendingItems > 0 && i.status === "partially_fulfilled" && (
          <div className="mt-2 text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <Warning size={10} /> {pendingItems} item(s) on backorder
          </div>
        )}

        {i.status === "rejected" && i.rejection_reason && (
          <div className="mt-2 text-[10px] text-rose-700 dark:text-rose-400 line-clamp-2">
            <XCircle size={10} className="inline mr-1" />{i.rejection_reason}
          </div>
        )}

        <div className="mt-3 flex gap-1 flex-wrap">
          {FULFILLABLE.has(i.status) && canFulfill && (
            <>
              <Button size="sm" className="h-7 text-xs flex-1" onClick={() => openFulfill(i)} data-testid={`fulfill-${i.indent_number}`}>
                <MagicWand size={12} className="mr-1" />Fulfill
              </Button>
              {(i.status === "pending" || i.status === "awaiting_stock") && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setRejectFor(i)} data-testid={`reject-${i.indent_number}`}>
                  <XCircle size={12} />
                </Button>
              )}
            </>
          )}
          {(i.status === "fulfilled" || i.status === "partially_fulfilled") && canFulfill && (
            <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => setDispatchFor(i)} data-testid={`dispatch-${i.indent_number}`}>
              <Truck size={12} className="mr-1" />Dispatch
            </Button>
          )}
          {i.status === "dispatched" && (
            <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => deliver(i.id)} data-testid={`deliver-${i.indent_number}`}>
              <Package size={12} className="mr-1" />Receive
            </Button>
          )}
        </div>
      </div>
    );
  };

  // ---- Render ----
  // For franchise users, simpler list view (no kanban, no hub stock)
  if (isFranchiseMgr) {
    return (
      <div className="space-y-6" data-testid="indents-page">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">My Orders</div>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">My Indents</h1>
            <p className="text-sm text-muted-foreground mt-1">Raise indents and track their fulfillment status.</p>
          </div>
          <div className="flex items-center gap-2">
            <DateFilter value={dateRange} onChange={setDateRange} storageKey="df:indents-fr" />
            <Link to="/indents/new"><Button data-testid="new-indent-btn"><Plus size={14} className="mr-2" /> New Order</Button></Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {indents.length === 0 && (
            <div className="col-span-full text-center text-sm text-muted-foreground py-12 border border-dashed border-border rounded">
              No indents yet. Raise your first one.
            </div>
          )}
          {indents.map((i) => {
            const meta = STATUS_META[i.status] || STATUS_META.pending;
            return (
              <div key={i.id} className="border border-border rounded-md p-4 bg-card" data-testid={`indent-${i.indent_number}`}>
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[11px] text-muted-foreground">{i.indent_number}</div>
                  <Badge variant="outline" className={`text-[10px] ${meta.color}`}>{meta.label}</Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {new Date(i.created_at).toLocaleDateString()} · {i.line_items.length} items · {formatINR(i.total_amount)}
                </div>
                {i.status !== "pending" && i.status !== "rejected" && (
                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Fulfilled</span><span className="tabular-nums">{i.fulfillment_ratio || 0}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded overflow-hidden">
                      <div className={`h-full ${i.fulfillment_ratio >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                           style={{ width: `${Math.min(100, i.fulfillment_ratio || 0)}%` }} />
                    </div>
                  </div>
                )}
                {i.status === "rejected" && i.rejection_reason && (
                  <div className="mt-2 text-xs text-rose-700 dark:text-rose-400">Reason: {i.rejection_reason}</div>
                )}
                {i.status === "dispatched" && (
                  <Button size="sm" className="mt-3 w-full" onClick={() => deliver(i.id)} data-testid={`confirm-receive-${i.indent_number}`}>
                    <Package size={12} className="mr-1" /> Confirm Receipt
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Create Indent Dialog (franchise) */}
        <CreateIndentDialog
          open={creating} setOpen={setCreating}
          isFranchiseMgr={isFranchiseMgr}
          franchises={franchises}
          newIndent={newIndent} setNewIndent={setNewIndent}
          products={products}
          pickProduct={pickProduct} setPickProduct={setPickProduct}
          pickQty={pickQty} setPickQty={setPickQty}
          addLine={addLine} removeLine={removeLine}
          submit={submit}
          hideStock={true}
        />
      </div>
    );
  }

  // Warehouse / Admin / Accountant: Kanban view
  return (
    <div className="space-y-6" data-testid="indents-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Fulfillment</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Warehouse Fulfillment Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">Allocate stock, partial fulfill, reject or dispatch indents.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            data-testid="source-filter"
          >
            <option value="">All sources</option>
            <option value="system">System</option>
            <option value="photo">Photo</option>
            <option value="excel">Excel</option>
          </select>
          <DateFilter value={dateRange} onChange={setDateRange} storageKey="df:indents" />
          <Link to="/indents/new"><Button data-testid="new-indent-btn"><Plus size={14} className="mr-2" /> New Order</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
        {STATUSES.map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon || Stack;
          return (
            <div key={s} className="rounded-md border border-border bg-card" data-testid={`column-${s}`}>
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <div className="font-display font-medium text-xs flex items-center gap-1.5">
                  <Icon size={12} /> {meta.label}
                </div>
                <Badge variant="outline" className="text-[10px]">{grouped[s].length}</Badge>
              </div>
              <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto min-h-[100px]">
                {grouped[s].map((i) => <IndentCard key={i.id} i={i} />)}
                {grouped[s].length === 0 && <div className="text-[11px] text-muted-foreground text-center py-4">Empty</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Smart Fulfillment Modal */}
      <Dialog open={!!fulfillFor} onOpenChange={(o) => !o && setFulfillFor(null)}>
        <DialogContent className="max-w-3xl" data-testid="fulfill-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <MagicWand size={18} /> Smart Fulfillment · {fulfillFor?.indent_number}
            </DialogTitle>
            <DialogDescription>
              {fulfillFor?.franchise_name} · {fulfillFor?.priority === "urgent" ? "URGENT" : "Routine"} ·
              Allocate quantity per line. Partial allocation is allowed — backorder will be queued.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-muted-foreground">Hub stock decrements live as you allocate.</div>
            <Button size="sm" variant="outline" onClick={autofillMax} data-testid="autofill-max-btn">
              <MagicWand size={12} className="mr-1" /> Auto-fill Max Available
            </Button>
          </div>

          <div className="border border-border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2">SKU / Item</th>
                  <th className="px-2 py-2 text-right">Requested</th>
                  <th className="px-2 py-2 text-right">Already Allocated</th>
                  <th className="px-2 py-2 text-right">Pending</th>
                  <th className="px-2 py-2 text-right">Hub Stock</th>
                  <th className="px-2 py-2 text-right w-28">Allocate Now</th>
                  <th className="px-2 py-2 text-right">Stock After</th>
                </tr>
              </thead>
              <tbody>
                {fulfillFor?.line_items.map((li) => {
                  const pending = (li.requested_qty || 0) - (li.allocated_qty || 0);
                  const available = hubStockMap[li.product_id] ?? 0;
                  const maxAllowed = Math.min(pending, available);
                  const current = Number(fulfillQtys[li.product_id] || 0);
                  const afterStock = liveStockFor(li.product_id);
                  const isShort = available < pending;
                  return (
                    <tr key={li.product_id} className="border-t border-border" data-testid={`fulfill-row-${li.sku}`}>
                      <td className="px-3 py-2">
                        <div className="font-mono text-[11px] text-muted-foreground">{li.sku}</div>
                        <div className="text-xs leading-tight">{li.product_name}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{li.requested_qty}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{li.allocated_qty || 0}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{pending}</td>
                      <td className={`px-2 py-2 text-right tabular-nums ${isShort ? "text-rose-600 font-semibold" : ""}`}>{available}</td>
                      <td className="px-2 py-2 text-right">
                        {pending === 0 ? (
                          <Badge variant="outline" className="text-[10px]">Done</Badge>
                        ) : (
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={maxAllowed}
                            value={fulfillQtys[li.product_id] ?? ""}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              let raw = e.target.value;
                              if (typeof raw === "string" && raw.length > 1 && raw.startsWith("0") && !raw.startsWith("0.")) {
                                raw = raw.replace(/^0+/, "") || "0";
                              }
                              let v = raw === "" ? 0 : Number(raw);
                              if (Number.isNaN(v) || v < 0) v = 0;
                              if (v > maxAllowed) v = maxAllowed;
                              setFulfillQtys((s) => ({ ...s, [li.product_id]: v }));
                            }}
                            className="h-7 text-xs text-right tabular-nums"
                            data-testid={`fulfill-qty-${li.sku}`}
                          />
                        )}
                      </td>
                      <td className={`px-2 py-2 text-right tabular-nums ${afterStock < 0 ? "text-rose-600" : afterStock === 0 ? "text-amber-600" : ""}`}>
                        {current > 0 ? afterStock : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Full stock</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Partial available</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> Insufficient</span>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFulfillFor(null)}>Cancel</Button>
            <Button onClick={submitFulfill} disabled={submitting} data-testid="confirm-fulfill-btn">
              {submitting ? "Allocating…" : "Confirm Allocation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent data-testid="reject-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><XCircle size={18} /> Reject Indent</DialogTitle>
            <DialogDescription>{rejectFor?.indent_number} · {rejectFor?.franchise_name}</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Reason for rejection</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g., Duplicate of IND-0008 / Franchise credit limit exceeded"
              rows={3}
              data-testid="reject-reason-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button variant="destructive" onClick={submitReject} data-testid="confirm-reject-btn">
              <XCircle size={14} className="mr-1" /> Reject Indent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Indent Dialog */}
      <CreateIndentDialog
        open={creating} setOpen={setCreating}
        isFranchiseMgr={isFranchiseMgr}
        franchises={franchises}
        newIndent={newIndent} setNewIndent={setNewIndent}
        products={products}
        pickProduct={pickProduct} setPickProduct={setPickProduct}
        pickQty={pickQty} setPickQty={setPickQty}
        addLine={addLine} removeLine={removeLine}
        submit={submit}
        hideStock={false}
      />

      {/* Dispatch Dialog */}
      <Dialog open={!!dispatchFor} onOpenChange={(o) => !o && setDispatchFor(null)}>
        <DialogContent data-testid="dispatch-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2"><Truck size={18} /> Dispatch & Generate DC</DialogTitle>
            <DialogDescription>
              {dispatchFor?.indent_number} · {dispatchFor?.franchise_name}
              {dispatchFor?.status === "partially_fulfilled" && (
                <span className="block text-amber-600 dark:text-amber-400 mt-1">
                  ⚠ Partial dispatch — only allocated qty will ship. Backorder remains pending.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground -mt-1">
              <span className="text-rose-600">*</span> Transporter Name is required. All other fields are optional.
            </div>
            <div>
              <Label>Transporter Name <span className="text-rose-600">*</span></Label>
              <Input value={dispatchData.transporter_name} onChange={(e) => setDispatchData({ ...dispatchData, transporter_name: e.target.value })} data-testid="transporter-input" required placeholder="e.g. Blue Dart, VRL Logistics" />
            </div>
            <div><Label>Vehicle Number <span className="text-muted-foreground text-[10px]">(optional)</span></Label><Input value={dispatchData.vehicle_number} onChange={(e) => setDispatchData({ ...dispatchData, vehicle_number: e.target.value })} placeholder="MH-12-AB-1234" /></div>
            <div><Label>LR Number <span className="text-muted-foreground text-[10px]">(optional)</span></Label><Input value={dispatchData.lr_number} onChange={(e) => setDispatchData({ ...dispatchData, lr_number: e.target.value })} /></div>
            <div><Label>E-Way Bill # <span className="text-muted-foreground text-[10px]">(optional)</span></Label><Input value={dispatchData.eway_bill_number} onChange={(e) => setDispatchData({ ...dispatchData, eway_bill_number: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchFor(null)}>Cancel</Button>
            <Button onClick={dispatch} disabled={!dispatchData.transporter_name?.trim()} data-testid="confirm-dispatch-btn"><Truck size={14} className="mr-1" />Dispatch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Create Indent Dialog (shared component) ----
function CreateIndentDialog({
  open, setOpen, isFranchiseMgr, franchises, newIndent, setNewIndent, products,
  pickProduct, setPickProduct, pickQty, setPickQty, addLine, removeLine, submit, hideStock,
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
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
            <Label>Add Items {hideStock && <span className="text-[10px] text-muted-foreground ml-1">(stock availability hidden)</span>}</Label>
            <div className="flex gap-2">
              <Select value={pickProduct} onValueChange={setPickProduct}>
                <SelectTrigger className="flex-1" data-testid="product-picker"><SelectValue placeholder="Pick product" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" inputMode="numeric" value={pickQty ?? ""} min={1} onFocus={(e) => e.target.select()} onChange={(e) => { const v = e.target.value; setPickQty(v === "" ? "" : Math.max(1, Number(v) || 1)); }} className="w-24" data-testid="qty-input" />
              <Button onClick={addLine} variant="outline" data-testid="add-line-btn">Add</Button>
            </div>
            {newIndent.line_items.length > 0 && (
              <div className="border border-border rounded-md p-2 max-h-48 overflow-y-auto">
                {newIndent.line_items.map((li, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 text-xs border-b border-border last:border-0">
                    <div className="flex-1 truncate">{li.sku} — {li.product_name}</div>
                    <div className="w-12 text-right tabular-nums">{li.requested_qty}</div>
                    <div className="w-24 text-right tabular-nums">{formatINR((li.unit_price || 0) * li.requested_qty)}</div>
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
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} data-testid="submit-indent-btn">Submit Indent</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
