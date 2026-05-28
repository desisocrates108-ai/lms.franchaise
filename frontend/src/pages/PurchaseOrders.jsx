import React, { useEffect, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Lightning, ClipboardText } from "@phosphor-icons/react";

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
  const canManage = ["super_admin", "warehouse_manager", "hub_accountant"].includes(user?.role);

  const load = () => api.get("/purchase-orders").then((r) => setPos(r.data));
  useEffect(() => { load(); }, []);

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

  return (
    <div className="space-y-6" data-testid="po-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Procurement</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">Auto-draft POs when stock dips below safety threshold.</p>
        </div>
        {canManage && (
          <Button onClick={autoGenerate} disabled={busy} data-testid="auto-generate-po-btn">
            <Lightning size={14} className="mr-2" /> {busy ? "Scanning…" : "Auto-Generate from Low Stock"}
          </Button>
        )}
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
                <td className="px-4 py-3">
                  <Badge variant="outline" className={`text-[11px] ${STATUS_COLOR[po.status]}`}>{po.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {canManage && po.status === "draft" && (
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="outline" onClick={() => setStatus(po.id, "sent")}>Send</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(po.id, "cancelled")}>Cancel</Button>
                    </div>
                  )}
                  {canManage && po.status === "sent" && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(po.id, "received")}>Mark Received</Button>
                  )}
                </td>
              </tr>
            ))}
            {pos.length === 0 && (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">
                <ClipboardText size={32} className="mx-auto mb-2 opacity-50" />
                No purchase orders yet. Use Auto-Generate to scan low-stock items.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
