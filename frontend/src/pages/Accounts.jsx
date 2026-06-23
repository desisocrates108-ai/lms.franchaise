import React, { useEffect, useState, useMemo } from "react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  Plus, UserGear, Eye, EyeSlash, Key, ToggleLeft, ToggleRight, PencilSimple,
  Info, MagnifyingGlass,
} from "@phosphor-icons/react";

const ROLE_LABELS = {
  super_admin: "Super Admin",
  hub_accountant: "Hub Accountant",
  warehouse_manager: "Warehouse Manager",
  franchise_manager: "Franchise Manager",
};

const emptyAccount = {
  full_name: "", email: "", mobile: "", username: "",
  password: "", confirm: "",
  role: "", hub_id: "", franchise_id: "", active: true,
};

function PasswordField({ id, value, onChange, placeholder = "••••••••", testId, autoComplete = "new-password" }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value || ""}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        data-testid={testId}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        data-testid={`${testId}-toggle`}
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeSlash size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export default function Accounts() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [meta, setMeta] = useState({ roles: [], hubs: [], franchises: [] });
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [a, m] = await Promise.all([
        api.get("/accounts"),
        api.get("/accounts-meta"),
      ]);
      setAccounts(a.data || []);
      setMeta(m.data || { roles: [], hubs: [], franchises: [] });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const franchiseById = useMemo(() => {
    const m = {};
    (meta.franchises || []).forEach((f) => { m[f.id] = f; });
    return m;
  }, [meta.franchises]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      (a.full_name || "").toLowerCase().includes(q) ||
      (a.email || "").toLowerCase().includes(q) ||
      (a.username || "").toLowerCase().includes(q) ||
      (a.role || "").toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const startCreate = () => setEditing({ ...emptyAccount, role: meta.roles[0] || "" });
  const startEdit = (a) => setEditing({ ...a, password: "", confirm: "" });

  const save = async () => {
    if (!editing.full_name?.trim() || !editing.email?.trim()) {
      toast.error("Full name and email are required");
      return;
    }
    if (!editing.id) {
      if (!editing.password || editing.password.length < 6) {
        toast.error("Password must be at least 6 characters");
        return;
      }
      if (editing.password !== editing.confirm) {
        toast.error("Passwords do not match");
        return;
      }
    }
    try {
      if (editing.id) {
        const payload = {
          full_name: editing.full_name,
          email: editing.email,
          mobile: editing.mobile,
          username: editing.username,
          role: editing.role,
          franchise_id: editing.franchise_id || null,
          hub_id: editing.hub_id || null,
          active: editing.active,
        };
        await api.put(`/accounts/${editing.id}`, payload);
        toast.success("Account updated");
      } else {
        const payload = {
          full_name: editing.full_name,
          email: editing.email,
          mobile: editing.mobile,
          username: editing.username,
          password: editing.password,
          role: editing.role,
          franchise_id: editing.franchise_id || null,
          hub_id: editing.hub_id || null,
          active: true,
        };
        await api.post("/accounts", payload);
        toast.success("Account created");
      }
      setEditing(null);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Save failed");
    }
  };

  const toggleActive = async (a) => {
    try {
      if (a.active) await api.post(`/accounts/${a.id}/disable`);
      else await api.post(`/accounts/${a.id}/activate`);
      toast.success(a.active ? "Account disabled" : "Account activated");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Action failed");
    }
  };

  const doReset = async () => {
    if (!resetting?.new_password || resetting.new_password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (resetting.new_password !== resetting.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    try {
      await api.post(`/accounts/${resetting.id}/reset-password`, { new_password: resetting.new_password });
      toast.success(`Password reset for ${resetting.email}`);
      setResetting(null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Reset failed");
    }
  };

  return (
    <div className="space-y-6" data-testid="accounts-page">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight flex items-center gap-2">
            <UserGear size={22} weight="bold" /> Account Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ERP login accounts.{" "}
            {user?.role === "warehouse_manager"
              ? "You can create and manage Franchise Manager accounts within your hub."
              : "Manage all roles, reset passwords, activate or disable access."}
          </p>
        </div>
        <Button onClick={startCreate} className="gap-2" data-testid="account-new-btn">
          <Plus size={16} /> New Account
        </Button>
      </div>

      <div className="relative max-w-sm">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, username, role…"
          className="pl-9"
          data-testid="account-search-input"
        />
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Full Name</th>
              <th className="px-3 py-2 text-left">Username</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Mobile</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Hub</th>
              <th className="px-3 py-2 text-left">Franchise</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Last Login</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">No accounts found.</td></tr>
            )}
            {!loading && filtered.map((a) => (
              <tr key={a.id} className="border-t border-border hover:bg-muted/30" data-testid={`account-row-${a.id}`}>
                <td className="px-3 py-2 font-medium">{a.full_name}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.username || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.email}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.mobile || "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className="text-[10px]">{ROLE_LABELS[a.role] || a.role}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{a.hub_id || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{franchiseById[a.franchise_id]?.name || a.franchise_id || "—"}</td>
                <td className="px-3 py-2">
                  {a.active ? (
                    <Badge className="bg-emerald-600/15 text-emerald-700 border-emerald-700/30 text-[10px]" variant="outline">Active</Badge>
                  ) : (
                    <Badge variant="destructive" className="text-[10px]">Disabled</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">{a.last_login_at ? a.last_login_at.slice(0, 16).replace("T", " ") : "Never"}</td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">{(a.created_at || "").slice(0, 10)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon" variant="ghost" title="View" onClick={() => setViewing(a)} data-testid={`account-view-${a.id}`}>
                      <Info size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" title="Edit" onClick={() => startEdit(a)} data-testid={`account-edit-${a.id}`}>
                      <PencilSimple size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" title="Reset password" onClick={() => setResetting({ id: a.id, email: a.email, new_password: "", confirm: "" })} data-testid={`account-reset-${a.id}`}>
                      <Key size={14} />
                    </Button>
                    <Button size="icon" variant="ghost" title={a.active ? "Disable" : "Activate"} onClick={() => toggleActive(a)} data-testid={`account-toggle-${a.id}`}>
                      {a.active ? <ToggleRight size={16} weight="fill" /> : <ToggleLeft size={16} />}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CREATE / EDIT DIALOG */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Account" : "Create Account"}</DialogTitle>
            <DialogDescription>
              {editing?.id ? "Update details. Leave role unchanged unless promoting." : "ERP login credentials only — not employee management."}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Full Name *</Label>
                <Input value={editing.full_name} onChange={(e) => setEditing({ ...editing, full_name: e.target.value })} data-testid="account-fullname-input" />
              </div>
              <div>
                <Label>Email *</Label>
                <Input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} data-testid="account-email-input" />
              </div>
              <div>
                <Label>Mobile</Label>
                <Input value={editing.mobile || ""} onChange={(e) => setEditing({ ...editing, mobile: e.target.value })} data-testid="account-mobile-input" />
              </div>
              <div>
                <Label>Username</Label>
                <Input value={editing.username || ""} onChange={(e) => setEditing({ ...editing, username: e.target.value })} data-testid="account-username-input" />
              </div>
              <div>
                <Label>Role *</Label>
                <Select
                  value={editing.role}
                  onValueChange={(v) => setEditing({ ...editing, role: v })}
                  disabled={!!editing.id && user?.role !== "super_admin"}
                >
                  <SelectTrigger data-testid="account-role-select">
                    <SelectValue placeholder="Choose role" />
                  </SelectTrigger>
                  <SelectContent>
                    {(meta.roles || []).map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r] || r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!editing.id && (
                <>
                  <div>
                    <Label>Password *</Label>
                    <PasswordField
                      id="account-password"
                      value={editing.password}
                      onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                      testId="account-password-input"
                    />
                  </div>
                  <div>
                    <Label>Confirm Password *</Label>
                    <PasswordField
                      id="account-confirm"
                      value={editing.confirm}
                      onChange={(e) => setEditing({ ...editing, confirm: e.target.value })}
                      testId="account-confirm-input"
                    />
                  </div>
                </>
              )}
              <div>
                <Label>Assigned Hub</Label>
                <Input value={editing.hub_id || ""} onChange={(e) => setEditing({ ...editing, hub_id: e.target.value })} placeholder="hub-main" data-testid="account-hub-input" />
              </div>
              <div>
                <Label>Assigned Franchise</Label>
                <Select
                  value={editing.franchise_id || "__none__"}
                  onValueChange={(v) => setEditing({ ...editing, franchise_id: v === "__none__" ? "" : v })}
                >
                  <SelectTrigger data-testid="account-franchise-select">
                    <SelectValue placeholder="— None —" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {(meta.franchises || []).map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} data-testid="account-cancel-btn">Cancel</Button>
            <Button onClick={save} data-testid="account-save-btn">{editing?.id ? "Save" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RESET PASSWORD DIALOG */}
      <Dialog open={!!resetting} onOpenChange={(o) => !o && setResetting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Set a new password for <strong>{resetting?.email}</strong>.</DialogDescription>
          </DialogHeader>
          {resetting && (
            <div className="space-y-3">
              <div>
                <Label>New Password</Label>
                <PasswordField
                  id="reset-password"
                  value={resetting.new_password}
                  onChange={(e) => setResetting({ ...resetting, new_password: e.target.value })}
                  testId="reset-password-input"
                />
              </div>
              <div>
                <Label>Confirm Password</Label>
                <PasswordField
                  id="reset-confirm"
                  value={resetting.confirm}
                  onChange={(e) => setResetting({ ...resetting, confirm: e.target.value })}
                  testId="reset-confirm-input"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setResetting(null)} data-testid="reset-cancel-btn">Cancel</Button>
            <Button onClick={doReset} data-testid="reset-submit-btn">Reset Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* VIEW DETAILS */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{viewing?.full_name}</DialogTitle>
            <DialogDescription>{ROLE_LABELS[viewing?.role] || viewing?.role}</DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="text-sm space-y-2">
              <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{viewing.email}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Mobile</span><span>{viewing.mobile || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Username</span><span>{viewing.username || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Hub</span><span>{viewing.hub_id || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Franchise</span><span>{franchiseById[viewing.franchise_id]?.name || viewing.franchise_id || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{viewing.active ? "Active" : "Disabled"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Last Login</span><span>{viewing.last_login_at ? viewing.last_login_at.replace("T", " ").slice(0, 19) : "Never"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{(viewing.created_at || "").slice(0, 10)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Created By</span><span className="text-xs">{viewing.created_by || "system"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Updated</span><span>{(viewing.updated_at || "—").slice(0, 10)}</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setViewing(null)} data-testid="view-close-btn">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
