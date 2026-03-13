import { NextRequest, NextResponse } from "next/server";
import { neon } from "@netlify/neon";
import { requireAdmin } from "@/lib/auth";

const sql = neon(process.env.DATABASE_URL!);

const VALID_STATUSES = [
  "pending", "confirmed", "paid", "processing", "shipped",
  "in_transit", "out_for_delivery", "delivered", "cancelled", "returned",
];

// PATCH /api/orders/[id]/status — update order status (admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;

  const { status, tracking_number, carrier } = await req.json();

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const [order] = await sql`
    UPDATE pedidos
    SET
      status = ${status},
      tracking_number = COALESCE(${tracking_number ?? null}, tracking_number),
      carrier = COALESCE(${carrier ?? null}, carrier)
    WHERE id = ${params.id}
    RETURNING id, folio, cliente_email, cliente_phone, status
  `;

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Trigger WhatsApp notification
  const waStatuses = ["confirmed", "shipped", "in_transit", "out_for_delivery", "delivered", "cancelled"];
  if (waStatuses.includes(status)) {
    await fetch(`${process.env.AUTH0_BASE_URL}/.netlify/functions/webhook-whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pedido_id: order.id,
        new_status: status,
        tracking_number: tracking_number ?? null,
      }),
    }).catch((err) => console.error("WA webhook error:", err));
  }

  return NextResponse.json({ success: true, order });
}
