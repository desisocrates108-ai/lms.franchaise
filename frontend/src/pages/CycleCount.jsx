import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ListMagnifyingGlass, Sparkle, CheckCircle } from "@phosphor-icons/react";

export default function CycleCount() {
  const [list, setList] = useState([]);
  const [type, setType] = useState("weekly");
  const [count, setCount] = useState(5);
  const [open, setOpen] = useState(null);
  const [counts, setCounts] = useState({});

  const load = () => api.get("/cycle-counts").then((r) => setList(r.data));
  useEffect(() => { load(); }, []);

  const generate = async () => {
    try {
      const fd = new FormData();
      fd.append("type", type);
      fd.append("count", String(count));
      await api.post("/cycle-counts/generate", fd);
      toast.success("Random batch generated");
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  const submit = async () => {
    try {
      const items = open.items.map((it) => ({
        product_id: it.product_id,
        counted_qty: Number(counts[it.product_id] ?? it.system_qty),
      }));
      await api.post(`/cycle-counts/${open.id}/submit`, { items });
      toast.success("Submitted. Stock adjusted to match.");
      setOpen(null);
      setCounts({});
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-6" data-testid="cyclecount-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Audit Control</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Blind Cycle Counting</h1>
          <p className="text-sm text-muted-foreground mt-1">System randomly selects SKUs for physical verification.</p>
        </div>
      </div>

      <div className="border border-border rounded-md p-5 bg-card flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-0 max-w-xs">
          <Label>Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger data-testid="cc-type-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>SKUs to count</Label>
          <Input type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-28" data-testid="cc-count-input" />
        </div>
        <Button onClick={generate} data-testid="generate-cc-btn"><Sparkle size={14} className="mr-2" /> Generate Random Batch</Button>
      </div>

      <div className="rounded-md border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">CC #</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Items</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((cc) => (
              <tr key={cc.id} className="border-t border-border hover:bg-muted/30" data-testid={`cc-row-${cc.cc_number}`}>
                <td className="px-4 py-3 font-mono text-xs">{cc.cc_number}</td>
                <td className="px-4 py-3 capitalize">{cc.type}</td>
                <td className="px-4 py-3">{cc.items.length}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={cc.status === "completed" ? "text-emerald-600 border-emerald-500/30" : ""}>
                    {cc.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{(cc.created_at || "").slice(0, 10)}</td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" onClick={() => { setOpen(cc); setCounts({}); }} data-testid={`open-cc-${cc.cc_number}`}>
                    {cc.status === "completed" ? "View" : "Enter Counts"}
                  </Button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">
                <ListMagnifyingGlass size={32} className="mx-auto mb-2 opacity-50" />
                Generate a random batch to begin audit.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="cc-detail-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Cycle Count — {open?.cc_number}</DialogTitle>
          </DialogHeader>
          {open && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                <th className="py-2">SKU</th>
                <th className="py-2">Name</th>
                <th className="py-2 text-right">System Qty</th>
                <th className="py-2 text-right">Counted</th>
                <th className="py-2 text-right">Variance</th>
              </tr></thead>
              <tbody>
                {open.items.map((it) => {
                  const counted = counts[it.product_id] ?? it.counted_qty ?? "";
                  const variance = counted !== "" ? Number(counted) - it.system_qty : (it.variance ?? "");
                  return (
                    <tr key={it.product_id} className="border-b border-border">
                      <td className="py-2 font-mono text-xs">{it.sku}</td>
                      <td className="py-2">{it.product_name}</td>
                      <td className="py-2 text-right tabular-nums">{it.system_qty}</td>
                      <td className="py-2 text-right">
                        {open.status === "completed" ? (
                          <span className="tabular-nums">{it.counted_qty}</span>
                        ) : (
                          <Input
                            type="number"
                            className="w-20 h-8 text-right ml-auto"
                            value={counted}
                            onChange={(e) => setCounts({ ...counts, [it.product_id]: e.target.value })}
                            data-testid={`count-${it.sku}`}
                          />
                        )}
                      </td>
                      <td className={`py-2 text-right tabular-nums ${variance < 0 ? "text-destructive" : variance > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {variance === "" ? "—" : (variance > 0 ? `+${variance}` : variance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {open?.status !== "completed" && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
              <Button onClick={submit} data-testid="submit-cc-btn"><CheckCircle size={14} className="mr-2" />Submit & Adjust</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
