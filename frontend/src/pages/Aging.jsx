import React, { useEffect, useState } from "react";
import api, { formatINR, formatNum } from "@/lib/api";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import { ChartBar, WarningCircle } from "@phosphor-icons/react";

const BUCKET_ORDER = ["0-30", "31-90", "91-180", "181-365", "365+"];
const BUCKET_COLORS = {
  "0-30": "hsl(142 76% 36%)",
  "31-90": "hsl(217 91% 60%)",
  "91-180": "hsl(38 92% 50%)",
  "181-365": "hsl(25 95% 53%)",
  "365+": "hsl(0 72% 51%)",
};

export default function Aging() {
  const [data, setData] = useState(null);

  useEffect(() => { api.get("/reports/aging").then((r) => setData(r.data)); }, []);

  if (!data) return <div className="space-y-4"><div className="h-24 shimmer rounded" /><div className="h-72 shimmer rounded" /></div>;

  const chart = BUCKET_ORDER.map((b) => ({ bucket: b, qty: data.buckets[b], value: data.value_buckets[b] }));
  const totalValue = Object.values(data.value_buckets).reduce((a, b) => a + b, 0);
  const deadValue = data.value_buckets["365+"] || 0;

  return (
    <div className="space-y-6" data-testid="aging-page">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Analytics</div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Inventory Aging</h1>
        <p className="text-sm text-muted-foreground mt-1">Categorize hub stock by age. Spot dead stock and recover capital.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-border rounded-md p-5 bg-card">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Total Hub Value</div>
          <div className="font-display text-3xl font-semibold mt-2 tabular-nums">{formatINR(totalValue)}</div>
        </div>
        <div className="border border-border rounded-md p-5 bg-card">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Dead Stock (365+)</div>
          <div className="font-display text-3xl font-semibold mt-2 tabular-nums text-destructive">{formatINR(deadValue)}</div>
        </div>
        <div className="border border-border rounded-md p-5 bg-card">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Items Tracked</div>
          <div className="font-display text-3xl font-semibold mt-2 tabular-nums">{formatNum(data.items.length)}</div>
        </div>
      </div>

      <div className="border border-border rounded-md p-5 bg-card">
        <div className="flex items-center gap-2 mb-4">
          <ChartBar size={16} /> <h2 className="font-display text-base font-medium">Stock Distribution by Age (Value ₹)</h2>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="bucket" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }}
                formatter={(v) => formatINR(v)}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {chart.map((entry) => (
                  <Cell key={entry.bucket} fill={BUCKET_COLORS[entry.bucket]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="border border-border rounded-md bg-card overflow-hidden">
        <div className="border-b border-border px-5 py-3 font-display font-medium">All Items by Bucket</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Age (days)</th>
                <th className="px-4 py-3">Bucket</th>
                <th className="px-4 py-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.items.sort((a, b) => b.age_days - a.age_days).slice(0, 100).map((it) => (
                <tr key={it.product_id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{it.sku}</td>
                  <td className="px-4 py-3">{it.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{it.qty}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{it.age_days}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: BUCKET_COLORS[it.bucket], color: BUCKET_COLORS[it.bucket] }}>
                      {it.bucket}
                      {it.bucket === "365+" && <WarningCircle size={10} className="inline ml-1" />}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatINR(it.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
