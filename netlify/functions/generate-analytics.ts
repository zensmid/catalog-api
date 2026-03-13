/**
 * generate-analytics
 * Scheduled: every 6 hours — computes KPIs and stores snapshot in DB
 */
import type { Config } from "@netlify/functions";
import { neon } from "@netlify/neon";

export default async function handler() {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    const [orderStats, topProducts, topClients] = await Promise.all([
      sql`
        SELECT
          COUNT(*) AS total_orders,
          SUM(total) AS total_revenue,
          AVG(total) AS avg_order_value,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'in_transit') AS in_transit,
          COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
          COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) AS orders_today,
          SUM(total) FILTER (WHERE DATE(created_at) = CURRENT_DATE) AS revenue_today,
          COUNT(*) FILTER (WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '7 days') AS orders_7d,
          SUM(total) FILTER (WHERE DATE(created_at) >= CURRENT_DATE - INTERVAL '7 days') AS revenue_7d,
          COUNT(*) FILTER (WHERE DATE(created_at) >= DATE_TRUNC('month', CURRENT_DATE)) AS orders_mtd,
          SUM(total) FILTER (WHERE DATE(created_at) >= DATE_TRUNC('month', CURRENT_DATE)) AS revenue_mtd
        FROM pedidos
      `,
      sql`
        SELECT sku, description, SUM(quantity) AS units_sold, SUM(subtotal) AS revenue
        FROM order_items
        GROUP BY sku, description
        ORDER BY units_sold DESC
        LIMIT 10
      `,
      sql`
        SELECT cliente_id, cliente_nombre, COUNT(*) AS total_orders, SUM(total) AS ltv
        FROM pedidos
        GROUP BY cliente_id, cliente_nombre
        ORDER BY ltv DESC
        LIMIT 10
      `,
    ]);

    const snapshot = {
      computed_at: new Date().toISOString(),
      orders: orderStats[0],
      top_products: topProducts,
      top_clients: topClients,
    };

    await sql`
      INSERT INTO analytics_snapshots (computed_at, data)
      VALUES (NOW(), ${JSON.stringify(snapshot)}::jsonb)
    `;

    console.log("[generate-analytics] Snapshot stored:", snapshot.computed_at);
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, computed_at: snapshot.computed_at }),
    };
  } catch (err) {
    console.error("[generate-analytics] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
}

export const config: Config = {
  schedule: "0 */6 * * *",
};
