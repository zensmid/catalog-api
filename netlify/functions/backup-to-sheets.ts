/**
 * backup-to-sheets
 * Scheduled: every 6 hours — dumps current orders to Google Sheets
 * Sheet ID: 1rP5O1KN8gy-RHZ4AcPSvzjeG9Pllf7QiKtVZYIATM8c
 */
import type { Config } from "@netlify/functions";
import { neon } from "@netlify/neon";

const SHEET_ID = "1rP5O1KN8gy-RHZ4AcPSvzjeG9Pllf7QiKtVZYIATM8c";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

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

async function clearSheet(token: string, range: string) {
  await fetch(`${SHEETS_API}/${SHEET_ID}/values/${range}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function writeToSheet(token: string, range: string, values: unknown[][]) {
  await fetch(
    `${SHEETS_API}/${SHEET_ID}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values }),
    }
  );
}

export default async function handler() {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    const token = await getAccessToken();

    // ── Pedidos sheet ──
    const orders = await sql`
      SELECT
        id, folio, cliente_nombre, cliente_email,
        status, total, tracking_number,
        created_at, updated_at
      FROM pedidos
      ORDER BY created_at DESC
      LIMIT 5000
    `;

    const headers = [
      ["ID", "Folio", "Cliente", "Email", "Status", "Total",
       "Tracking", "Creado", "Actualizado"],
    ];

    const rows = orders.map((o) => [
      o.id, o.folio, o.cliente_nombre, o.cliente_email,
      o.status, o.total, o.tracking_number ?? "",
      o.created_at, o.updated_at,
    ]);

    await clearSheet(token, "Pedidos!A1:Z");
    await writeToSheet(token, "Pedidos!A1", [...headers, ...rows]);

    // ── Analytics summary row ──
    const stats = await sql`
      SELECT
        COUNT(*) AS total,
        SUM(total) AS revenue,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'delivered') AS delivered
      FROM pedidos
    `;

    const now = new Date().toISOString();
    const s = stats[0];
    await writeToSheet(token, "Analytics!A2", [
      [now, s.total, s.revenue, s.pending, s.delivered],
    ]);

    console.log(`[backup-to-sheets] Wrote ${orders.length} orders to Sheets`);
    return {
      statusCode: 200,
      body: JSON.stringify({ written: orders.length }),
    };
  } catch (err) {
    console.error("[backup-to-sheets] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
}

export const config: Config = {
  schedule: "0 */6 * * *", // every 6 hours
};
