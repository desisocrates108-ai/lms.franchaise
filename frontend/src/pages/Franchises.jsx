import React, { useEffect, useState } from "react";
import api, { formatINR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Storefront, MapPin, Phone } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";

const empty = {
  code: "", name: "", city: "", state: "", address: "", gstin: "",
  contact_phone: "", contact_email: "", credit_limit: 0, active: true,
};

export default function Franchises() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const canEdit = user?.role === "super_admin";

  const load = () => api.get("/franchises").then((r) => setList(r.data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    try {
      if (editing.id) await api.put(`/franchises/${editing.id}`, editing);
      else await api.post("/franchises", editing);
      toast.success("Saved");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div className="space-y-6" data-testid="franchises-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Network</div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-2">Franchises</h1>
          <p className="text-sm text-muted-foreground mt-1">Service center spokes receiving stock from the hub.</p>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing({ ...empty })} data-testid="new-franchise-btn"><Plus size={14} className="mr-2" /> New Franchise</Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((f) => (
          <div key={f.id} className="border border-border rounded-md p-5 bg-card lift-on-hover" data-testid={`franchise-card-${f.code}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded bg-foreground text-background">
                <Storefront size={18} weight="duotone" />
              </div>
              <div>
                <div className="text-[11px] font-mono text-muted-foreground">{f.code}</div>
                <div className="font-medium">{f.name}</div>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2"><MapPin size={12} /> {f.city}, {f.state}</div>
              <div className="flex items-center gap-2"><Phone size={12} /> {f.contact_phone}</div>
              <div className="font-mono">{f.gstin}</div>
            </div>
            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-xs">
              <div>
                <div className="text-muted-foreground">Credit Limit</div>
                <div className="tabular-nums font-medium">{formatINR(f.credit_limit)}</div>
              </div>
              {canEdit && <button onClick={() => setEditing(f)} className="text-muted-foreground hover:text-foreground" data-testid={`edit-franchise-${f.code}`}>Edit →</button>}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="font-display">{editing?.id ? "Edit" : "New"} Franchise</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Code</Label><Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></div>
              <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><Label>City</Label><Input value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} /></div>
              <div><Label>State</Label><Input value={editing.state} onChange={(e) => setEditing({ ...editing, state: e.target.value })} /></div>
              <div className="col-span-2"><Label>Address</Label><Input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></div>
              <div><Label>GSTIN</Label><Input value={editing.gstin} onChange={(e) => setEditing({ ...editing, gstin: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={editing.contact_phone} onChange={(e) => setEditing({ ...editing, contact_phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={editing.contact_email} onChange={(e) => setEditing({ ...editing, contact_email: e.target.value })} /></div>
              <div><Label>Credit Limit</Label><Input type="number" value={editing.credit_limit} onChange={(e) => setEditing({ ...editing, credit_limit: Number(e.target.value) })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} data-testid="save-franchise-btn">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
