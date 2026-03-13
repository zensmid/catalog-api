/**
 * webhook-whatsapp
 * Real-time: triggered when an order status changes
 * Sends WhatsApp message to client via WhatsApp Business API
 * Business number: +52 565 940 0410
 */
import type { Handler } from "@netlify/functions";
import { neon } from "@netlify/neon";
import arcjet, { shield } from "@arcjet/next";

const WA_API = "https://graph.facebook.com/v19.0";

const STATUS_MESSAGES: Record<string, { template: string; emoji: string }> = {
  confirmed: { template: "order_confirmed", emoji: "✅" },
  in_transit: { template: "order_shipped", emoji: "🚚" },
  out_for_delivery: { template: "order_out_for_delivery", emoji: "📦" },
  delivered: { template: "order_delivered", emoji: "🎉" },
  cancelled: { template: "order_cancelled", emoji: "❌" },
};

async function sendWhatsAppTemplate(
  phoneNumber: string,
  templateName: string,
  params: string[]
) {
  const res = await fetch(
    `${WA_API}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phoneNumber.replace(/\D/g, ""),
        type: "template",
        template: {
          name: templateName,
          language: { code: "es_MX" },
          components: [
            {
              type: "body",
              parameters: params.map((p) => ({ type: "text", text: p })),
            },
          ],
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API error: ${err}`);
  }
  return res.json();
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const body = JSON.parse(event.body ?? "{}");
    const { pedido_id, new_status, tracking_number } = body;

    if (!pedido_id || !new_status) {
      return { statusCode: 400, body: "Missing pedido_id or new_status" };
    }

    const [order] = await sql`
      SELECT folio, cliente_nombre, cliente_phone, total
      FROM pedidos
      WHERE id = ${pedido_id}
    `;

    if (!order || !order.cliente_phone) {
      return { statusCode: 404, body: "Order not found or no phone" };
    }

    const templateConfig = STATUS_MESSAGES[new_status];
    if (!templateConfig) {
      return { statusCode: 200, body: "No template for this status" };
    }

    const params = [
      order.cliente_nombre,
      order.folio,
      tracking_number ?? "",
    ];

    await sendWhatsAppTemplate(
      order.cliente_phone,
      templateConfig.template,
      params
    );

    await sql`
      INSERT INTO notifications_log (pedido_id, channel, status, sent_at)
      VALUES (${pedido_id}, 'whatsapp', ${new_status}, NOW())
    `;

    console.log(
      `[webhook-whatsapp] ${templateConfig.emoji} Sent to ${order.cliente_phone} for order ${order.folio}`
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ sent: true, to: order.cliente_phone }),
    };
  } catch (err) {
    console.error("[webhook-whatsapp] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
};
