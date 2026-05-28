import React, { useEffect, useState } from "react";
import api, { formatINR, formatNum } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Package, CurrencyInr, WarningCircle, ClockCounterClockwise,
  Receipt, CheckCircle, TrendUp, Storefront, Users,
} from "@phosphor-icons/react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Cell,
} from "recharts";

const KpiCard = ({ icon: Icon, label, value, sub, tone = "default", testid }) => {
  const toneColor =
    tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-500" :
    tone === "success" ? "text-emerald-500" : "text-foreground";
  return (
    <div className="border border-border rounded-md p-5 bg-card lift-on-hover hover:border-foreground/30" data-testid={testid}>
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted-foreground">
        <span>{label}</span>
        <Icon size={16} className={toneColor} weight="duotone" />
      </div>
      <div className={`font-display text-3xl font-semibold mt-3 tabular-nums tracking-tight ${toneColor}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/dashboard/stats").then((r) => setStats(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading || !stats) {
    return (
      <div className="space-y-4">
        <div className="h-24 shimmer rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 shimmer rounded" />)}
        </div>
      </div>
    );
  }

  const trendData = stats.trend_7d || [];
  const topData = (stats.top_products || []).map((t) => ({ name: (t.name || "").slice(0, 20), qty: t.qty }));

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Overview</div>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight mt-2">Mission Control</h1>
        <p className="text-sm text-muted-foreground mt-2">Real-time view of stock, fulfillment, and finance across your network.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={CurrencyInr} label="Hub Stock Value" value={formatINR(stats.total_stock_value)} sub={`${formatNum(stats.total_stock_qty)} units across SKUs`} testid="kpi-stock-value" />
        <KpiCard icon={WarningCircle} label="Low Stock SKUs" value={stats.low_stock_count} tone={stats.low_stock_count > 0 ? "danger" : "success"} sub="Below safety threshold" testid="kpi-low-stock" />
        <KpiCard icon={CurrencyInr} label="Vendor Outstanding" value={formatINR(stats.outstanding_payments)} sub="Due across vendors" testid="kpi-outstanding" />
        <KpiCard icon={CheckCircle} label="Avg Fulfillment" value={`${stats.avg_fulfillment_ratio}%`} tone="success" sub={`${stats.delivered_indents} delivered`} testid="kpi-fulfillment" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Package} label="Products / SKUs" value={formatNum(stats.products_count)} testid="kpi-products" />
        <KpiCard icon={Users} label="Vendors" value={formatNum(stats.vendors_count)} testid="kpi-vendors" />
        <KpiCard icon={Storefront} label="Franchises" value={formatNum(stats.franchises_count)} testid="kpi-franchises" />
        <KpiCard icon={Receipt} label="Pending Indents" value={formatNum(stats.pending_indents)} tone={stats.pending_indents > 0 ? "warn" : "default"} testid="kpi-pending" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 border-border" data-testid="trend-chart">
          <CardHeader>
            <CardTitle className="text-base font-display">Indent Volume — Last 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border" data-testid="top-products-chart">
          <CardHeader>
            <CardTitle className="text-base font-display">Top Moving Products</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} width={120} />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Bar dataKey="qty" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-border rounded-md p-5 bg-card">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <ClockCounterClockwise size={14} /> Dead Stock
          </div>
          <div className="font-display text-3xl font-semibold mt-2 tabular-nums">{stats.dead_stock_count}</div>
          <div className="text-xs text-muted-foreground mt-1">SKUs aged 365+ days — review for clearance.</div>
        </div>
        <div className="border border-border rounded-md p-5 bg-card">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <TrendUp size={14} /> Delivered (lifetime)
          </div>
          <div className="font-display text-3xl font-semibold mt-2 tabular-nums">{stats.delivered_indents}</div>
          <div className="text-xs text-muted-foreground mt-1">Successful franchise dispatches.</div>
        </div>
        <div className="border border-border rounded-md p-5 bg-card">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <Receipt size={14} /> Pending Indents
          </div>
          <div className="font-display text-3xl font-semibold mt-2 tabular-nums">{stats.pending_indents}</div>
          <div className="text-xs text-muted-foreground mt-1">Awaiting approval, dispatch or delivery.</div>
        </div>
      </div>
    </div>
  );
}
