"use client";

import { useEffect, useState } from "react";
import { useUser } from "@auth0/nextjs-auth0/client";

interface Order {
  id: number;
  folio: string;
  status: string;
  total: number;
  created_at: string;
  tracking_number?: string;
  tracking_last_event?: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:           { label: "Pendiente",        color: "bg-yellow-100 text-yellow-800" },
  confirmed:         { label: "Confirmado",        color: "bg-blue-100 text-blue-800" },
  paid:              { label: "Pagado",            color: "bg-green-100 text-green-800" },
  processing:        { label: "Procesando",        color: "bg-purple-100 text-purple-800" },
  shipped:           { label: "Enviado",           color: "bg-indigo-100 text-indigo-800" },
  in_transit:        { label: "En tránsito",       color: "bg-indigo-100 text-indigo-800" },
  out_for_delivery:  { label: "En reparto",        color: "bg-orange-100 text-orange-800" },
  delivered:         { label: "Entregado",         color: "bg-green-100 text-green-800" },
  cancelled:         { label: "Cancelado",         color: "bg-red-100 text-red-800" },
};

export default function ClienteDashboard() {
  const { user, isLoading } = useUser();
  const [orders, setOrders] = useState<Order[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetch("/api/orders?limit=20")
      .then((r) => r.json())
      .then((d) => setOrders(d.orders ?? []))
      .finally(() => setFetching(false));
  }, [user]);

  if (isLoading || fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <a href="/api/auth/login" className="px-6 py-3 bg-purple-600 text-white rounded-lg">
          Iniciar sesión
        </a>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-purple-700 to-purple-500 text-white px-6 py-4 shadow">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">ORVIA · Mis Pedidos</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm opacity-80">{user.name}</span>
            <a href="/api/auth/logout" className="text-sm underline opacity-70 hover:opacity-100">
              Salir
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {orders.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-5xl mb-4">📦</p>
            <p className="text-lg">No tienes pedidos aún</p>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const s = STATUS_LABELS[order.status] ?? { label: order.status, color: "bg-gray-100 text-gray-700" };
              return (
                <div key={order.id} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{order.folio}</p>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {new Date(order.created_at).toLocaleDateString("es-MX", {
                          year: "numeric", month: "long", day: "numeric",
                        })}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${s.color}`}>
                        {s.label}
                      </span>
                      <p className="mt-2 font-bold text-gray-900">
                        ${Number(order.total).toFixed(2)}
                      </p>
                    </div>
                  </div>
                  {order.tracking_number && (
                    <div className="mt-3 pt-3 border-t border-gray-50 text-sm text-gray-600">
                      <span className="font-medium">Tracking:</span>{" "}
                      <span className="font-mono">{order.tracking_number}</span>
                      {order.tracking_last_event && (
                        <p className="text-xs text-gray-400 mt-1">
                          🚚 {order.tracking_last_event}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
