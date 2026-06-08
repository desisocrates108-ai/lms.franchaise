import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Inventory from "@/pages/Inventory";
import StockEntry from "@/pages/StockEntry";
import Vendors from "@/pages/Vendors";
import Franchises from "@/pages/Franchises";
import Indents from "@/pages/Indents";
import PurchaseOrders from "@/pages/PurchaseOrders";
import DeliveryChallans from "@/pages/DeliveryChallans";
import Aging from "@/pages/Aging";
import CycleCount from "@/pages/CycleCount";
import Pricing from "@/pages/Pricing";
import FranchiseTiers from "@/pages/FranchiseTiers";
import BulkImport from "@/pages/BulkImport";
import NewOrder from "@/pages/NewOrder";
import AuditLogs from "@/pages/AuditLogs";
import Reports from "@/pages/Reports";
import "@/App.css";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
            <Route path="/inventory" element={<RequireAuth><Inventory /></RequireAuth>} />
            <Route path="/stock-entry" element={<RequireAuth><StockEntry /></RequireAuth>} />
            <Route path="/vendors" element={<RequireAuth><Vendors /></RequireAuth>} />
            <Route path="/franchises" element={<RequireAuth><Franchises /></RequireAuth>} />
            <Route path="/indents" element={<RequireAuth><Indents /></RequireAuth>} />
            <Route path="/purchase-orders" element={<RequireAuth><PurchaseOrders /></RequireAuth>} />
            <Route path="/delivery-challans" element={<RequireAuth><DeliveryChallans /></RequireAuth>} />
            <Route path="/aging" element={<RequireAuth><Aging /></RequireAuth>} />
            <Route path="/cycle-count" element={<RequireAuth><CycleCount /></RequireAuth>} />
            <Route path="/pricing" element={<RequireAuth><Pricing /></RequireAuth>} />
            <Route path="/pricing/tiers" element={<RequireAuth><FranchiseTiers /></RequireAuth>} />
            <Route path="/inventory/bulk-import" element={<RequireAuth><BulkImport /></RequireAuth>} />
            <Route path="/indents/new" element={<RequireAuth><NewOrder /></RequireAuth>} />
            <Route path="/audit-logs" element={<RequireAuth><AuditLogs /></RequireAuth>} />
            <Route path="/reports" element={<RequireAuth><Reports /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
