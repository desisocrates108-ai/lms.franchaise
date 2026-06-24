import React, { useEffect, useRef, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Camera, FileXls, Keyboard, Plus, Trash, UploadSimple, CheckCircle } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export default function NewOrder() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [mode, setMode] = useState("choose"); // choose | system | photo | excel
  const [franchises, setFranchises] = useState([]);
  const [franchiseId, setFranchiseId] = useState("");
  const [priority, setPriority] = useState("routine");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get("/franchises").then((r) => {
      setFranchises(r.data);
      if (user?.role === "franchise_manager" && user?.franchise_id) {
        setFranchiseId(user.franchise_id);
      } else if (r.data.length === 1) {
        setFranchiseId(r.data[0].id);
      }
    });
  }, [user]);

  const submitFile = async (file, endpoint) => {
    if (!franchiseId) { toast.error("Pick a franchise first"); return; }
    if (!file) { toast.error("Choose a file"); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("franchise_id", franchiseId);
      fd.append("priority", priority);
      fd.append("notes", notes);
      const r = await api.post(endpoint, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(r.data);
      toast.success(`Indent ${r.data.indent?.indent_number} created`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Order creation failed");
    } finally { setSubmitting(false); }
  };

  if (result) {
    const ind = result.indent;
    return (
      <div className="space-y-6 max-w-2xl mx-auto" data-testid="new-order-result">
        <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-emerald-500/15 text-emerald-600">
          <CheckCircle size={32} weight="fill" />
        </div>
        <div className="text-center">
          <h1 className="font-display text-3xl font-semibold">Order Submitted</h1>
          <div className="text-sm text-muted-foreground mt-1">{ind.indent_number}</div>
        </div>
        <div className="border border-border rounded-md p-5 bg-card space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Franchise</span> <span>{ind.franchise_name}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Source</span> <Badge variant="outline">{ind.source?.toUpperCase()}</Badge></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Items</span> <span>{ind.line_items?.length}</span></div>
          <div className="flex justify-between font-medium"><span>Total</span> <span className="tabular-nums">{formatINR(ind.total_amount)}</span></div>
          {ind.unmatched?.length > 0 && (
            <div className="pt-3 border-t border-border mt-3">
              <div className="text-xs text-amber-600 font-medium mb-1">{ind.unmatched.length} unmatched items skipped:</div>
              <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-auto">
                {ind.unmatched.map((u, i) => <li key={i}>• {u.sku || u.description} × {u.qty}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => { setResult(null); setMode("choose"); }} data-testid="new-another-btn">Create Another</Button>
          <Button onClick={() => navigate("/indents")} data-testid="goto-indents-btn">View All Indents</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="new-order-page">
      <div>
        <button onClick={() => navigate("/indents")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2" data-testid="back-to-indents">
          <ArrowLeft size={12} /> Back to Indents
        </button>
        <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Indents</div>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Create New Order</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose how you want to raise this indent — system entry, photo capture, or Excel upload.</p>
      </div>

      {/* Shared meta */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-md border border-border bg-card p-4">
        <div>
          <Label>Franchise</Label>
          <Select value={franchiseId} onValueChange={setFranchiseId} disabled={user?.role === "franchise_manager"}>
            <SelectTrigger data-testid="franchise-select"><SelectValue placeholder="Pick a franchise" /></SelectTrigger>
            <SelectContent>
              {franchises.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} ({f.code})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger data-testid="priority-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="routine">Routine</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Notes (optional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything for the warehouse?" data-testid="notes-input" />
        </div>
      </div>

      {/* Method picker */}
      {mode === "choose" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MethodCard
            id="system"
            icon={Keyboard}
            title="System Entry"
            subtitle="Pick SKUs from catalog with current prices."
            onClick={() => setMode("system")}
            testid="method-system"
          />
          <MethodCard
            id="photo"
            icon={Camera}
            title="Photo Order"
            subtitle="Capture or upload a hand-written / printed order sheet. AI extracts each line."
            badge="AI"
            onClick={() => setMode("photo")}
            testid="method-photo"
          />
          <MethodCard
            id="excel"
            icon={FileXls}
            title="Excel Order"
            subtitle="Upload .xlsx / .csv with SKU + Qty columns."
            onClick={() => setMode("excel")}
            testid="method-excel"
          />
        </div>
      )}

      {mode === "system" && <SystemEntryForm franchiseId={franchiseId} priority={priority} notes={notes} onSubmitted={setResult} onBack={() => setMode("choose")} />}
      {mode === "photo" && <PhotoOrderForm onBack={() => setMode("choose")} onSubmit={(f) => submitFile(f, "/indents/photo")} submitting={submitting} />}
      {mode === "excel" && <ExcelOrderForm onBack={() => setMode("choose")} onSubmit={(f) => submitFile(f, "/indents/excel")} submitting={submitting} />}
    </div>
  );
}

function MethodCard({ icon: Icon, title, subtitle, onClick, badge, testid }) {
  return (
    <button
      onClick={onClick}
      className="text-left border border-border rounded-md p-6 bg-card hover:border-foreground transition-all lift-on-hover"
      data-testid={testid}
    >
      <div className="flex items-center justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-foreground text-background">
          <Icon size={24} weight="duotone" />
        </div>
        {badge && <Badge variant="outline" className="bg-violet-500/10 text-violet-600 border-violet-500/30">{badge}</Badge>}
      </div>
      <div className="mt-4 font-display text-lg font-semibold">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>
    </button>
  );
}

function SystemEntryForm({ franchiseId, priority, notes, onSubmitted, onBack }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]); // {product_id, sku, name, price, requested_qty, discount_percent}
  const [submitting, setSubmitting] = useState(false);
  // v2.8: starter-kit modal
  const [kitOffer, setKitOffer] = useState(null); // {model_name, default_discount, line_items[]}
  const [kitChecked, setKitChecked] = useState(false);

  useEffect(() => { api.get("/products?limit=2000").then((r) => setProducts(r.data)); }, []);

  // v2.8: when a franchise is selected, check if it has any prior fulfilled order.
  // If not — fetch the starter-kit template and offer to auto-load.
  useEffect(() => {
    if (!franchiseId || kitChecked) return;
    let cancelled = false;
    (async () => {
      try {
        const hist = await api.get(`/franchises/${franchiseId}/has-stock-history`);
        if (cancelled) return;
        if (hist.data?.has_history === false) {
          const kit = await api.get(`/franchises/${franchiseId}/starter-kit`);
          if (!cancelled && (kit.data?.line_items || []).length > 0) {
            setKitOffer(kit.data);
          }
        }
      } catch (e) { /* silent — no kit is fine */ }
      setKitChecked(true);
    })();
    return () => { cancelled = true; };
  }, [franchiseId, kitChecked]);

  const loadStarterKit = () => {
    if (!kitOffer) return;
    const next = kitOffer.line_items.map((li) => ({
      product_id: li.product_id,
      sku: li.sku,
      name: li.product_name,
      price: li.unit_price,
      requested_qty: li.requested_qty,
      discount_percent: li.discount_percent,
    }));
    setItems(next);
    toast.success(`Loaded ${next.length} items from ${kitOffer.model_name} starter kit`);
    setKitOffer(null);
  };

  const filtered = products.filter(p => {
    const q = search.trim().toLowerCase();
    if (!q) return false;
    return p.sku?.toLowerCase().includes(q) || p.name?.toLowerCase().includes(q);
  }).slice(0, 8);

  const addItem = (p) => {
    if (items.find((i) => i.product_id === p.id)) return;
    setItems([...items, {
      product_id: p.id, sku: p.sku, name: p.name,
      price: p.franchise_price || 0, requested_qty: 1,
      discount_percent: kitOffer?.default_discount || 0,
    }]);
    setSearch("");
  };
  const updateQty = (id, qty) => {
    // Allow empty/intermediate string; sanitize leading zeros; cap at save time.
    let next = qty;
    if (typeof qty === "string" && qty.length > 1 && qty.startsWith("0")) next = qty.replace(/^0+/, "") || "0";
    setItems(items.map((i) => i.product_id === id ? { ...i, requested_qty: next } : i));
  };
  const updateDiscount = (id, disc) => {
    const v = Math.max(0, Math.min(100, Number(disc) || 0));
    setItems(items.map((i) => i.product_id === id ? { ...i, discount_percent: v } : i));
  };
  const remove = (id) => setItems(items.filter((i) => i.product_id !== id));

  const computeLine = (i) => {
    const qty = Number(i.requested_qty) || 0;
    const gross = i.price * qty;
    const disc = (Number(i.discount_percent) || 0) / 100;
    return gross * (1 - disc);
  };
  const total = items.reduce((s, i) => s + computeLine(i), 0);

  const submit = async () => {
    if (!franchiseId) { toast.error("Pick a franchise"); return; }
    if (items.length === 0) { toast.error("Add at least one item"); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/indents", {
        franchise_id: franchiseId,
        priority,
        notes,
        line_items: items.map(i => ({
          product_id: i.product_id,
          requested_qty: Math.max(1, Number(i.requested_qty) || 1),
          discount_percent: Number(i.discount_percent) || 0,
        })),
      });
      onSubmitted({ indent: r.data });
      toast.success(`Indent ${r.data.indent_number} created`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} size="sm"><ArrowLeft size={12} className="mr-1" /> Switch method</Button>

      {/* v2.8 — Starter-kit auto-load offer */}
      {kitOffer && (
        <div className="rounded-md border border-violet-500/30 bg-violet-500/5 p-4 flex items-start gap-3" data-testid="starter-kit-offer">
          <div className="rounded-full bg-violet-500/15 text-violet-700 p-2"><CheckCircle size={18} weight="duotone" /></div>
          <div className="flex-1">
            <div className="font-medium text-sm">This franchise is new.</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Would you like to load the recommended starter inventory for <strong>{kitOffer.model_name}</strong>?
              ({kitOffer.line_items.length} items · default discount {kitOffer.default_discount}%)
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setKitOffer(null)} data-testid="starter-kit-skip">No, start blank</Button>
            <Button size="sm" onClick={loadStarterKit} data-testid="starter-kit-load">Yes, load template</Button>
          </div>
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-4 space-y-3">
        <Label>Search & Add Products</Label>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type SKU or name…" data-testid="sys-search-input" />
        {filtered.length > 0 && (
          <div className="rounded border border-border max-h-60 overflow-y-auto">
            {filtered.map((p) => (
              <button key={p.id} onClick={() => addItem(p)} className="block w-full text-left px-3 py-2 hover:bg-muted text-sm border-b border-border last:border-b-0" data-testid={`sys-add-${p.sku}`}>
                <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                <div className="flex justify-between"><span>{p.name}</span><span className="tabular-nums">{formatINR(p.franchise_price)}</span></div>
              </button>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <div className="rounded border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">SKU</th><th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Disc %</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.product_id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{i.sku}</td>
                    <td className="px-3 py-2">{i.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(i.price)}</td>
                    <td className="px-3 py-2 text-right">
                      <Input type="number" inputMode="numeric" min={1} value={i.requested_qty ?? ""} onFocus={(e) => e.target.select()} onChange={(e) => updateQty(i.product_id, e.target.value)} className="w-20 ml-auto h-8" data-testid={`sys-qty-${i.sku}`} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={i.discount_percent ?? 0} onFocus={(e) => e.target.select()} onChange={(e) => updateDiscount(i.product_id, e.target.value)} className="w-20 ml-auto h-8" data-testid={`sys-disc-${i.sku}`} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(computeLine(i))}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => remove(i.product_id)} className="rounded p-1 hover:bg-destructive/10 text-destructive" data-testid={`sys-remove-${i.sku}`}><Trash size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/40 border-t border-border font-medium">
                  <td colSpan={5} className="px-3 py-2 text-right">Total (after discount)</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(total)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={items.length === 0 || submitting} data-testid="sys-submit-btn">
            {submitting ? "Submitting…" : <><Plus size={14} className="mr-2" />Raise Indent</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PhotoOrderForm({ onBack, onSubmit, submitting }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);

  const onChange = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} size="sm"><ArrowLeft size={12} className="mr-1" /> Switch method</Button>
      <div className="rounded-md border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Camera size={24} weight="duotone" />
          <div>
            <div className="font-display text-base font-medium">Photo Order</div>
            <div className="text-xs text-muted-foreground">JPG / PNG / WEBP — AI extracts SKU + Qty from each line.</div>
          </div>
        </div>
        <input
          ref={inputRef} type="file" accept="image/*" capture="environment"
          onChange={onChange}
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-foreground file:px-3 file:py-2 file:text-background"
          data-testid="photo-file-input"
        />
        {preview && (
          <div className="rounded-md border border-border overflow-hidden">
            <img src={preview} alt="preview" className="max-h-80 w-full object-contain bg-muted/30" />
          </div>
        )}
        <Button onClick={() => onSubmit(file)} disabled={!file || submitting} className="w-full" data-testid="photo-submit-btn">
          <UploadSimple size={14} className="mr-2" />
          {submitting ? "AI is reading your order…" : "Upload & Extract Items"}
        </Button>
      </div>
    </div>
  );
}

function ExcelOrderForm({ onBack, onSubmit, submitting }) {
  const [file, setFile] = useState(null);
  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} size="sm"><ArrowLeft size={12} className="mr-1" /> Switch method</Button>
      <div className="rounded-md border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileXls size={24} weight="duotone" />
          <div>
            <div className="font-display text-base font-medium">Excel Order</div>
            <div className="text-xs text-muted-foreground">Upload .xlsx / .xls / .csv. Required columns: <code className="text-foreground">SKU</code> + <code className="text-foreground">Qty</code>.</div>
          </div>
        </div>
        <input
          type="file" accept=".xlsx,.xls,.csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-foreground file:px-3 file:py-2 file:text-background"
          data-testid="excel-file-input"
        />
        {file && <div className="text-xs text-muted-foreground"><FileXls size={12} className="inline mr-1" /> {file.name}</div>}
        <Button onClick={() => onSubmit(file)} disabled={!file || submitting} className="w-full" data-testid="excel-submit-btn">
          <UploadSimple size={14} className="mr-2" />
          {submitting ? "Importing…" : "Upload & Create Indent"}
        </Button>
      </div>
    </div>
  );
}
