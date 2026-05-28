import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CurrencyInr, Lightning } from "@phosphor-icons/react";

export default function Pricing() {
  const [category, setCategory] = useState("__all__");
  const [margin, setMargin] = useState(22);
  const [updateFranchise, setUpdateFranchise] = useState(true);
  const [updateRetail, setUpdateRetail] = useState(true);
  const [categories, setCategories] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/products?limit=500").then((r) => {
      const cats = [...new Set(r.data.map((p) => p.category).filter(Boolean))];
      setCategories(cats);
    });
  }, []);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.post("/products/bulk-margin", {
        category: category === "__all__" ? null : category,
        margin_percent: margin,
        update_franchise_price: updateFranchise,
        update_retail_price: updateRetail,
      });
      toast.success(`Updated ${r.data.updated} products`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-testid="pricing-page">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Engine</div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Dynamic Pricing</h1>
        <p className="text-sm text-muted-foreground mt-1">Apply margin to franchise & retail prices — globally or per category.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 border border-border rounded-md p-6 bg-card space-y-4">
          <h2 className="font-display text-base font-medium flex items-center gap-2"><CurrencyInr size={16} /> Bulk Margin Update</h2>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="category-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Margin % (over landing price)</Label>
            <Input type="number" step="0.5" value={margin} onChange={(e) => setMargin(Number(e.target.value))} data-testid="margin-input" />
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={updateFranchise} onChange={(e) => setUpdateFranchise(e.target.checked)} data-testid="update-franchise-toggle" />
              Update Franchise Price
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={updateRetail} onChange={(e) => setUpdateRetail(e.target.checked)} data-testid="update-retail-toggle" />
              Update Retail Price (margin + 8%)
            </label>
          </div>
          <Button onClick={apply} disabled={busy} data-testid="apply-margin-btn">
            <Lightning size={14} className="mr-2" /> {busy ? "Applying…" : "Apply Margin"}
          </Button>
        </div>

        <div className="border border-border rounded-md p-6 bg-card">
          <h3 className="font-display text-sm font-medium">Pricing Tiers</h3>
          <ul className="mt-3 space-y-3 text-xs">
            <li><div className="font-medium">Landing Price</div><div className="text-muted-foreground">Purchase + tax + freight. Auto-updated on invoice commit.</div></li>
            <li><div className="font-medium">Franchise Transfer Price</div><div className="text-muted-foreground">Landing × (1 + margin%). Used in indents.</div></li>
            <li><div className="font-medium">Customer Retail Price</div><div className="text-muted-foreground">Landing × (1 + margin% + 8%). Final consumer rate.</div></li>
            <li><div className="font-medium">MRP</div><div className="text-muted-foreground">Statutory maximum retail price — set manually.</div></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
