# TechStar Store

A STEM and electronics e-commerce platform for Tanzania — storefront, customer accounts,
and a full admin console with CRUD over every entity in the system.

**React 18 + TypeScript · Express + Prisma · MySQL / MariaDB**

---

## What is in this repository

| Path | Contents |
| --- | --- |
| `docs/` | The 172-page technical specification (PDF + source), and `assets/schema.sql` |
| `apps/api/` | Express + Prisma API — 90+ endpoints, 40 tables |
| `apps/web/` | React storefront and admin console |
| `research/` | Reconnaissance of the reference platform the brief was based on |
| `screenshots/` | Captured screens, plus the CDP scripts that drive them |

---

## Requirements

- **Node.js 20+** (developed on 24)
- **MySQL 8 or MariaDB 10.4+** — the XAMPP install already on this machine is fine
- A modern browser

---

## Getting it running

> **PowerShell note:** the folder name contains a space, so quote it —
> `cd "techstar store"`. Tab completion adds the quotes for you.

### 1 · Start MySQL

Open the XAMPP control panel and start **MySQL**, or from a shell:

```bash
C:/xampp/mysql/bin/mysqld.exe --defaults-file=C:/xampp/mysql/bin/my.ini --standalone
```

### 2 · Create the database

```bash
C:/xampp/mysql/bin/mysql.exe -u root -e "CREATE DATABASE IF NOT EXISTS techstar CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 3 · Configure

`.env` at the repository root is already set up for XAMPP with no root password.
Change `DATABASE_URL` if yours differs.

### 4 · Install, migrate, seed

```bash
npm install
npm run db:push      # creates all 40 tables
npm run db:seed      # taxonomy, settings, and the demo catalogue
```

The seed prints the sign-in details when it finishes. It is idempotent, so
re-running it will not duplicate anything — but that also means it will **skip
the demo catalogue if products already exist**. To rebuild from scratch, use
`npm run db:reset`.

### 5 · Run

```bash
npm run dev          # API on :4100, web on :5173
```

Open **http://localhost:5173**.

| Role | Email | Password |
| --- | --- | --- |
| Admin (owner) | `admin@techstar.co.tz` | `TechStar#2026` |
| Customer | `amina@example.com` | `Customer#2026` |

The admin console is at **/admin**.

> The API listens on **4100** rather than the conventional 4000 because another
> process on this machine already holds 4000. To change it, set `API_PORT` and
> `MEDIA_PUBLIC_URL` in `.env` — the Vite proxy picks the port up from there.

---

## What the seed creates

- **4 suppliers** with lead times, and a cost price on every variant, so profit
  reporting has real data from the first run
- **17 categories, 102 subcategories** — a full electronics-trade taxonomy with
  the positional SKU scheme (category `05` → subcategory `0510` → product
  `0510003` → variant `051000301`)
- **62 products with real photography**, 19 of them with variant matrices
  (resistance values, RAM sizes, capacities, cable ends)
- **26 regions with districts**, 3 shipping methods, 41 site settings
- **8 customers and 14 orders** spanning every lifecycle state, with payments in
  each state, so no admin screen is ever empty
- Reviews, articles, banners, partners, services, FAQs, and search analytics
  including deliberate zero-result terms

### About the demo images

The 62 product photographs are openly licensed images from Wikimedia Commons,
downloaded by `apps/api/prisma/fetch-seed-images.mjs`. Attribution — source page,
licence and author — is recorded in `apps/api/prisma/seed-images/manifest.json`.

**Replace them with your own photography before launch.** They are demo assets
chosen to make the interface honest to review, not a licence to publish.

To re-fetch or extend the set:

```bash
cd apps/api && node prisma/fetch-seed-images.mjs
```

---

## Inventory management

| Screen | What it is for |
| --- | --- |
| **Stock editor** | Spreadsheet-style grid. Edit stock, price, cost, reorder point and bin for many lines at once; only changed cells are sent, and nothing is written until you press Save. Every stock change writes a ledger entry with your chosen reason. |
| **What to reorder** | Reorder suggestions from **actual sales velocity**, not a fixed threshold. Shows units sold, units per day, and **days of cover** — then suggests a quantity. Tick lines and turn them straight into a purchase order. |
| **Purchase orders** | Raise an order against a supplier, mark it ordered, then **receive stock** — including partial receipts. Receiving raises stock, rolls the weighted-average cost, and writes the ledger. |
| **Stocktakes** | Generate a count sheet for everything, one category, one supplier, or just low-stock lines. Enter counts, see the variance and its value, then post — each correction becomes an auditable stock movement. Lines you did not count are left alone. |
| **Suppliers** | Who you buy from and their lead time, which is what drives reorder timing. |

### Two decisions worth knowing about

**Cost is snapshotted at the moment of sale.** `order_items.unit_cost_amount` records
what the item cost when it sold. Repricing a product or restocking it at a different
cost can never retroactively rewrite last month's margin.

**Receiving uses weighted-average cost**, not last-price. If you hold 42 units at
TZS 18,432 and receive 12 at TZS 26,000, the cost becomes TZS 20,114 — what the stock
on the shelf is actually worth, rather than what the newest box cost.

---

## Analytics

| Report | Answers |
| --- | --- |
| **Profit & margin** | Revenue, cost of goods, gross profit and margin — with period comparison, a revenue/profit chart, the most profitable products, and profit by category. |
| **What to stock next** | Best sellers ranked by profit, units or revenue; **demand you are missing** (zero-result searches, back-in-stock requests, wishlisted-but-out-of-stock); and **dead stock** — what is not moving and how much capital it holds. |
| **Customers & operations** | Repeat rate, lifetime value, orders by region; plus payment lag, time to ship, and cancellation/expiry rates. |

Every report exports to CSV (UTF-8 with BOM, so Excel opens Swahili correctly).

**On honesty in the numbers:** lines with no recorded cost are *excluded* from margin
rather than counted as pure profit, and each report shows its **cost coverage** so you
know how much of the revenue it could actually cost. A gap is reported, never hidden.

---

## Admin image handling

Every image-bearing entity — products, banners, articles, services, partners,
and customer profile photos — takes uploads **straight from the administrator's
device**, by drag-and-drop or a file picker. Uploads go to the shared media
library immediately, so a half-finished form never loses one.

Uploads are validated by **magic bytes, not the filename or the
`Content-Type` header** — a PHP script renamed to `.jpg` is rejected with a 415.
Identical files are deduplicated by SHA-256, and an image still referenced by a
product cannot be deleted.

---

## Useful commands

```bash
npm run dev              # both apps
npm run dev:api          # API only
npm run dev:web          # web only
npm run build            # production build of both
npm run db:push          # apply the schema
npm run db:seed          # seed (idempotent — safe to re-run)
npm run db:studio        # Prisma Studio
npm run db:reset         # wipe and re-seed from scratch
npm run db:generate      # regenerate the Prisma client
```

### Ports

`npm run dev` clears a stale API listener on its own port before starting, so a
crashed or orphaned server never blocks the next run. If the port is held by
something that is not ours, it says so rather than failing silently.

The Vite proxy reads `API_PORT` from the same `.env` the server reads, so
changing the port in one place is enough.

**If `db:push` reports `EPERM … query_engine-windows.dll.node`,** a running API
process is holding the Prisma engine open. Stop `npm run dev` first, or:

```powershell
Get-Process node | Stop-Process -Force
```

`SEED_DEMO=false npm run db:seed` seeds only the core data — taxonomy, settings,
roles, locations — with no demo catalogue. That is the production path.

---

## Architecture notes

**Money** is stored as integer minor units (whole shillings). No float ever
touches a price.

**Stock** moves only through `adjustStock()`, which writes a ledger row in the
same transaction. Placing an order *reserves*; verifying payment *deducts*.
Unpaid orders expire after 48 hours and the reservation is released by a
scheduled job.

**Order status** is three independent axes — lifecycle, payment, fulfilment —
and lifecycle changes pass through a guarded transition table in
`apps/api/src/lib/orderState.ts`. Nothing writes `orders.status` directly.

**Payments** are manual mobile-money reconciliation: the customer records the
number they paid from, an administrator verifies against the merchant
notification. The provider reference is unique, so the same transaction can
never be credited to two orders. An aggregator adapter drops in behind the same
interface without touching the order code.

**Auth** uses a 15-minute access token held in memory only, plus a rotating
refresh token in an httpOnly cookie. Reuse of a rotated token revokes the entire
session family.

**Every admin mutation** writes an audit record with actor, before, after and
request id.

---

## Verifying it works

`screenshots/flow.mjs` drives a complete guest purchase through the real UI —
add to cart, fill the checkout, place the order, land on the confirmation page.

```bash
# start Chrome with remote debugging, then:
cd screenshots && node flow.mjs
```

Last run: **8/8 checks passed**, order `TS-2026-000017` created.

---

## Known gaps

These are deliberate and documented, not oversights:

- **Image derivatives** are not generated — the `sm`/`md`/`lg` URLs point at the
  same stored original. Adding `sharp` is a drop-in change behind
  `apps/api/src/lib/storage.ts`; nothing outside that module knows.
- **Email and SMS** log to the console. The provider interfaces are defined; the
  adapters need credentials.
- **Search** uses ranked `LIKE` matching rather than a full-text index. Correct
  at this catalogue size; §16.1 of the specification sets out the trigger for
  revisiting it.
- **Legal pages** carry placeholder wording and need review before launch.
- **Password hashing** uses bcrypt rather than the specified Argon2id, to avoid
  a native build dependency on Windows.

---

## The specification

`docs/TechStar-Store-Technical-Specification.pdf` — 172 pages covering the data
model, API contract, every screen, the business rules, security, and a phased
delivery plan. Appendix E is the executable DDL; the PDF is generated from it,
so the document and the schema cannot drift apart.

Rebuild it with:

```bash
cd docs && python gen_appendix_e.py && python build.py
```
