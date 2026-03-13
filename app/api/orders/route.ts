import { NextRequest, NextResponse } from "next/server";
import { neon } from "@netlify/neon";
import { requireAuth } from "@/lib/auth";
import { ajPublicApi } from "@/lib/arcjet";

const sql = neon(process.env.DATABASE_URL!);

// GET /api/orders — list orders (admin sees all, cliente sees own)
export async function GET(req: NextRequest) {
  // Arcjet shield
  const decision = await ajPublicApi.protect(req);
  if (decision.isDenied()) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20"), 100);
  const offset = (page - 1) * limit;

  const isAdmin = (user["https://orvia.mx/roles"] as string[] ?? []).includes("admin");

  let orders;
  if (isAdmin) {
    orders = status
      ? await sql`
          SELECT p.*, COUNT(*) OVER() AS total_count
          FROM pedidos p
          WHERE p.status = ${status}
          ORDER BY p.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      : await sql`
          SELECT p.*, COUNT(*) OVER() AS total_count
          FROM pedidos p
          ORDER BY p.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
  } else {
    const email = user.email as string;
    orders = await sql`
      SELECT p.*, COUNT(*) OVER() AS total_count
      FROM pedidos p
      WHERE p.cliente_email = ${email}
      ORDER BY p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  const total = orders[0]?.total_count ?? 0;
  return NextResponse.json({
    orders,
    pagination: { page, limit, total: Number(total) },
  });
}

// POST /api/orders — create new order
export async function POST(req: NextRequest) {
  const decision = await ajPublicApi.protect(req);
  if (decision.isDenied()) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  const body = await req.json();
  const { cliente_nombre, cliente_email, cliente_phone, items, tipo, direccion_envio, notas } = body;

  if (!items?.length) {
    return NextResponse.json({ error: "Order must have items" }, { status: 400 });
  }

  // Calculate totals
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.unit_price * item.quantity;
  }
  const total = subtotal + (body.envio ?? 0) - (body.descuento ?? 0);

  const [order] = await sql`
    INSERT INTO pedidos (
      cliente_nombre, cliente_email, cliente_phone,
      tipo, subtotal, descuento, envio, total,
      direccion_envio, notas
    ) VALUES (
      ${cliente_nombre}, ${cliente_email}, ${cliente_phone ?? null},
      ${tipo ?? "normal"}, ${subtotal}, ${body.descuento ?? 0}, ${body.envio ?? 0}, ${total},
      ${JSON.stringify(direccion_envio ?? {})}::jsonb, ${notas ?? null}
    )
    RETURNING id, folio
  `;

  // Insert items
  for (const item of items) {
    await sql`
      INSERT INTO order_items (pedido_id, sku, description, quantity, unit_price, subtotal)
      VALUES (${order.id}, ${item.sku}, ${item.description}, ${item.quantity},
              ${item.unit_price}, ${item.unit_price * item.quantity})
    `;
  }

  return NextResponse.json({ success: true, order }, { status: 201 });
}
