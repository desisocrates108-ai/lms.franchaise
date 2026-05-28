import React, { useEffect, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Truck, QrCode, Receipt } from "@phosphor-icons/react";

const STATUS_COLOR = {
  draft: "bg-zinc-500/10 text-zinc-600 border-zinc-500/30",
  dispatched: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  verified: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  invoiced: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};

export default function DeliveryChallans() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);

  useEffect(() => { api.get("/delivery-challans").then((r) => setList(r.data)); }, []);

  return (
    <div className="space-y-6" data-testid="dc-page">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Logistics</div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Delivery Challans & GST Invoices</h1>
        <p className="text-sm text-muted-foreground mt-1">DC → Verified → Tax Invoice pipeline.</p>
      </div>

      <div className="rounded-md border border-border overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3">DC #</th>
              <th className="px-4 py-3">Franchise</th>
              <th className="px-4 py-3">Transporter</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3 text-right">Grand Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Invoice #</th>
            </tr>
          </thead>
          <tbody>
            {list.map((dc) => (
              <tr key={dc.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setOpen(dc)} data-testid={`dc-row-${dc.dc_number}`}>
                <td className="px-4 py-3 font-mono text-xs">{dc.dc_number}</td>
                <td className="px-4 py-3">{dc.franchise_name}</td>
                <td className="px-4 py-3 text-xs">{dc.transporter_name || "—"}</td>
                <td className="px-4 py-3 text-xs font-mono">{dc.vehicle_number || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatINR(dc.grand_total)}</td>
                <td className="px-4 py-3"><Badge variant="outline" className={`text-[11px] ${STATUS_COLOR[dc.status]}`}>{dc.status}</Badge></td>
                <td className="px-4 py-3 font-mono text-xs">{dc.invoice_number || "—"}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7} className="p-12 text-center text-muted-foreground">
                <Truck size={32} className="mx-auto mb-2 opacity-50" />
                No challans yet. Dispatch an indent to auto-generate one.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="dc-detail-dialog">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              {open?.status === "invoiced" ? <Receipt size={18} /> : <Truck size={18} />}
              {open?.status === "invoiced" ? "Tax Invoice" : "Delivery Challan"} — {open?.dc_number}
            </DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><div className="text-xs text-muted-foreground">Franchise</div><div className="font-medium">{open.franchise_name}</div></div>
                <div><div className="text-xs text-muted-foreground">Status</div><Badge variant="outline" className={STATUS_COLOR[open.status]}>{open.status}</Badge></div>
                <div><div className="text-xs text-muted-foreground">Transporter</div><div>{open.transporter_name || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Vehicle</div><div className="font-mono">{open.vehicle_number || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">LR Number</div><div className="font-mono">{open.lr_number || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">E-Way Bill</div><div className="font-mono">{open.eway_bill_number || "—"}</div></div>
              </div>

              <div className="rounded border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.line_items?.map((li, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-2">{li.product_name}<div className="font-mono text-[10px] text-muted-foreground">{li.sku}</div></td>
                        <td className="px-3 py-2 text-right tabular-nums">{li.allocated_qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(li.unit_price)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatINR(li.unit_price * li.allocated_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <div className="w-72 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatINR(open.total_amount)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="tabular-nums">{formatINR(open.cgst)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="tabular-nums">{formatINR(open.sgst)}</span></div>
                  <div className="flex justify-between border-t border-border pt-1 mt-1 font-display font-semibold text-base"><span>Grand Total</span><span className="tabular-nums">{formatINR(open.grand_total)}</span></div>
                </div>
              </div>

              {open.verification_qr && (
                <div className="border border-border rounded p-4 flex items-center gap-3">
                  <QrCode size={32} />
                  <div>
                    <div className="text-xs font-medium">Verification QR</div>
                    <div className="font-mono text-xs text-muted-foreground">{open.verification_qr}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
