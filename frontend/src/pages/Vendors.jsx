import React, { useEffect, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Users, Star } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";

const empty = {
  code: "", name: "", gstin: "", address: "", contact_phone: "", contact_email: "",
  credit_period_days: 30, outstanding_balance: 0, credit_limit: 0, rating: 4.5, fulfillment_score: 95,
};

export default function Vendors() {
  const { user } = useAuth();
  const [vendors, setVendors] = useState([]);
  const [editing, setEditing] = useState(null);
  const canEdit = ["super_admin", "hub_accountant"].includes(user?.role);

  const load = () => api.get("/vendors").then((r) => setVendors(r.data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      if (editing.id) await api.put(`/vendors/${editing.id}`, editing);
      else await api.post("/vendors", editing);
      toast.success("Saved");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div className="space-y-6" data-testid="vendors-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Procurement</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Vendors</h1>
          <p className="text-sm text-muted-foreground mt-1">Suppliers, credit terms, and performance.</p>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing({ ...empty })} data-testid="new-vendor-btn"><Plus size={14} className="mr-2" /> New Vendor</Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {vendors.map((v) => (
          <div key={v.id} className="border border-border rounded-md p-5 bg-card lift-on-hover" data-testid={`vendor-card-${v.code}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] font-mono text-muted-foreground">{v.code}</div>
                <div className="font-medium leading-tight mt-1">{v.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{v.address}</div>
              </div>
              <Badge variant="secondary" className="text-[11px]"><Star size={10} className="mr-1" />{v.rating?.toFixed(1)}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
              <div>
                <div className="text-muted-foreground">Outstanding</div>
                <div className="tabular-nums font-medium text-destructive">{formatINR(v.outstanding_balance)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Credit Days</div>
                <div className="tabular-nums font-medium">{v.credit_period_days}d</div>
              </div>
              <div>
                <div className="text-muted-foreground">Fulfill</div>
                <div className="tabular-nums font-medium text-emerald-600">{v.fulfillment_score}%</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{v.contact_phone}</span>
              {canEdit && <button onClick={() => setEditing(v)} className="hover:text-foreground" data-testid={`edit-vendor-${v.code}`}>Edit →</button>}
            </div>
          </div>
        ))}
        {vendors.length === 0 && (
          <div className="col-span-full border border-dashed border-border rounded-md p-12 text-center text-muted-foreground">
            <Users size={32} className="mx-auto mb-2 opacity-50" /> No vendors yet.
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl" data-testid="vendor-dialog">
          <DialogHeader><DialogTitle className="font-display">{editing?.id ? "Edit" : "New"} Vendor</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Code</Label><Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
              <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="col-span-2"><Label>Address</Label><Input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></div>
              <div><Label>GSTIN</Label><Input value={editing.gstin} onChange={(e) => setEditing({ ...editing, gstin: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={editing.contact_phone} onChange={(e) => setEditing({ ...editing, contact_phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={editing.contact_email} onChange={(e) => setEditing({ ...editing, contact_email: e.target.value })} /></div>
              <div><Label>Credit Period (days)</Label><Input type="number" value={editing.credit_period_days} onChange={(e) => setEditing({ ...editing, credit_period_days: Number(e.target.value) })} /></div>
              <div><Label>Credit Limit</Label><Input type="number" value={editing.credit_limit} onChange={(e) => setEditing({ ...editing, credit_limit: Number(e.target.value) })} /></div>
              <div><Label>Rating (0-5)</Label><Input type="number" step="0.1" value={editing.rating} onChange={(e) => setEditing({ ...editing, rating: Number(e.target.value) })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} data-testid="save-vendor-btn">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
