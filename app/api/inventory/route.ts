import { NextRequest, NextResponse } from "next/server";
import { neon } from "@netlify/neon";
import { requireAdmin } from "@/lib/auth";
import { ajPublicApi } from "@/lib/arcjet";

const sql = neon(process.env.DATABASE_URL!);

// GET /api/inventory
export async function GET(req: NextRequest) {
  const decision = await ajPublicApi.protect(req);
  if (decision.isDenied()) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("q");
  const categoria = searchParams.get("categoria");
  const lowStock = searchParams.get("low_stock") === "true";
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

  let productos;

  if (search) {
    productos = await sql`
      SELECT *, COUNT(*) OVER() AS total_count
      FROM productos
      WHERE activo = TRUE
        AND (descripcion ILIKE ${"%" + search + "%"} OR sku ILIKE ${"%" + search + "%"})
      ORDER BY descripcion
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (categoria) {
    productos = await sql`
      SELECT *, COUNT(*) OVER() AS total_count
      FROM productos
      WHERE activo = TRUE AND categoria = ${categoria}
      ORDER BY descripcion
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else if (lowStock) {
    productos = await sql`
      SELECT *, COUNT(*) OVER() AS total_count
      FROM productos
      WHERE activo = TRUE AND stock <= stock_minimo
      ORDER BY stock ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
  } else {
    productos = await sql`
      SELECT *, COUNT(*) OVER() AS total_count
      FROM productos
      WHERE activo = TRUE
      ORDER BY descripcion
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  const total = productos[0]?.total_count ?? 0;
  return NextResponse.json({
    productos,
    pagination: { page, limit, total: Number(total) },
  });
}

// PATCH /api/inventory — update stock (admin only)
export async function PATCH(req: NextRequest) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;

  const { sku, stock_delta, stock_absoluto } = await req.json();
  if (!sku) {
    return NextResponse.json({ error: "Missing sku" }, { status: 400 });
  }

  let producto;
  if (typeof stock_absoluto === "number") {
    [producto] = await sql`
      UPDATE productos SET stock = ${stock_absoluto}
      WHERE sku = ${sku}
      RETURNING sku, descripcion, stock
    `;
  } else if (typeof stock_delta === "number") {
    [producto] = await sql`
      UPDATE productos SET stock = stock + ${stock_delta}
      WHERE sku = ${sku}
      RETURNING sku, descripcion, stock
    `;
  } else {
    return NextResponse.json(
      { error: "Provide stock_delta or stock_absoluto" },
      { status: 400 }
    );
  }

  if (!producto) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, producto });
}
