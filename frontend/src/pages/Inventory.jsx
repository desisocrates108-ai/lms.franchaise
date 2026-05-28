import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { formatINR, formatNum } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { MagnifyingGlass, Funnel, Package, MapPin } from "@phosphor-icons/react";

export default function Inventory() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(params.get("q") || "");
  const [showLow, setShowLow] = useState(false);
  const [editing, setEditing] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const canEdit = ["super_admin", "warehouse_manager"].includes(user?.role);

  const load = async () => {
    setLoading(true);
    const r = await api.get("/products", { params: { q, low_stock: showLow, limit: 500 } });
    setProducts(r.data);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q, showLow]);

  const saveEdit = async () => {
    try {
      await api.put(`/products/${editing.id}`, editing);
      toast.success("Product updated");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const submitAdjust = async () => {
    try {
      const fd = new FormData();
      fd.append("delta", String(adjust.delta));
      fd.append("location_type", "hub");
      fd.append("location_id", "hub-main");
      fd.append("reason", adjust.reason || "");
      await api.post(`/products/${adjust.id}/adjust-stock`, fd);
      toast.success("Stock adjusted");
      setAdjust(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div className="space-y-6" data-testid="inventory-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Catalog</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Inventory</h1>
          <p className="text-sm text-muted-foreground mt-1">Unified multi-tier stock — hub & franchises.</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, part number, barcode…" className="pl-9 w-72" data-testid="inventory-search" />
          </div>
          <Button variant={showLow ? "default" : "outline"} onClick={() => setShowLow((s) => !s)} data-testid="filter-low-stock">
            <Funnel size={14} className="mr-2" /> Low Stock
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="inventory-table">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">SKU / Name</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Rack</th>
                <th className="px-4 py-3 font-medium text-right">Hub</th>
                <th className="px-4 py-3 font-medium text-right">Franchises</th>
                <th className="px-4 py-3 font-medium text-right">Landing</th>
                <th className="px-4 py-3 font-medium text-right">Franchise Price</th>
                <th className="px-4 py-3 font-medium text-right">MRP</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && products.length === 0 && (
                <tr><td colSpan={9} className="p-12 text-center text-muted-foreground">
                  <Package size={32} className="mx-auto mb-2 opacity-50" />
                  No products match.
                </td></tr>
              )}
              {products.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30 transition-colors" data-testid={`product-row-${p.sku}`}>
                  <td className="px-4 py-3">
                    <div className="font-mono text-[11px] text-muted-foreground">{p.sku}</div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">{p.brand} · {p.part_number_oem}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-[11px]">{p.category}</Badge>
                    <div className="text-[11px] text-muted-foreground mt-1">{p.subcategory}</div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    <MapPin size={12} className="inline mr-1" />{p.rack_location}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <div className={`font-semibold ${p.low_stock ? "text-destructive" : ""}`}>{formatNum(p.hub_stock)}</div>
                    <div className="text-[11px] text-muted-foreground">min {p.safety_stock}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatNum(p.franchise_stock)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatINR(p.landing_price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatINR(p.franchise_price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatINR(p.mrp)}</td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setAdjust({ ...p, delta: 0, reason: "" })} data-testid={`adjust-${p.sku}`}>Adjust</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)} data-testid={`edit-${p.sku}`}>Edit</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl" data-testid="edit-product-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Edit Product</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>SKU</Label><Input value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} /></div>
              <div><Label>Brand</Label><Input value={editing.brand} onChange={(e) => setEditing({ ...editing, brand: e.target.value })} /></div>
              <div><Label>Category</Label><Input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></div>
              <div><Label>Rack Location</Label><Input value={editing.rack_location} onChange={(e) => setEditing({ ...editing, rack_location: e.target.value })} /></div>
              <div><Label>HSN Code</Label><Input value={editing.hsn_code} onChange={(e) => setEditing({ ...editing, hsn_code: e.target.value })} /></div>
              <div><Label>Landing Price</Label><Input type="number" value={editing.landing_price} onChange={(e) => setEditing({ ...editing, landing_price: Number(e.target.value) })} /></div>
              <div><Label>MRP</Label><Input type="number" value={editing.mrp} onChange={(e) => setEditing({ ...editing, mrp: Number(e.target.value) })} /></div>
              <div><Label>Franchise Price</Label><Input type="number" value={editing.franchise_price} onChange={(e) => setEditing({ ...editing, franchise_price: Number(e.target.value) })} /></div>
              <div><Label>Retail Price</Label><Input type="number" value={editing.retail_price} onChange={(e) => setEditing({ ...editing, retail_price: Number(e.target.value) })} /></div>
              <div><Label>Safety Stock</Label><Input type="number" value={editing.safety_stock} onChange={(e) => setEditing({ ...editing, safety_stock: Number(e.target.value) })} /></div>
              <div><Label>Reorder Qty</Label><Input type="number" value={editing.reorder_qty} onChange={(e) => setEditing({ ...editing, reorder_qty: Number(e.target.value) })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} data-testid="save-product-btn">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust stock */}
      <Dialog open={!!adjust} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent data-testid="adjust-stock-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Adjust Hub Stock</DialogTitle>
          </DialogHeader>
          {adjust && (
            <div className="space-y-3">
              <div className="text-sm">
                <div className="font-medium">{adjust.name}</div>
                <div className="text-muted-foreground text-xs">Current: {adjust.hub_stock}</div>
              </div>
              <div>
                <Label>Delta (use negative to reduce)</Label>
                <Input type="number" value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: Number(e.target.value) })} data-testid="adjust-delta-input" />
              </div>
              <div>
                <Label>Reason</Label>
                <Input value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder="e.g., damaged stock returned" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjust(null)}>Cancel</Button>
            <Button onClick={submitAdjust} data-testid="submit-adjust-btn">Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
