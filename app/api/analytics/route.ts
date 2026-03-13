import { NextRequest, NextResponse } from "next/server";
import { neon } from "@netlify/neon";
import { requireAdmin } from "@/lib/auth";

const sql = neon(process.env.DATABASE_URL!);

// GET /api/analytics — latest KPI snapshot + live stats
export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;

  const [snapshot, liveStats, recentOrders, lowStock] = await Promise.all([
    // Latest analytics snapshot
    sql`
      SELECT data FROM analytics_snapshots
      ORDER BY computed_at DESC LIMIT 1
    `,
    // Live stats (last 24h)
    sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24h') AS orders_24h,
        SUM(total) FILTER (WHERE created_at >= NOW() - INTERVAL '24h') AS revenue_24h,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_total,
        COUNT(*) FILTER (WHERE status = 'in_transit') AS in_transit_total
      FROM pedidos
    `,
    // Recent orders
    sql`
      SELECT id, folio, cliente_nombre, status, total, created_at
      FROM pedidos
      ORDER BY created_at DESC LIMIT 5
    `,
    // Low stock alerts
    sql`
      SELECT sku, descripcion, stock, stock_minimo
      FROM productos
      WHERE stock <= stock_minimo AND activo = TRUE
      ORDER BY stock ASC LIMIT 10
    `,
  ]);

  return NextResponse.json({
    snapshot: snapshot[0]?.data ?? null,
    live: liveStats[0],
    recentOrders,
    lowStockAlerts: lowStock,
  });
}
