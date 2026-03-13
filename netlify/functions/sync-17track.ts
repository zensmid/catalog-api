/**
 * sync-17track
 * Scheduled: every hour — fetches latest tracking events from 17track
 * and updates order status in Netlify DB.
 */
import type { Config } from "@netlify/functions";
import { neon } from "@netlify/neon";

const TRACK17_API_KEY = process.env.TRACK17_API_KEY!;
const TRACK17_BASE_URL = "https://api.17track.net/track/v2.2";

async function getActiveTrackingNumbers(sql: ReturnType<typeof neon>) {
  const rows = await sql`
    SELECT id, tracking_number, carrier
    FROM pedidos
    WHERE status NOT IN ('delivered', 'cancelled')
      AND tracking_number IS NOT NULL
  `;
  return rows;
}

async function fetchTrackingUpdates(trackingNumbers: string[]) {
  const body = trackingNumbers.map((num) => ({ number: num }));

  const res = await fetch(`${TRACK17_BASE_URL}/gettrackinfo`, {
    method: "POST",
    headers: {
      "17token": TRACK17_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`17track API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return data.data?.accepted ?? [];
}

function mapTrackStatus(track17Status: number): string {
  // 17track status codes → ORVIA status
  const map: Record<number, string> = {
    0: "pending",
    10: "in_transit",
    20: "expired",
    30: "delivered",
    35: "undelivered",
    40: "returned",
    50: "cancelled",
  };
  return map[track17Status] ?? "in_transit";
}

async function updateOrderStatus(
  sql: ReturnType<typeof neon>,
  orderId: number,
  newStatus: string,
  lastEvent: string
) {
  await sql`
    UPDATE pedidos
    SET
      status = ${newStatus},
      tracking_last_event = ${lastEvent},
      tracking_updated_at = NOW()
    WHERE id = ${orderId}
  `;
}

export default async function handler() {
  const sql = neon(process.env.DATABASE_URL!);

  try {
    const orders = await getActiveTrackingNumbers(sql);

    if (orders.length === 0) {
      return { statusCode: 200, body: "No active shipments to sync." };
    }

    const trackingNums = orders.map((o: { tracking_number: string }) => o.tracking_number);
    const updates = await fetchTrackingUpdates(trackingNums);

    let synced = 0;
    for (const update of updates) {
      const order = orders.find(
        (o: { tracking_number: string }) => o.tracking_number === update.number
      );
      if (!order) continue;

      const latestEvent =
        update.track_info?.latest_event?.description ?? "Sin actualización";
      const statusCode = update.track_info?.latest_status?.status ?? 0;
      const newStatus = mapTrackStatus(statusCode);

      await updateOrderStatus(sql, order.id, newStatus, latestEvent);
      synced++;
    }

    console.log(`[sync-17track] Synced ${synced}/${orders.length} shipments`);
    return {
      statusCode: 200,
      body: JSON.stringify({ synced, total: orders.length }),
    };
  } catch (err) {
    console.error("[sync-17track] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
}

export const config: Config = {
  schedule: "0 * * * *", // every hour
};
