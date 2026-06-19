import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeSlash } from "@phosphor-icons/react";

const DEMO = [
  { role: "Super Admin", email: "admin@servall.com", pass: "Admin@123" },
  { role: "Hub Accountant", email: "accountant@servall.com", pass: "Accountant@123" },
  { role: "Warehouse Mgr", email: "warehouse@servall.com", pass: "Warehouse@123" },
  { role: "Franchise Mgr", email: "franchise@servall.com", pass: "Franchise@123" },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@servall.com");
  const [password, setPassword] = useState("Admin@123");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between bg-black text-white p-12 overflow-hidden">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1644079446600-219068676743?crop=entropy&cs=srgb&fm=jpg&q=80&w=1600')",
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "grayscale(0.4) contrast(1.05)",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/40 to-black/90" />
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-black font-display text-lg font-bold">
              S
            </div>
            <div className="font-display text-xl font-semibold tracking-tight">Servall</div>
          </div>
          <div className="mt-2 text-xs uppercase tracking-[0.3em] text-white/60">B2B Franchise ERP · Hub & Spoke</div>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-5xl font-semibold leading-tight tracking-tight">
            Run your spare-parts<br />network in one place.
          </h1>
          <p className="mt-5 text-white/70 text-sm leading-relaxed">
            Unified inventory, OCR invoice ingestion, smart fulfillment, and predictive analytics —
            built for multi-branch automotive distribution.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-4 text-xs">
            {[
              { v: "100ms", l: "Search Speed" },
              { v: "AI/OCR", l: "Invoice Parse" },
              { v: "Multi-Tier", l: "Hub & Spoke" },
            ].map((s) => (
              <div key={s.l} className="border border-white/15 rounded p-3">
                <div className="font-display text-lg font-semibold">{s.v}</div>
                <div className="text-white/50">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-xs text-white/40">© 2026 Servall</div>
      </div>

      {/* Right form */}
      <div className="flex flex-col justify-center p-8 lg:p-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-foreground text-background font-display text-sm font-bold">S</div>
            <div className="font-display text-base font-semibold">Servall</div>
          </div>
          <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Sign in</div>
          <h2 className="font-display text-3xl font-semibold mt-2 tracking-tight">Welcome back</h2>
          <p className="text-sm text-muted-foreground mt-1">Use your Servall ERP credentials.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4" data-testid="login-form">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@servall.com"
                required
                data-testid="login-email-input"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  data-testid="login-password-input"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  data-testid="login-show-password-btn"
                >
                  {showPwd ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 gap-2"
              data-testid="login-submit-btn"
            >
              {loading ? "Signing in…" : "Sign in"}
              {!loading && <ArrowRight size={16} />}
            </Button>
          </form>

          <div className="mt-8">
            <div className="text-xs uppercase tracking-[0.25em] text-muted-foreground mb-3">Demo Accounts</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.pass);
                  }}
                  className="text-left rounded border border-border p-2 hover:bg-muted transition-colors"
                  data-testid={`demo-${d.role.toLowerCase().replace(/\s/g, "-")}`}
                >
                  <div className="text-xs font-semibold">{d.role}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{d.email}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
