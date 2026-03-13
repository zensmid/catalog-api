-- ORVIA Database Schema (Netlify DB / Neon Postgres)
-- Run with: psql $DATABASE_URL -f db/schema.sql

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Clientes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth0_id      TEXT UNIQUE,
  nombre        TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  phone         TEXT,
  rfc           TEXT,
  direccion     JSONB,           -- { calle, colonia, ciudad, cp, estado }
  segmento      TEXT DEFAULT 'regular',  -- regular | vip | mayorista | preventa
  notas         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Productos / Inventario ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku           TEXT UNIQUE NOT NULL,
  descripcion   TEXT NOT NULL,
  categoria     TEXT,
  precio_menudeo NUMERIC(10,2) NOT NULL,
  precio_mayoreo NUMERIC(10,2) NOT NULL,
  precio_caja   NUMERIC(10,2),
  moq           INTEGER DEFAULT 1,
  stock         INTEGER NOT NULL DEFAULT 0,
  stock_minimo  INTEGER DEFAULT 10,
  proveedor     TEXT,
  imagen_url    TEXT,
  activo        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Pedidos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedidos (
  id                    SERIAL PRIMARY KEY,
  folio                 TEXT UNIQUE NOT NULL,
  cliente_id            UUID REFERENCES clientes(id),
  cliente_nombre        TEXT NOT NULL,
  cliente_email         TEXT NOT NULL,
  cliente_phone         TEXT,
  tipo                  TEXT DEFAULT 'normal',   -- normal | preventa
  status                TEXT NOT NULL DEFAULT 'pending',
  -- Statuses: pending | confirmed | paid | processing | shipped | in_transit
  --           out_for_delivery | delivered | cancelled | returned
  subtotal              NUMERIC(10,2) NOT NULL,
  descuento             NUMERIC(10,2) DEFAULT 0,
  envio                 NUMERIC(10,2) DEFAULT 0,
  total                 NUMERIC(10,2) NOT NULL,
  metodo_pago           TEXT,
  payment_reference     TEXT,
  paid_at               TIMESTAMPTZ,
  direccion_envio       JSONB,
  tracking_number       TEXT,
  carrier               TEXT,
  tracking_last_event   TEXT,
  tracking_updated_at   TIMESTAMPTZ,
  notas                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Detalle Pedido ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id          SERIAL PRIMARY KEY,
  pedido_id   INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  sku         TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  unit_price  NUMERIC(10,2) NOT NULL,
  subtotal    NUMERIC(10,2) NOT NULL
);

-- ─── Analytics Snapshots ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id          SERIAL PRIMARY KEY,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data        JSONB NOT NULL
);

-- ─── Notifications Log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications_log (
  id          SERIAL PRIMARY KEY,
  pedido_id   INTEGER REFERENCES pedidos(id),
  channel     TEXT NOT NULL,   -- email | whatsapp | sms
  status      TEXT NOT NULL,   -- payment_confirmed | order_shipped | etc.
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error       TEXT
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_created ON pedidos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_tracking ON pedidos(tracking_number) WHERE tracking_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_productos_sku ON productos(sku);
CREATE INDEX IF NOT EXISTS idx_productos_stock ON productos(stock) WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_analytics_computed ON analytics_snapshots(computed_at DESC);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_clientes_updated BEFORE UPDATE ON clientes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_productos_updated BEFORE UPDATE ON productos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_pedidos_updated BEFORE UPDATE ON pedidos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Folio generator ─────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS folio_seq START 1000;

CREATE OR REPLACE FUNCTION generate_folio()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.folio IS NULL THEN
    NEW.folio := 'ORV-' || TO_CHAR(NOW(), 'YYMM') || '-' || LPAD(nextval('folio_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_pedidos_folio BEFORE INSERT ON pedidos
    FOR EACH ROW EXECUTE FUNCTION generate_folio();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
