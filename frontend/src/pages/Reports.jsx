import React, { useEffect, useMemo, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChartLine, DownloadSimple, FilePdf, FileXls, Funnel } from "@phosphor-icons/react";
import DateFilter, { dateQuery } from "@/components/DateFilter";
import { toast } from "sonner";

const TOKEN_KEY = "nexus_token";

const REPORTS = [
  { key: "inventory-value", title: "Inventory Value", desc: "Stock-on-hand × landing price by SKU." },
  { key: "stock-movement", title: "Stock Movement", desc: "In/out events across all hubs." },
  { key: "purchase", title: "Purchase", desc: "Vendor invoices in selected period." },
  { key: "sales", title: "Sales", desc: "Delivery challans dispatched to franchises." },
];

export default function Reports() {
  const [tab, setTab] = useState("inventory-value");
  const [dateRange, setDateRange] = useState({ preset: "all", from: "", to: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setData(null);
    try {
      const q = tab === "inventory-value" ? {} : dateQuery(dateRange);
      const params = new URLSearchParams(q).toString();
      const url = `/reports/${tab}${params ? `?${params}` : ""}`;
      const r = await api.get(url);
      setData(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dateRange]);

  const download = async (fmt) => {
    const q = tab === "inventory-value" ? {} : dateQuery(dateRange);
    const params = new URLSearchParams({ ...q, format: fmt }).toString();
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/reports/${tab}?${params}`;
    // Use fetch with auth header → blob download (axios baseURL handled implicitly via fetch)
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const ext = fmt === "excel" ? "xlsx" : "pdf";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${tab}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Downloaded ${tab}.${ext}`);
    } catch (e) {
      toast.error("Download failed");
    }
  };

  const meta = REPORTS.find((r) => r.key === tab);

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Reporting Suite</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Inventory, Stock Movement, Purchase, Sales — export to PDF or Excel.</p>
        </div>
        {tab !== "inventory-value" && (
          <DateFilter value={dateRange} onChange={setDateRange} storageKey={`df:reports-${tab}`} />
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList data-testid="reports-tabs">
          {REPORTS.map((r) => (
            <TabsTrigger key={r.key} value={r.key} data-testid={`tab-${r.key}`}>{r.title}</TabsTrigger>
          ))}
        </TabsList>

        {REPORTS.map((r) => (
          <TabsContent key={r.key} value={r.key} className="space-y-4 pt-4">
            <Card className="border-border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="font-display text-lg">{r.title}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{r.desc}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => download("excel")} disabled={loading || !data} data-testid={`export-xlsx-${r.key}`}>
                    <FileXls size={14} className="mr-2" /> Excel
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("pdf")} disabled={loading || !data} data-testid={`export-pdf-${r.key}`}>
                    <FilePdf size={14} className="mr-2" /> PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-0">
                {loading ? (
                  <div className="text-sm text-muted-foreground text-center py-12">Loading…</div>
                ) : !data ? (
                  <div className="text-sm text-muted-foreground text-center py-12">No data.</div>
                ) : (
                  <>
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-4 border-b border-border" data-testid="report-summary">
                      {Object.entries(data.summary || {}).map(([k, v]) => (
                        <div key={k} className="rounded bg-muted/30 px-3 py-2.5">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, " ")}</div>
                          <div className="font-display text-lg font-semibold mt-0.5 tabular-nums">
                            {typeof v === "number" && (k === "total_value" || k === "total_purchase" || k === "total_sales" || k === "grand_total")
                              ? formatINR(v)
                              : typeof v === "number" ? v.toLocaleString("en-IN") : String(v)}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Table */}
                    <div className="max-h-[60vh] overflow-y-auto">
                      <table className="w-full text-xs" data-testid="report-table">
                        <thead className="bg-muted/30 sticky top-0">
                          <tr className="text-left text-muted-foreground uppercase tracking-wider">
                            {(data.columns || []).map((c) => (
                              <th key={c} className="px-3 py-2 font-medium">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(data.rows || []).slice(0, 500).map((row, i) => (
                            <tr key={i} className="border-t border-border hover:bg-muted/20">
                              {row.map((cell, j) => (
                                <td key={j} className={`px-3 py-2 ${typeof cell === "number" ? "tabular-nums text-right" : ""}`}>
                                  {typeof cell === "number" && j > 0 ? cell.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(cell ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))}
                          {(data.rows || []).length === 0 && (
                            <tr><td colSpan={(data.columns || []).length} className="text-center text-muted-foreground py-12">No rows in selected range.</td></tr>
                          )}
                        </tbody>
                      </table>
                      {(data.rows || []).length > 500 && (
                        <div className="text-[11px] text-muted-foreground text-center py-2 border-t border-border bg-muted/10">
                          Showing first 500 of {data.rows.length} rows — export to Excel for the full data.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
