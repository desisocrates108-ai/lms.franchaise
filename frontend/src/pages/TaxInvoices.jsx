import React, { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { BACKEND_URL, formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Plus, FilePdf, EnvelopeSimple, MagnifyingGlass, Receipt,
  CheckCircle, Prohibit, CurrencyInr,
} from "@phosphor-icons/react";
import DateFilter, { dateQuery } from "@/components/DateFilter";

const STATUS_LABEL = {
  draft: { label: "Draft", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  issued: { label: "Issued", cls: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  paid: { label: "Paid", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  cancelled: { label: "Cancelled", cls: "bg-destructive/10 text-destructive border-destructive/30" },
};

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "issued", label: "Issued" },
  { id: "paid", label: "Paid" },
  { id: "cancelled", label: "Cancelled" },
];

export default function TaxInvoices() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState({ preset: "all", from: "", to: "" });
  const navigate = useNavigate();

  const load = async (range = dateRange, status = statusFilter) => {
    setLoading(true);
    try {
      const dq = dateQuery(range);
      const params = new URLSearchParams(dq);
      if (status && status !== "all") params.set("status", status);
      const q = params.toString();
      const r = await api.get(`/tax-invoices${q ? `?${q}` : ""}`);
      setRows(r.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load tax invoices");
    } finally {
      setLoading(false);
    }
  };

  const loadedRef = useRef(null);
  if (loadedRef.current == null) {
    loadedRef.current = true;
    load();
  }

  const handleDateChange = (next) => { setDateRange(next); load(next, statusFilter); };
  const handleStatusChange = (s) => { setStatusFilter(s); load(dateRange, s); };

  // ---- Aggregates ----
  const totals = rows.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.total += Number(r.grand_total) || 0;
      if (r.status === "issued") acc.outstanding += Number(r.grand_total) || 0;
      if (r.status === "paid") acc.paid += Number(r.grand_total) || 0;
      return acc;
    },
    { count: 0, total: 0, outstanding: 0, paid: 0 },
  );

  const filtered = !search ? rows : rows.filter((r) => {
    const s = search.toLowerCase();
    return (
      (r.invoice_number || "").toLowerCase().includes(s) ||
      (r.billing_name || "").toLowerCase().includes(s) ||
      (r.franchise_name || "").toLowerCase().includes(s) ||
      (r.dc_number || "").toLowerCase().includes(s)
    );
  });

  const downloadPdf = async (inv) => {
    const token = localStorage.getItem("nexus_token");
    const r = await fetch(`${BACKEND_URL}/api/tax-invoices/${inv.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) { toast.error("PDF generation failed"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tax-invoice-${(inv.invoice_number || "draft").replace(/\//g, "-")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const emailViaMailto = async (inv) => {
    try {
      const r = await api.get(`/tax-invoices/${inv.id}/mailto`);
      window.location.href = r.data.url;
    } catch {
      toast.error("Could not build mailto link");
    }
  };

  return (
    <div className="space-y-6" data-testid="tax-invoices-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Outbound Billing</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2 flex items-center gap-2">
            <Receipt size={28} weight="duotone" /> Tax Invoices
          </h1>
          <p className="text-sm text-muted-foreground mt-1">GST-compliant sales tax invoices. Issued automatically on delivery — or generate manually any time.</p>
        </div>
        <div className="flex items-center gap-2">
          <DateFilter value={dateRange} onChange={handleDateChange} storageKey="df:tax_invoices" />
          <Button asChild data-testid="new-tax-invoice-btn">
            <Link to="/tax-invoices/new"><Plus size={14} className="mr-2" /> New Tax Invoice</Link>
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="tax-invoices-kpis">
        <KPI label="Total Invoices" value={totals.count} icon={Receipt} />
        <KPI label="Gross Value" value={formatINR(totals.total)} icon={CurrencyInr} />
        <KPI label="Outstanding (Issued)" value={formatINR(totals.outstanding)} icon={EnvelopeSimple} accent="amber" />
        <KPI label="Paid" value={formatINR(totals.paid)} icon={CheckCircle} accent="emerald" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="status-tabs">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => handleStatusChange(s.id)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                statusFilter === s.id ? "bg-foreground text-background" : "bg-muted/50 hover:bg-muted text-foreground"
              }`}
              data-testid={`status-tab-${s.id}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice #, customer, DC..."
            className="pl-9"
            data-testid="tax-invoices-search"
          />
        </div>
      </div>

      <div className="border border-border rounded-md bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="tax-invoices-table">
            <thead className="bg-muted/40">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2">Invoice #</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Taxable</th>
                <th className="px-3 py-2 text-right">Tax</th>
                <th className="px-3 py-2 text-right">Grand Total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} className="text-center text-muted-foreground py-8">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center text-muted-foreground py-12">
                  <Receipt size={32} weight="duotone" className="mx-auto mb-2 opacity-40" />
                  <div>No tax invoices yet.</div>
                  <div className="text-[11px] mt-1">Issue one from a delivered challan, or click "New Tax Invoice".</div>
                </td></tr>
              )}
              {!loading && filtered.map((inv) => {
                const s = STATUS_LABEL[inv.status] || STATUS_LABEL.draft;
                const tax = (Number(inv.cgst_total) || 0) + (Number(inv.sgst_total) || 0) + (Number(inv.igst_total) || 0);
                return (
                  <tr key={inv.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" data-testid={`tax-invoice-row-${inv.id}`}
                      onClick={() => navigate(`/tax-invoices/${inv.id}`)}>
                    <td className="px-3 py-2 font-mono">{inv.invoice_number || <span className="text-muted-foreground italic">draft</span>}</td>
                    <td className="px-3 py-2 text-muted-foreground">{inv.invoice_date}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{inv.billing_name || inv.franchise_name || "—"}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{inv.billing_gstin || ""}</div>
                    </td>
                    <td className="px-3 py-2">
                      {inv.source_type === "challan" ? (
                        <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/30">
                          DC {inv.dc_number || "—"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Manual</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(inv.subtotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(tax)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatINR(inv.grand_total)}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={`text-[10px] ${s.cls}`}>{s.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Download PDF"
                                onClick={() => downloadPdf(inv)} data-testid={`pdf-${inv.id}`}>
                          <FilePdf size={13} />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Email"
                                onClick={() => emailViaMailto(inv)} data-testid={`mail-${inv.id}`}>
                          <EnvelopeSimple size={13} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, icon: Icon, accent }) {
  const accentCls = {
    amber: "text-amber-600",
    emerald: "text-emerald-600",
  }[accent] || "text-foreground";
  return (
    <div className="border border-border rounded-md bg-card p-3" data-testid={`kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon size={14} className="text-muted-foreground" weight="duotone" />
      </div>
      <div className={`text-lg sm:text-xl font-display font-semibold tabular-nums mt-1 ${accentCls}`}>{value}</div>
    </div>
  );
}
