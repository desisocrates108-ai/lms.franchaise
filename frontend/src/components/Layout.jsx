import React, { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth, ROLE_LABELS } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import {
  House, Package, FileText, Truck, Users, Storefront, ChartBar,
  ListMagnifyingGlass, ClipboardText, ShieldCheck, Receipt, CurrencyInr,
  Sun, Moon, SignOut, MagnifyingGlass, List as MenuIcon, X, UploadSimple, Crown,
  ChartLine, FileText as InvoiceIcon, Gear,
} from "@phosphor-icons/react";

const NAV = [
  { to: "/", label: "Dashboard", icon: House, roles: null },
  { to: "/inventory", label: "Inventory", icon: Package, roles: ["super_admin", "warehouse_manager", "hub_accountant"] },
  { to: "/inventory/bulk-import", label: "Bulk Import", icon: UploadSimple, roles: ["super_admin", "warehouse_manager", "hub_accountant"] },
  { to: "/stock-entry", label: "Stock Entry (OCR)", icon: FileText, roles: ["super_admin", "hub_accountant", "warehouse_manager"] },
  { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardText, roles: ["super_admin", "hub_accountant", "warehouse_manager"] },
  { to: "/vendors", label: "Vendors", icon: Users, roles: ["super_admin", "hub_accountant", "warehouse_manager"] },
  { to: "/franchises", label: "Franchises", icon: Storefront, roles: ["super_admin", "hub_accountant"] },
  { to: "/indents", label: "Indents", icon: Receipt, roles: null },
  { to: "/delivery-challans", label: "Delivery Challans", icon: Truck, roles: null },
  { to: "/tax-invoices", label: "Tax Invoices", icon: InvoiceIcon, roles: ["super_admin", "hub_accountant", "franchise_manager"] },
  { to: "/aging", label: "Inventory Aging", icon: ChartBar, roles: ["super_admin", "hub_accountant", "warehouse_manager"] },
  { to: "/cycle-count", label: "Cycle Count", icon: ListMagnifyingGlass, roles: ["super_admin", "warehouse_manager"] },
  { to: "/pricing", label: "Pricing Engine", icon: CurrencyInr, roles: ["super_admin", "hub_accountant"] },
  { to: "/pricing/tiers", label: "Franchise Tiers", icon: Crown, roles: ["super_admin", "hub_accountant"] },
  { to: "/reports", label: "Reports", icon: ChartLine, roles: ["super_admin", "hub_accountant", "warehouse_manager"] },
  { to: "/settings/org", label: "Organization Settings", icon: Gear, roles: ["super_admin"] },
  { to: "/audit-logs", label: "Audit Logs", icon: ShieldCheck, roles: ["super_admin", "hub_accountant"] },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");

  const onSearchSubmit = (e) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/inventory?q=${encodeURIComponent(search.trim())}`);
      setSearch("");
    }
  };

  const visibleNav = NAV.filter((n) => !n.roles || n.roles.includes(user?.role));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-background transition-transform lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        data-testid="app-sidebar"
      >
        <div className="flex h-16 items-center justify-between border-b border-border px-5">
          <Link to="/" className="flex items-center gap-2" data-testid="brand-link">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-foreground text-background font-display text-sm font-bold">
              S
            </div>
            <div className="font-display text-base font-semibold tracking-tight">Servall</div>
          </Link>
          <button
            className="lg:hidden rounded p-1 hover:bg-muted"
            onClick={() => setSidebarOpen(false)}
            data-testid="sidebar-close-btn"
          >
            <X size={18} />
          </button>
        </div>
        <nav className="flex flex-col gap-1 overflow-y-auto px-3 py-4" style={{ maxHeight: "calc(100vh - 8rem)" }}>
          {visibleNav.map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`
                }
                data-testid={`nav-${n.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <Icon size={18} weight={location.pathname === n.to ? "fill" : "regular"} />
                <span>{n.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-border p-3">
          <div className="flex items-center justify-between rounded px-2 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold">{user?.full_name}</div>
              <div className="truncate text-[11px] text-muted-foreground">{ROLE_LABELS[user?.role]}</div>
            </div>
            <button
              onClick={logout}
              className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
              title="Sign out"
              data-testid="logout-btn"
            >
              <SignOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-border glass" data-testid="top-bar">
          <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-8">
            <button
              className="lg:hidden rounded p-2 hover:bg-muted"
              onClick={() => setSidebarOpen(true)}
              data-testid="sidebar-open-btn"
            >
              <MenuIcon size={20} />
            </button>
            <form onSubmit={onSearchSubmit} className="relative flex-1 max-w-md">
              <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU, part number, vendor…"
                className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                data-testid="global-search-input"
              />
            </form>
            <div className="flex items-center gap-1">
              <button
                onClick={toggle}
                className="rounded p-2 hover:bg-muted"
                title="Toggle theme"
                data-testid="theme-toggle-btn"
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
          </div>
        </header>
        <main className="px-4 py-6 lg:px-8 lg:py-8 animate-fade-in" data-testid="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
