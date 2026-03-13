/**
 * webhook-payment
 * Real-time: triggered when a payment is received
 * Sends confirmation email via Gmail API + updates order status
 */
import type { Handler } from "@netlify/functions";
import { neon } from "@netlify/neon";

const GMAIL_API =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

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

function buildPaymentConfirmationEmail(
  to: string,
  nombre: string,
  folio: string,
  total: number,
  fecha: string
): string {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><style>
      body { font-family: Arial, sans-serif; background: #F9FAFB; margin: 0; padding: 0; }
      .container { max-width: 600px; margin: 40px auto; background: white;
                   border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
      .header { background: linear-gradient(135deg, #6B21A8, #9333EA);
                padding: 32px; text-align: center; color: white; }
      .header h1 { margin: 0; font-size: 28px; }
      .body { padding: 32px; }
      .amount { font-size: 36px; font-weight: bold; color: #6B21A8; text-align: center;
                margin: 24px 0; }
      .detail { display: flex; justify-content: space-between; padding: 12px 0;
                border-bottom: 1px solid #eee; }
      .footer { background: #F3F4F6; padding: 24px; text-align: center;
                color: #6B7280; font-size: 12px; }
    </style></head>
    <body>
      <div class="container">
        <div class="header">
          <h1>✅ Pago Confirmado</h1>
          <p style="margin:8px 0 0;">ORVIA · Tu pedido está en proceso</p>
        </div>
        <div class="body">
          <p>Hola <strong>${nombre}</strong>,</p>
          <p>Hemos recibido tu pago correctamente. Aquí están los detalles:</p>
          <div class="amount">$${total.toFixed(2)} MXN</div>
          <div class="detail"><span>Folio</span><strong>${folio}</strong></div>
          <div class="detail"><span>Fecha</span><strong>${fecha}</strong></div>
          <div class="detail"><span>Estado</span><strong>✅ Pagado</strong></div>
          <p style="margin-top:24px;">Prepararemos tu pedido en las próximas 24-48 horas hábiles.
          Recibirás una notificación cuando tu pedido sea enviado.</p>
        </div>
        <div class="footer">
          ORVIA · contacto@orvia.mx · +52 565 940 0410<br/>
          Este es un correo automático, por favor no responder.
        </div>
      </div>
    </body>
    </html>
  `;

  const message = [
    `To: ${to}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: ✅ Pago confirmado — Folio ${folio}`,
    "",
    html,
  ].join("\n");

  return Buffer.from(message).toString("base64url");
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const body = JSON.parse(event.body ?? "{}");
    const { pedido_id, payment_reference, amount } = body;

    if (!pedido_id) {
      return { statusCode: 400, body: "Missing pedido_id" };
    }

    const [order] = await sql`
      SELECT folio, cliente_nombre, cliente_email, total, created_at
      FROM pedidos WHERE id = ${pedido_id}
    `;

    if (!order) {
      return { statusCode: 404, body: "Order not found" };
    }

    // Mark order as paid
    await sql`
      UPDATE pedidos
      SET status = 'paid',
          payment_reference = ${payment_reference ?? null},
          paid_at = NOW()
      WHERE id = ${pedido_id}
    `;

    // Send confirmation email
    const token = await getAccessToken();
    const raw = buildPaymentConfirmationEmail(
      order.cliente_email,
      order.cliente_nombre,
      order.folio,
      Number(amount ?? order.total),
      new Date().toLocaleDateString("es-MX")
    );

    await fetch(GMAIL_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });

    await sql`
      INSERT INTO notifications_log (pedido_id, channel, status, sent_at)
      VALUES (${pedido_id}, 'email', 'payment_confirmed', NOW())
    `;

    console.log(`[webhook-payment] ✅ Confirmed payment for order ${order.folio}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ confirmed: true, folio: order.folio }),
    };
  } catch (err) {
    console.error("[webhook-payment] Error:", err);
    return { statusCode: 500, body: String(err) };
  }
};
