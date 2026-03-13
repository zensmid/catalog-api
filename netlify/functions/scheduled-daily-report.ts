/**
 * scheduled-daily-report
 * Scheduled: daily at 9am — sends pending orders summary to admin via Gmail
 */
import type { Config } from "@netlify/functions";
import { neon } from "@netlify/neon";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

async function getAccessToken(): Promise<string> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const { access_token } = await tokenRes.json();
  return access_token;
}

function buildEmailRaw(to: string, subject: string, html: string): string {
  const message = [
    `To: ${to}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ${subject}`,
    "",
    html,
  ].join("\n");
  return Buffer.from(message).toString("base64url");
}

export default async function handler() {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    const [pendingOrders, stats] = await Promise.all([
      sql`
        SELECT folio, cliente_nombre, total, created_at
        FROM pedidos
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 50
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) FILTER (WHERE status = 'in_transit') AS in_transit,
          SUM(total) FILTER (WHERE DATE(created_at) = CURRENT_DATE) AS revenue_today,
          COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) AS orders_today
        FROM pedidos
      `,
    ]);

    const s = stats[0];
    const rows = pendingOrders
      .map(
        (o) =>
          `<tr>
            <td>${o.folio}</td>
            <td>${o.cliente_nombre}</td>
            <td>$${Number(o.total).toFixed(2)}</td>
            <td>${new Date(o.created_at).toLocaleDateString("es-MX")}</td>
          </tr>`
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
      <head><style>
        body { font-family: Arial, sans-serif; color: #333; }
        h1 { color: #6B21A8; }
        table { border-collapse: collapse; width: 100%; }
        th { background: #6B21A8; color: white; padding: 8px; }
        td { padding: 8px; border-bottom: 1px solid #eee; }
        .stat { display: inline-block; margin: 8px; padding: 12px 24px;
                background: #F3E8FF; border-radius: 8px; text-align: center; }
        .stat strong { display: block; font-size: 24px; color: #6B21A8; }
      </style></head>
      <body>
        <h1>📦 Reporte Diario ORVIA — ${new Date().toLocaleDateString("es-MX")}</h1>
        <div>
          <div class="stat"><strong>${s.orders_today ?? 0}</strong>Pedidos hoy</div>
          <div class="stat"><strong>$${Number(s.revenue_today ?? 0).toFixed(2)}</strong>Ingresos hoy</div>
          <div class="stat"><strong>${s.pending}</strong>Pendientes</div>
          <div class="stat"><strong>${s.in_transit}</strong>En tránsito</div>
        </div>
        <h2>Pedidos Pendientes (${pendingOrders.length})</h2>
        <table>
          <thead><tr><th>Folio</th><th>Cliente</th><th>Total</th><th>Fecha</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#999;font-size:12px;">Generado automáticamente por ORVIA · ${new Date().toISOString()}</p>
      </body>
      </html>
    `;

    const token = await getAccessToken();
    const adminEmail = process.env.ADMIN_EMAIL ?? "admin@orvia.mx";
    const raw = buildEmailRaw(
      adminEmail,
      `📦 Reporte ORVIA — ${pendingOrders.length} pedidos pendientes`,
      html
    );

    await fetch(GMAIL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    console.log(`[daily-report] Sent report with ${pendingOrders.length} pending orders`);
    return {
      statusCode: 200,
      body: JSON.stringify({ sent: true, pending: pendingOrders.length }),
    };
  } catch (err) {
    console.error("[daily-report] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
}

export const config: Config = {
  schedule: "0 9 * * *", // daily at 9am UTC (adjust TZ as needed)
};
