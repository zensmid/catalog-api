"use client";

import { useEffect, useState } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";

interface LiveStats {
  orders_24h: number;
  revenue_24h: number;
  pending_total: number;
  in_transit_total: number;
}

interface RecentOrder {
  id: number;
  folio: string;
  cliente_nombre: string;
  status: string;
  total: number;
  created_at: string;
}

interface LowStockItem {
  sku: string;
  descripcion: string;
  stock: number;
  stock_minimo: number;
}

interface Analytics {
  live: LiveStats;
  recentOrders: RecentOrder[];
  lowStockAlerts: LowStockItem[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-600 bg-yellow-50",
  paid: "text-green-600 bg-green-50",
  in_transit: "text-blue-600 bg-blue-50",
  delivered: "text-emerald-600 bg-emerald-50",
  cancelled: "text-red-600 bg-red-50",
};

export default function AdminDashboard() {
  const { user, isLoading } = useUser();
  const [data, setData] = useState<Analytics | null>(null);
  const [fetching, setFetching] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "orders" | "inventory">("overview");

  useEffect(() => {
    if (!user) return;
    fetch("/api/analytics")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setFetching(false));
  }, [user]);

  if (isLoading || fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <a href="/api/auth/login" className="px-6 py-3 bg-purple-600 text-white rounded-lg">
          Iniciar sesión (Admin)
        </a>
      </div>
    );
  }

  const live = data?.live;

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Sidebar + Content layout */}
      <div className="flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col">
          <div className="px-6 py-5 border-b border-gray-800">
            <h1 className="text-lg font-bold text-purple-400">ORVIA Admin</h1>
            <p className="text-xs text-gray-500 mt-0.5">{user.name}</p>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {[
              { id: "overview", label: "Resumen", icon: "📊" },
              { id: "orders",   label: "Pedidos",  icon: "📦" },
              { id: "inventory",label: "Inventario",icon: "🗃️" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as typeof activeTab)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === item.id
                    ? "bg-purple-700 text-white"
                    : "text-gray-400 hover:bg-gray-800 hover:text-white"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="px-4 py-4 border-t border-gray-800">
            <a
              href="/api/auth/logout"
              className="block text-center text-xs text-gray-500 hover:text-gray-300"
            >
              Cerrar sesión
            </a>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 overflow-y-auto">
          <header className="bg-gray-900 border-b border-gray-800 px-8 py-4">
            <h2 className="text-lg font-semibold capitalize">{activeTab}</h2>
          </header>

          <div className="px-8 py-6">
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "Pedidos (24h)", value: live?.orders_24h ?? 0, icon: "📦" },
                    { label: "Ingresos (24h)", value: `$${Number(live?.revenue_24h ?? 0).toFixed(0)}`, icon: "💰" },
                    { label: "Pendientes", value: live?.pending_total ?? 0, icon: "⏳", alert: (live?.pending_total ?? 0) > 10 },
                    { label: "En tránsito", value: live?.in_transit_total ?? 0, icon: "🚚" },
                  ].map((kpi) => (
                    <div
                      key={kpi.label}
                      className={`rounded-xl p-5 border ${
                        kpi.alert ? "bg-red-950 border-red-800" : "bg-gray-800 border-gray-700"
                      }`}
                    >
                      <p className="text-2xl mb-1">{kpi.icon}</p>
                      <p className="text-2xl font-bold text-white">{kpi.value}</p>
                      <p className="text-xs text-gray-400 mt-1">{kpi.label}</p>
                    </div>
                  ))}
                </div>

                {/* Recent Orders */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-700">
                    <h3 className="font-semibold text-sm">Pedidos recientes</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-750">
                      <tr className="border-b border-gray-700">
                        {["Folio", "Cliente", "Status", "Total", "Fecha"].map((h) => (
                          <th key={h} className="text-left px-5 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.recentOrders ?? []).map((o) => (
                        <tr key={o.id} className="border-b border-gray-700 hover:bg-gray-750 transition-colors">
                          <td className="px-5 py-3 font-mono text-purple-400">{o.folio}</td>
                          <td className="px-5 py-3">{o.cliente_nombre}</td>
                          <td className="px-5 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[o.status] ?? "text-gray-400 bg-gray-700"}`}>
                              {o.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-medium">${Number(o.total).toFixed(2)}</td>
                          <td className="px-5 py-3 text-gray-400">
                            {new Date(o.created_at).toLocaleDateString("es-MX")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Low Stock Alerts */}
                {(data?.lowStockAlerts?.length ?? 0) > 0 && (
                  <div className="bg-red-950 border border-red-800 rounded-xl p-5">
                    <h3 className="text-red-400 font-semibold text-sm mb-3">
                      ⚠️ Stock bajo ({data?.lowStockAlerts.length} productos)
                    </h3>
                    <div className="space-y-2">
                      {data?.lowStockAlerts.map((p) => (
                        <div key={p.sku} className="flex justify-between text-sm">
                          <span className="text-gray-300">{p.descripcion}</span>
                          <span className="text-red-400 font-mono">
                            {p.stock}/{p.stock_minimo}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "orders" && (
              <div className="text-center py-20 text-gray-500">
                <p className="text-4xl mb-3">📦</p>
                <p>Vista completa de pedidos — en desarrollo</p>
              </div>
            )}

            {activeTab === "inventory" && (
              <div className="text-center py-20 text-gray-500">
                <p className="text-4xl mb-3">🗃️</p>
                <p>Gestión de inventario — en desarrollo</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
