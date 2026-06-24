import React, { useState, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import api, { BACKEND_URL, formatINR } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft, FloppyDisk, CheckCircle, Prohibit, FilePdf, EnvelopeSimple,
  Plus, X, MagnifyingGlass, CurrencyInr, Lightning,
} from "@phosphor-icons/react";

const STATUS_BADGE = {
  draft: { label: "DRAFT", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  issued: { label: "ISSUED", cls: "bg-sky-500/10 text-sky-600 border-sky-500/30" },
  paid: { label: "PAID", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  cancelled: { label: "CANCELLED", cls: "bg-destructive/10 text-destructive border-destructive/30" },
};

const EMPTY_LINE = { description: "", hsn: "", qty: 1, unit: "PCS", unit_price: 0, discount_percent: 0, gst_percent: 18 };

export default function TaxInvoiceDetail() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [inv, setInv] = useState(null);
  const [org, setOrg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showProdPickerIdx, setShowProdPickerIdx] = useState(null);
  const [showFranchisePicker, setShowFranchisePicker] = useState(false);

  const loadedRef = useRef(null);

  const load = async () => {
    try {
      const orgR = await api.get("/org/settings");
      setOrg(orgR.data);
      if (isNew) {
        // Pre-fill from challan if ?from_dc=<dc_id>
        const dcId = params.get("from_dc");
        if (dcId) {
          const r = await api.post("/tax-invoices", { source_type: "challan", challan_id: dcId });
          setInv(r.data);
          toast.success("Draft created from delivery challan");
          // Replace URL to detail of created invoice
          navigate(`/tax-invoices/${r.data.id}`, { replace: true });
        } else {
          // Start a blank draft (in-memory only — saved on Save Draft click)
          setInv({
            id: null,
            status: "draft",
            invoice_number: "",
            invoice_date: new Date().toISOString().slice(0, 10),
            due_date: "",
            source_type: "manual",
            billing_name: "",
            billing_address: "",
            billing_gstin: "",
            billing_state: "",
            billing_state_code: "",
            shipping_address: "",
            contact_email: "",
            contact_phone: "",
            place_of_supply: "",
            is_inter_state: false,
            line_items: [{ ...EMPTY_LINE }],
            terms: orgR.data?.default_terms || "",
            notes: "",
            payment_terms: "Net 30",
            subtotal: 0, cgst_total: 0, sgst_total: 0, igst_total: 0,
            grand_total: 0, round_off: 0,
            franchise_id: null,
          });
        }
      } else {
        const r = await api.get(`/tax-invoices/${id}`);
        setInv(r.data);
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load");
      navigate("/tax-invoices");
    }
  };

  if (loadedRef.current == null) {
    loadedRef.current = true;
    load();
  }

  const editable = inv?.status !== "cancelled" && !issuing;

  // ---- Client-side preview totals (server is source of truth on save) ----
  const previewTotals = useMemo(() => {
    if (!inv) return null;
    let subtotal = 0, cgst = 0, sgst = 0, igst = 0;
    const orgStateCode = org?.state_code || "";
    const billStateCode = inv.billing_state_code || "";
    const isInter = !!(billStateCode && orgStateCode && billStateCode !== orgStateCode);
    for (const li of inv.line_items || []) {
      const gross = (Number(li.qty) || 0) * (Number(li.unit_price) || 0);
      const disc = gross * (Number(li.discount_percent) || 0) / 100;
      const taxable = gross - disc;
      const gst = Number(li.gst_percent) || 0;
      if (isInter) {
        igst += taxable * gst / 100;
      } else {
        cgst += taxable * gst / 200;
        sgst += taxable * gst / 200;
      }
      subtotal += taxable;
    }
    const grand = subtotal + cgst + sgst + igst;
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      cgst: Math.round(cgst * 100) / 100,
      sgst: Math.round(sgst * 100) / 100,
      igst: Math.round(igst * 100) / 100,
      grand: Math.round(grand),
      round_off: Math.round((Math.round(grand) - grand) * 100) / 100,
      isInter,
    };
  }, [inv, org]);

  const upd = (patch) => setInv((s) => ({ ...s, ...patch }));

  const updLine = (i, patch) => setInv((s) => {
    const li = [...s.line_items];
    li[i] = { ...li[i], ...patch };
    return { ...s, line_items: li };
  });

  const addLine = () => setInv((s) => ({ ...s, line_items: [...(s.line_items || []), { ...EMPTY_LINE }] }));
  const removeLine = (i) => setInv((s) => ({ ...s, line_items: s.line_items.filter((_, x) => x !== i) }));

  const saveDraft = async () => {
    setSaving(true);
    try {
      const payload = {
        invoice_number: inv.invoice_number || undefined,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        franchise_id: inv.franchise_id,
        billing_name: inv.billing_name,
        billing_address: inv.billing_address,
        billing_gstin: inv.billing_gstin,
        billing_state: inv.billing_state,
        billing_state_code: inv.billing_state_code,
        shipping_address: inv.shipping_address,
        contact_email: inv.contact_email,
        contact_phone: inv.contact_phone,
        place_of_supply: inv.place_of_supply,
        line_items: (inv.line_items || []).filter((li) => li.description),
        terms: inv.terms,
        notes: inv.notes,
        payment_terms: inv.payment_terms,
      };
      let r;
      if (!inv.id) {
        r = await api.post("/tax-invoices", { source_type: "manual", ...payload });
        toast.success("Draft created");
        navigate(`/tax-invoices/${r.data.id}`, { replace: true });
      } else {
        r = await api.put(`/tax-invoices/${inv.id}`, payload);
        toast.success("Draft saved");
      }
      setInv(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const issue = async () => {
    if (!inv?.id) { toast.error("Save the draft first"); return; }
    setIssuing(true);
    try {
      const r = await api.post(`/tax-invoices/${inv.id}/issue`);
      setInv(r.data);
      toast.success(`Issued: ${r.data.invoice_number}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Issue failed");
    } finally {
      setIssuing(false);
    }
  };

  const cancelInvoice = async () => {
    try {
      const r = await api.post(`/tax-invoices/${inv.id}/cancel`, { reason: cancelReason });
      setInv(r.data);
      setCancelOpen(false);
      toast.success("Invoice cancelled");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Cancel failed");
    }
  };

  const markPaid = async () => {
    try {
      const r = await api.post(`/tax-invoices/${inv.id}/mark-paid`);
      setInv(r.data);
      toast.success("Marked paid");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Mark paid failed");
    }
  };

  const downloadPdf = async (view = "customer") => {
    if (!inv?.id) { toast.error("Save the draft first"); return; }
    const token = localStorage.getItem("nexus_token");
    const r = await fetch(`${BACKEND_URL}/api/tax-invoices/${inv.id}/pdf?view=${view}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) { toast.error("PDF generation failed"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = view === "internal" ? "-internal" : "";
    a.download = `tax-invoice-${(inv.invoice_number || "draft").replace(/\//g, "-")}${suffix}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const emailViaMailto = async () => {
    if (!inv?.id) { toast.error("Save the draft first"); return; }
    const r = await api.get(`/tax-invoices/${inv.id}/mailto`);
    window.location.href = r.data.url;
  };

  if (!inv) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const status = STATUS_BADGE[inv.status] || STATUS_BADGE.draft;

  return (
    <div className="space-y-6" data-testid="tax-invoice-detail-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <button onClick={() => navigate("/tax-invoices")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" data-testid="back-btn">
            <ArrowLeft size={12} /> Back to Tax Invoices
          </button>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-2 flex items-center gap-3">
            {inv.invoice_number || "New Tax Invoice"}
            <Badge variant="outline" className={`text-xs ${status.cls}`} data-testid="status-badge">{status.label}</Badge>
            {inv.source_type === "challan" && inv.dc_number && (
              <Badge variant="outline" className="text-xs bg-violet-500/10 text-violet-600 border-violet-500/30">
                From DC {inv.dc_number}
              </Badge>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {editable && (
            <Button variant="outline" onClick={saveDraft} disabled={saving} data-testid="save-draft-btn">
              <FloppyDisk size={14} className="mr-2" /> {saving ? "Saving…" : (inv?.status === "draft" ? "Save Draft" : "Save Changes")}
            </Button>
          )}
          {inv?.status === "draft" && inv.id && (
            <Button onClick={issue} disabled={issuing} data-testid="issue-btn">
              <Lightning size={14} className="mr-2" /> {issuing ? "Issuing…" : "Issue Invoice"}
            </Button>
          )}
          {inv.id && (
            <>
              <Button variant="outline" onClick={() => downloadPdf("customer")} data-testid="download-pdf-btn">
                <FilePdf size={14} className="mr-2" /> Download PDF
              </Button>
              {["super_admin", "hub_accountant", "warehouse_manager"].includes(user?.role) && (
                <Button variant="outline" onClick={() => downloadPdf("internal")} data-testid="download-pdf-internal-btn"
                        title="Includes cost / margin / discount — for internal use only">
                  <FilePdf size={14} className="mr-2" /> Internal Copy
                </Button>
              )}
              <Button variant="outline" onClick={emailViaMailto} data-testid="email-btn">
                <EnvelopeSimple size={14} className="mr-2" /> Email
              </Button>
            </>
          )}
          {inv.status === "issued" && (
            <Button variant="outline" onClick={markPaid} data-testid="mark-paid-btn">
              <CheckCircle size={14} className="mr-2" /> Mark Paid
            </Button>
          )}
          {inv.id && inv.status !== "cancelled" && (
            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="text-destructive border-destructive/30" data-testid="cancel-btn">
                  <Prohibit size={14} className="mr-2" /> Cancel
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Cancel Tax Invoice</DialogTitle></DialogHeader>
                <Label>Reason</Label>
                <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="Wrong customer, duplicate, etc." data-testid="cancel-reason-input" />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
                  <Button onClick={cancelInvoice} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="confirm-cancel-btn">
                    Confirm Cancel
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left & middle 2/3 — header + lines */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer + dates */}
          <div className="border border-border rounded-md bg-card p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Customer & Dates</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 relative">
                <Label>Customer (Franchise)</Label>
                <div className="flex gap-2">
                  <Input value={inv.billing_name || ""} onChange={(e) => upd({ billing_name: e.target.value })} disabled={!editable} data-testid="billing_name" />
                  {editable && (
                    <Button type="button" variant="outline" onClick={() => setShowFranchisePicker(!showFranchisePicker)} data-testid="pick-franchise-btn">
                      <MagnifyingGlass size={14} />
                    </Button>
                  )}
                </div>
                {showFranchisePicker && <FranchisePicker onPick={(f) => {
                  upd({
                    franchise_id: f.id,
                    billing_name: f.name,
                    billing_address: f.address || "",
                    billing_gstin: f.gstin || "",
                    billing_state: f.state || "",
                    billing_state_code: (f.gstin || "").slice(0, 2),
                    shipping_address: f.address || "",
                    contact_email: f.contact_email || "",
                    contact_phone: f.contact_phone || "",
                  });
                  setShowFranchisePicker(false);
                }} onClose={() => setShowFranchisePicker(false)} />}
              </div>
              <div className="sm:col-span-2"><Label>Billing Address</Label><Textarea rows={2} value={inv.billing_address || ""} onChange={(e) => upd({ billing_address: e.target.value })} disabled={!editable} data-testid="billing_address" /></div>
              <div><Label>GSTIN</Label><Input value={inv.billing_gstin || ""} onChange={(e) => upd({ billing_gstin: e.target.value, billing_state_code: (e.target.value || "").slice(0, 2) })} disabled={!editable} data-testid="billing_gstin" /></div>
              <div><Label>State</Label><Input value={inv.billing_state || ""} onChange={(e) => upd({ billing_state: e.target.value })} disabled={!editable} /></div>
              <div><Label>State Code</Label><Input value={inv.billing_state_code || ""} onChange={(e) => upd({ billing_state_code: e.target.value })} disabled={!editable} /></div>
              <div><Label>Place of Supply</Label><Input value={inv.place_of_supply || ""} onChange={(e) => upd({ place_of_supply: e.target.value })} disabled={!editable} placeholder="e.g. 29-Karnataka" /></div>
              <div><Label>Contact Email</Label><Input value={inv.contact_email || ""} onChange={(e) => upd({ contact_email: e.target.value })} disabled={!editable} data-testid="contact_email" /></div>
              <div><Label>Contact Phone</Label><Input value={inv.contact_phone || ""} onChange={(e) => upd({ contact_phone: e.target.value })} disabled={!editable} /></div>
              <div><Label>Invoice Number {inv.id && inv.status !== "draft" && <span className="text-[10px] text-amber-600">(override)</span>}</Label><Input value={inv.invoice_number || ""} onChange={(e) => upd({ invoice_number: e.target.value })} disabled={!editable} placeholder="Auto-generated on Issue" data-testid="invoice_number" /></div>
              <div><Label>Invoice Date</Label><Input type="date" value={inv.invoice_date || ""} onChange={(e) => upd({ invoice_date: e.target.value })} disabled={!editable} data-testid="invoice_date" /></div>
              <div><Label>Due Date</Label><Input type="date" value={inv.due_date || ""} onChange={(e) => upd({ due_date: e.target.value })} disabled={!editable} /></div>
              <div><Label>Payment Terms</Label><Input value={inv.payment_terms || ""} onChange={(e) => upd({ payment_terms: e.target.value })} disabled={!editable} /></div>
              <div className="text-xs text-muted-foreground self-end pb-2">
                Supply: <Badge variant="outline" className={`ml-1 text-[10px] ${previewTotals?.isInter ? "bg-violet-500/10 text-violet-600 border-violet-500/30" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"}`}>
                  {previewTotals?.isInter ? "Inter-State (IGST)" : "Intra-State (CGST+SGST)"}
                </Badge>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="border border-border rounded-md bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Line Items</div>
              {editable && <Button size="sm" variant="outline" onClick={addLine} data-testid="add-line-btn"><Plus size={12} className="mr-1" /> Add Line</Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="lines-table">
                <thead className="bg-muted/40">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-2 py-2">Description</th>
                    <th className="px-2 py-2">HSN</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2">Unit</th>
                    <th className="px-2 py-2 text-right">Rate ₹</th>
                    <th className="px-2 py-2 text-right">Disc%</th>
                    <th className="px-2 py-2 text-right">GST%</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    {editable && <th className="px-2 py-2"></th>}
                  </tr>
                </thead>
                <tbody>
                  {(inv.line_items || []).map((li, i) => {
                    const gross = (Number(li.qty) || 0) * (Number(li.unit_price) || 0);
                    const disc = gross * (Number(li.discount_percent) || 0) / 100;
                    const taxable = gross - disc;
                    const tax = taxable * (Number(li.gst_percent) || 0) / 100;
                    const lineTotal = Math.round((taxable + tax) * 100) / 100;
                    return (
                      <tr key={i} className="border-t border-border align-top" data-testid={`line-${i}`}>
                        <td className="px-2 py-2 relative min-w-[180px]">
                          <Input value={li.description} onChange={(e) => updLine(i, { description: e.target.value })} disabled={!editable} className="h-8 text-xs" data-testid={`line-${i}-desc`} />
                          {li.sku && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">SKU {li.sku}</div>}
                          {editable && (
                            <button type="button" onClick={() => setShowProdPickerIdx(showProdPickerIdx === i ? null : i)} className="text-[10px] underline text-muted-foreground hover:text-foreground mt-0.5" data-testid={`line-${i}-pick-product`}>
                              {li.product_id ? "Re-link" : "Link product"}
                            </button>
                          )}
                          {showProdPickerIdx === i && (
                            <ProductPicker onPick={(p) => {
                              updLine(i, { product_id: p.id, sku: p.sku, description: p.name, hsn: p.hsn_code || "", unit_price: p.landing_price || 0, gst_percent: p.gst_rate || 18 });
                              setShowProdPickerIdx(null);
                            }} onClose={() => setShowProdPickerIdx(null)} />
                          )}
                        </td>
                        <td className="px-2 py-2"><Input value={li.hsn || ""} onChange={(e) => updLine(i, { hsn: e.target.value })} disabled={!editable} className="h-8 text-xs font-mono w-20" data-testid={`line-${i}-hsn`} /></td>
                        <td className="px-2 py-2"><Input type="number" value={li.qty} onChange={(e) => updLine(i, { qty: Number(e.target.value) })} disabled={!editable} className="h-8 text-xs text-right w-16" data-testid={`line-${i}-qty`} /></td>
                        <td className="px-2 py-2"><Input value={li.unit || "PCS"} onChange={(e) => updLine(i, { unit: e.target.value })} disabled={!editable} className="h-8 text-xs w-14" /></td>
                        <td className="px-2 py-2"><Input type="number" value={li.unit_price} onChange={(e) => updLine(i, { unit_price: Number(e.target.value) })} disabled={!editable} className="h-8 text-xs text-right w-20" data-testid={`line-${i}-price`} /></td>
                        <td className="px-2 py-2"><Input type="number" value={li.discount_percent || 0} onChange={(e) => updLine(i, { discount_percent: Number(e.target.value) })} disabled={!editable} className="h-8 text-xs text-right w-14" /></td>
                        <td className="px-2 py-2"><Input type="number" value={li.gst_percent || 18} onChange={(e) => updLine(i, { gst_percent: Number(e.target.value) })} disabled={!editable} className="h-8 text-xs text-right w-14" data-testid={`line-${i}-gst`} /></td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatINR(lineTotal)}</td>
                        {editable && <td className="px-2 py-2"><button onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive" data-testid={`line-${i}-remove`}><X size={12} /></button></td>}
                      </tr>
                    );
                  })}
                  {(inv.line_items || []).length === 0 && (
                    <tr><td colSpan={editable ? 9 : 8} className="text-center text-muted-foreground py-6">No line items yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes & terms */}
          <div className="border border-border rounded-md bg-card p-4 space-y-3">
            <div>
              <Label>Notes (internal)</Label>
              <Textarea rows={2} value={inv.notes || ""} onChange={(e) => upd({ notes: e.target.value })} disabled={!editable} />
            </div>
            <div>
              <Label>Terms &amp; Conditions</Label>
              <Textarea rows={5} value={inv.terms || ""} onChange={(e) => upd({ terms: e.target.value })} disabled={!editable} data-testid="terms" />
            </div>
          </div>
        </div>

        {/* Right 1/3 — totals summary */}
        <div className="space-y-4">
          <div className="border border-border rounded-md bg-card p-4 sticky top-20" data-testid="totals-card">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Totals</div>
            <Row label="Subtotal (Taxable)" value={formatINR(previewTotals?.subtotal || 0)} />
            {previewTotals?.isInter ? (
              <Row label="IGST" value={formatINR(previewTotals?.igst || 0)} />
            ) : (
              <>
                <Row label="CGST" value={formatINR(previewTotals?.cgst || 0)} />
                <Row label="SGST" value={formatINR(previewTotals?.sgst || 0)} />
              </>
            )}
            {Math.abs(previewTotals?.round_off || 0) > 0 && <Row label="Round Off" value={formatINR(previewTotals?.round_off || 0)} muted />}
            <div className="border-t border-border mt-2 pt-2">
              <Row label="GRAND TOTAL" value={formatINR(previewTotals?.grand || 0)} bold large />
            </div>
            <div className="text-[10px] text-muted-foreground mt-3 italic">
              Server recomputes on Save Draft — minor rounding may differ.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold, large, muted }) {
  return (
    <div className={`flex items-center justify-between py-1 ${bold ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <span className={large ? "text-sm" : "text-xs"}>{label}</span>
      <span className={`tabular-nums ${large ? "text-base" : "text-xs"}`}>{value}</span>
    </div>
  );
}

// ---------- Pickers ----------
function FranchisePicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const search = (term) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const r = await api.get("/franchises");
        const filtered = (r.data || []).filter((f) =>
          !term || (f.name || "").toLowerCase().includes(term.toLowerCase()) ||
                   (f.code || "").toLowerCase().includes(term.toLowerCase())
        );
        setList(filtered.slice(0, 20));
      } catch { setList([]); }
      finally { setLoading(false); }
    }, 200);
  };

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get("/franchises");
        if (!cancelled) setList((r.data || []).slice(0, 20));
      } catch {
        if (!cancelled) setList([]);
      }
    })();
    return () => { cancelled = true; clearTimeout(timerRef.current); };
  }, []);

  return (
    <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-80 overflow-auto" data-testid="franchise-picker">
      <div className="sticky top-0 bg-popover border-b border-border p-2 flex items-center gap-2">
        <MagnifyingGlass size={14} className="text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
          placeholder="Search franchise..."
          className="h-7 text-xs"
        />
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
      </div>
      {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
      {!loading && list.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No matches.</div>}
      {list.map((f) => (
        <button key={f.id} onClick={() => onPick(f)} className="w-full text-left px-3 py-2 hover:bg-muted/60 border-t border-border first:border-t-0" data-testid={`franchise-pick-${f.code}`}>
          <div className="text-xs font-medium">{f.name}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{f.code} · {f.state || "—"} · GSTIN {f.gstin || "—"}</div>
        </button>
      ))}
    </div>
  );
}

function ProductPicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const search = (term) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!term || term.length < 2) { setList([]); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const r = await api.get(`/products?q=${encodeURIComponent(term)}&limit=15`);
        setList(r.data || []);
      } catch { setList([]); }
      finally { setLoading(false); }
    }, 240);
  };

  return (
    <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-80 overflow-auto" data-testid="line-product-picker">
      <div className="sticky top-0 bg-popover border-b border-border p-2 flex items-center gap-2">
        <MagnifyingGlass size={14} className="text-muted-foreground" />
        <Input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); search(e.target.value); }}
          placeholder="Search products..."
          className="h-7 text-xs"
        />
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
      </div>
      {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
      {list.map((p) => (
        <button key={p.id} onClick={() => onPick(p)} className="w-full text-left px-3 py-2 hover:bg-muted/60 border-t border-border first:border-t-0">
          <div className="text-xs font-medium">{p.name}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{p.sku} · HSN {p.hsn_code || "—"} · ₹{p.landing_price || 0}</div>
        </button>
      ))}
    </div>
  );
}
