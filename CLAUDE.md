# ORVIA - Claude Code Project Guide

## Project Overview
Full-stack e-commerce management platform for ORVIA with dashboards, order management,
inventory, CRM, finance, and analytics.

## Tech Stack
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Database**: Netlify DB (`@netlify/neon` - Neon Postgres)
- **Auth**: Auth0
- **Security**: Arcjet
- **API**: Netlify Functions (serverless)
- **Catalog API**: Python Flask (this repo - `/main.py`)

## MCP Integrations
All MCP servers are configured in `.mcp.json`:

| Server | Purpose | Key Config |
|--------|---------|------------|
| `google-sheets` | Sync pedidos to Sheet ID `1rP5O1KN8gy-...` | Auto-backup every 6h |
| `gmail` | Order confirmations & payment reminders | Templates in `/functions/email-templates/` |
| `netlify` | Auto-deploy client (`bright-fenglisu-7912bc`) & admin (`cozy-halva-68ce78`) | Trigger on push |
| `whatsapp` | Status updates to +52 565 940 0410 | Plantillas in `/functions/whatsapp-templates/` |
| `17track` | Shipment tracking (API: `BADA1144C...`) | Sync every hour |

## Specialized Agents

### Agent 1: Dashboard Master
**Role**: UI/UX developer for client and admin dashboards
**Focus**:
- `/app/dashboard/` - Cliente dashboard
- `/app/admin/` - Admin dashboard
- Tailwind CSS components, dark mode, responsive design
- Real-time updates via SSE or WebSockets

**Commands when working as Dashboard Master**:
- Create components in `/app/components/`
- Update styles in `/app/globals.css`
- Keep bundle size lean - prefer server components

### Agent 2: Backend Architect
**Role**: Netlify Functions and database setup
**Focus**:
- `/netlify/functions/` - All serverless functions
- Database schema in `/db/schema.sql`
- API route design and security (Arcjet middleware)
- Netlify DB connection via `@netlify/neon`

**Commands when working as Backend Architect**:
- New functions go in `/netlify/functions/`
- Use `@netlify/neon` for DB queries
- Apply Arcjet rate limiting on all public endpoints
- Auth0 JWT validation on protected routes

### Agent 3: Integration Engineer
**Role**: MCP server setup and external API connections
**Focus**:
- MCP configuration in `.mcp.json`
- `/netlify/functions/sync-*.ts` - Sync functions
- `/netlify/functions/webhook-*.ts` - Webhook handlers
- Test all integrations before marking complete

**Commands when working as Integration Engineer**:
- Test Google Sheets: read/write to sheet `1rP5O1KN8gy-RHZ4AcPSvzjeG9Pllf7QiKtVZYIATM8c`
- Test Gmail: send test confirmation email
- Test WhatsApp: send test message to +52 565 940 0410
- Test 17track: track a sample package

## Automation Schedule

| Trigger | Function | Action |
|---------|---------|--------|
| Daily 9am | `scheduled-daily-report` | Pedidos pendientes → email admin |
| Every 1h | `sync-17track` | Update tracking status in DB |
| Every 6h | `backup-to-sheets` | Dump orders to Google Sheets |
| Every 6h | `generate-analytics` | Compute KPIs, store in DB |
| Real-time | `webhook-whatsapp` | Send WA on order status change |
| Real-time | `webhook-payment` | Send email on payment received |

## Project Modules
1. **Dashboard Cliente** - `/app/dashboard/` - Order history, tracking, invoices
2. **Dashboard Admin** - `/app/admin/` - Full ops: orders, inventory, CRM, finance
3. **Pedidos** - Preventa + normal orders with status workflow
4. **Inventario** - Stock management, alerts, supplier sync
5. **CRM** - Customer profiles, purchase history, segments
6. **Finanzas** - Revenue, COGS, margins, payables/receivables
7. **Analytics** - Charts, KPIs, forecasting

## Environment Variables Required
```
# Auth0
AUTH0_SECRET
AUTH0_BASE_URL
AUTH0_ISSUER_BASE_URL
AUTH0_CLIENT_ID
AUTH0_CLIENT_SECRET

# Netlify DB (Neon)
DATABASE_URL

# Arcjet
ARCJET_KEY

# Google OAuth (for Sheets + Gmail MCPs)
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REFRESH_TOKEN

# Netlify
NETLIFY_AUTH_TOKEN

# WhatsApp Business
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID

# 17track
TRACK17_API_KEY=BADA1144C67775A66A6467AAF777FDA2
```

## Netlify Sites
- **Cliente**: https://bright-fenglisu-7912bc.netlify.app
- **Admin**: https://cozy-halva-68ce78.netlify.app

## Key Commands
```bash
# Install dependencies
npm install

# Dev server
npm run dev

# Deploy to Netlify
netlify deploy --prod

# Run catalog API locally
python main.py

# DB migrations
npm run db:migrate
```

## Code Style
- TypeScript strict mode
- Functional components, no class components
- Server components by default, `'use client'` only when needed
- Tailwind for all styling, no inline styles
- Zod for all schema validation
- Error boundaries on all page-level components
