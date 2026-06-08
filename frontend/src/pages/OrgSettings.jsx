import React, { useState, useRef } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Buildings, FloppyDisk, Bank, FileText, Gear } from "@phosphor-icons/react";

const SECTIONS = [
  { id: "company", label: "Company", icon: Buildings },
  { id: "tax", label: "Tax & Legal", icon: FileText },
  { id: "bank", label: "Bank Details", icon: Bank },
  { id: "invoice", label: "Invoice Defaults", icon: Gear },
];

export default function OrgSettings() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState("company");
  const loadedRef = useRef(null);

  const load = async () => {
    try {
      const r = await api.get("/org/settings");
      setSettings(r.data);
    } catch (e) {
      toast.error("Failed to load settings");
    }
  };

  if (loadedRef.current == null) {
    loadedRef.current = true;
    load();
  }

  const upd = (patch) => setSettings((s) => ({ ...s, ...patch }));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const { id: _id, updated_at: _u, ...payload } = settings;
      const r = await api.put("/org/settings", payload);
      setSettings(r.data);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-6" data-testid="org-settings-page">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">System</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Organization Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Legal entity, tax credentials, bank details & invoice defaults — used on every Tax Invoice PDF.</p>
        </div>
        <Button onClick={save} disabled={saving} data-testid="save-settings-btn">
          <FloppyDisk size={14} className="mr-2" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
        <nav className="space-y-1" data-testid="settings-nav">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left ${
                section === id ? "bg-foreground text-background" : "hover:bg-muted/60"
              }`}
              data-testid={`settings-section-${id}`}
            >
              <Icon size={14} weight="duotone" />
              {label}
            </button>
          ))}
        </nav>

        <div className="border border-border rounded-md bg-card p-6">
          {section === "company" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2"><Label>Legal Name *</Label><Input value={settings.legal_name || ""} onChange={(e) => upd({ legal_name: e.target.value })} data-testid="field-legal_name" /></div>
              <div><Label>Trade Name</Label><Input value={settings.trade_name || ""} onChange={(e) => upd({ trade_name: e.target.value })} /></div>
              <div><Label>Country</Label><Input value={settings.country || "India"} onChange={(e) => upd({ country: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Address Line 1</Label><Input value={settings.address_line1 || ""} onChange={(e) => upd({ address_line1: e.target.value })} data-testid="field-address_line1" /></div>
              <div className="sm:col-span-2"><Label>Address Line 2</Label><Input value={settings.address_line2 || ""} onChange={(e) => upd({ address_line2: e.target.value })} /></div>
              <div><Label>City</Label><Input value={settings.city || ""} onChange={(e) => upd({ city: e.target.value })} /></div>
              <div><Label>State</Label><Input value={settings.state || ""} onChange={(e) => upd({ state: e.target.value })} /></div>
              <div><Label>State Code (GSTIN, 2-digit)</Label><Input value={settings.state_code || ""} onChange={(e) => upd({ state_code: e.target.value })} placeholder="e.g. 29" data-testid="field-state_code" /></div>
              <div><Label>Pincode</Label><Input value={settings.pincode || ""} onChange={(e) => upd({ pincode: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={settings.phone || ""} onChange={(e) => upd({ phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={settings.email || ""} onChange={(e) => upd({ email: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Website</Label><Input value={settings.website || ""} onChange={(e) => upd({ website: e.target.value })} /></div>
            </div>
          )}

          {section === "tax" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>GSTIN *</Label><Input value={settings.gstin || ""} onChange={(e) => upd({ gstin: e.target.value })} placeholder="e.g. 29ABCDE1234F1Z5" data-testid="field-gstin" /></div>
              <div><Label>PAN</Label><Input value={settings.pan || ""} onChange={(e) => upd({ pan: e.target.value })} /></div>
              <div><Label>CIN</Label><Input value={settings.cin || ""} onChange={(e) => upd({ cin: e.target.value })} /></div>
              <div className="sm:col-span-2 rounded bg-muted/40 p-3 text-xs text-muted-foreground">
                ℹ️ State Code is auto-derived from GSTIN on save when omitted. It determines whether CGST+SGST or IGST applies on each tax invoice.
              </div>
            </div>
          )}

          {section === "bank" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2"><Label>Bank Name</Label><Input value={settings.bank_name || ""} onChange={(e) => upd({ bank_name: e.target.value })} data-testid="field-bank_name" /></div>
              <div><Label>Account Number</Label><Input value={settings.bank_account || ""} onChange={(e) => upd({ bank_account: e.target.value })} /></div>
              <div><Label>IFSC</Label><Input value={settings.bank_ifsc || ""} onChange={(e) => upd({ bank_ifsc: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Branch</Label><Input value={settings.bank_branch || ""} onChange={(e) => upd({ bank_branch: e.target.value })} /></div>
            </div>
          )}

          {section === "invoice" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><Label>Invoice Prefix *</Label><Input value={settings.invoice_prefix || ""} onChange={(e) => upd({ invoice_prefix: e.target.value })} placeholder="TI/2026-27/" data-testid="field-invoice_prefix" /></div>
              <div><Label>Padding (zeros)</Label><Input type="number" value={settings.invoice_pad ?? 4} onChange={(e) => upd({ invoice_pad: Number(e.target.value) })} /></div>
              <div className="sm:col-span-2"><Label>Default Terms</Label><Textarea rows={6} value={settings.default_terms || ""} onChange={(e) => upd({ default_terms: e.target.value })} data-testid="field-default_terms" /></div>
              <div className="sm:col-span-2 flex items-center justify-between rounded-md border border-border p-4">
                <div>
                  <div className="text-sm font-medium">Auto-create Tax Invoice on Delivery</div>
                  <div className="text-xs text-muted-foreground mt-0.5">When ON, a draft Tax Invoice is generated automatically every time a Delivery Challan is marked delivered.</div>
                </div>
                <Switch
                  checked={!!settings.auto_create_tax_invoice_on_delivery}
                  onCheckedChange={(v) => upd({ auto_create_tax_invoice_on_delivery: v })}
                  data-testid="toggle-auto-create"
                />
              </div>
              <div><Label>Logo URL</Label><Input value={settings.logo_url || ""} onChange={(e) => upd({ logo_url: e.target.value })} placeholder="https://..." /></div>
              <div><Label>Signature URL</Label><Input value={settings.signature_url || ""} onChange={(e) => upd({ signature_url: e.target.value })} /></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
