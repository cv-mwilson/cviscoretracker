# CVIS Core Bin Tracker — Project Summary
**Cardinal Valley Industrial Supply, Inc.**
**Built:** April 2026

---

## What Was Built

A complete core tracking and operations system for Cardinal Valley's remanufactured air starter business. The system covers three areas:

1. **Core Bin Tracker** — a web app (desktop + mobile) that gives a real-time view of all outstanding cores, customer banked cores, and CVIS-owned inventory
2. **NetSuite Integration** — a SuiteScript 2.0 RESTlet and OAuth Connected App that connects the tracker to NetSuite
3. **FastFields Automation** — a webhook server that bridges FastFields form submissions with NetSuite

---

## The Business Problem

CVIS sells remanufactured air starters. Every sale includes a core charge line — a fee held until the old starter (core) is returned. Tracking which cores have come back, which haven't, and how long they've been outstanding was entirely manual. There was no centralized view and no automated way to mark sales orders, invoices, or quotes as "core received."

---

## How It Works

### Core Types Tracked

| Type | Location | Description |
|---|---|---|
| Outstanding (bin) | Customer's facility | Cores in customer's bin, not yet collected |
| Customer banked | Right container at CVIS | Customer-owned cores stored at CVIS |
| CVIS owned | Left container at CVIS | Cores bought and owned by CVIS |

### Two Workflows

**Workflow A — Bin Pickup**
Core collected from customer's bin and brought to CVIS shop:
- Log receipt in the app (or FAB button)
- SO, Invoice, Quote auto-stamped "Core Received"
- Core Bank record status → Applied
- FastFields Core Receiving Log auto-submitted as paper trail
- AP/AR email notification sent to account@cardinalvalley.com with recommended credit amount (full if ≤30 days, 50% if >30 days) — credit is applied manually

**Workflow B — Bank Draw**
Pulling a core already at CVIS from a customer's bank for a new sales order:
- Select core in Banked Cores tab → "Use for SO"
- New SO stamped "Core Received"
- Core Bank record status → Applied
- No FastFields form (core already received)
- No credit email (bin customers not charged upfront)

### Credit Policy
- Within 30 days of sale date: **full credit**
- Past 30 days: **50% credit**
- Credit is calculated and shown in the AP/AR notification email but applied manually by the team

---

## Files Included

| File | Purpose |
|---|---|
| `cvis_core_tracker_mobile.html` | Mobile-first web app — the main Core Bin Tracker |
| `cvis_core_tracker_desktop.html` | Desktop version of the tracker |
| `cvis_core_restlet.js` | NetSuite SuiteScript 2.0 RESTlet — deploy inside NetSuite |
| `webhook_server.js` | Node.js server — bridges FastFields webhooks to NetSuite |
| `package.json` | Node.js dependencies for the webhook server |
| `.env.example` | Environment variables template |
| `DEPLOY_README.md` | Step-by-step deployment guide |
| `CVIS_Core_Tracker_Admin_Approval.docx` | Admin approval document for NetSuite integration |

---

## NetSuite Integration — What's Needed

### From Your NetSuite Admin (one-time setup)
1. Create a **Connected App** (Setup → Integration → Manage Integrations → New)
   - Name: CVIS Core Bin Tracker
   - Auth: Client Credentials (Machine to Machine)
   - Enable: REST Web Services + SuiteScript
   - Copy the Client ID and Client Secret (shown once only)

2. Upload and deploy **cvis_core_restlet.js**
   - Upload to: Documents → Files → SuiteScripts
   - Deploy as: RESTlet, Status: Released
   - Copy the External URL from the deployment page

3. Create or verify these **custom fields** on Transaction Line Fields:

| Field ID | Type | Purpose |
|---|---|---|
| custcol_core_received | Checkbox | Has core been returned? |
| custcol_core_received_date | Date | When core was received |
| custcol_core_destination | List | MASCO / CVIS / Hold / Warranty |
| custcol_starter_model | Free Text | Starter model number |
| custcol_serial_number | Free Text | Core serial number(s) |
| custcol_core_qty_ordered | Integer | How many cores on the order |
| custcol_core_qty_received | Integer | How many have come back (increments per receipt) |

Note: custcol_core_received (as "Core Rec'd?") already exists in your NetSuite.

### From FastFields
- Contact FastFields support to enable webhooks on your account
- Add webhook URL (your Railway server URL + /webhook/fastfields) to the Core Receiving Log form under Form Settings → Webhooks → On Submit
- Provide FastFields field IDs for: reference number, model number, serial number, customer name, destination, submitted by

### Webhook Server Deployment (Railway — free)
1. Go to railway.app → sign up with GitHub
2. Deploy webhook_server.js + package.json
3. Add environment variables: NS_ACCOUNT_ID (5471843), NS_CLIENT_ID, NS_CLIENT_SECRET, NS_RESTLET_URL
4. Railway provides your public webhook URL

---

## Mobile App Features

### Outstanding Tab
- All 64 outstanding cores from core bin customers
- Age badges: amber for 3-5 months, red ⚠ for 6+ months
- "Over 6 months" filter chip — currently 15 flagged
- Quantity progress bar on multi-unit orders (e.g. 7 of 9 received)
- Tap any card → pre-filled receipt form
- + FAB button → blank receipt form for unexpected arrivals
- Customer filter: dropdown on desktop, scrollable chips on mobile

### Customer Banked Cores Tab
- 9 customers, 95 total cores in right container
- Drill into any customer to see individual records with serial numbers
- "Use for SO →" button on each core for bank draw workflow

### CVIS Owned Inventory Tab
- Pulled from your CV_Core_Inventory.xlsx spreadsheet
- 38 starter models, 400+ total cores in left container
- Velocity indicator showing 12-month sales volume
- Filter by: high velocity, pre-engage, inertia

---

## NetSuite Saved Search

A saved search called "Outstanding Cores Owed" was built directly in NetSuite with these criteria:
- Type = Sales Order
- Status = open statuses
- Formula {item} contains "CORE CHARGE"
- Core Rec'd? = false

This shows all 1,370 historical core charge lines where the checkbox is unchecked. To make it actionable, add:
- Amount > 0 (removes cancelled/zero lines)
- Date on or after 1/1/2024 (or your preferred cutoff)

---

## Quantity Tracking

When a customer orders multiple starters (e.g. 9 T100V), the core charge is a single line with qty 9. The system tracks this with:
- `custcol_core_qty_ordered` — total cores on the order
- `custcol_core_qty_received` — increments by 1 per receipt log
- Line stays open until qty_received = qty_ordered
- Serial numbers accumulate comma-separated on the line
- AP/AR email shows "X of Y received — Z still outstanding"
- Subject line says "Partial Core Return (7/9)" vs "Core Return Credit Required"

---

## Key Contacts & Accounts
- NetSuite Account ID: 5471843
- AP/AR credit notification email: account@cardinalvalley.com
- FastFields: Core Receiving Log form (webhook setup needed)

---

## Outstanding Items / Next Steps
1. NetSuite admin approval and Connected App creation
2. RESTlet deployment
3. Custom fields creation (qty_ordered, qty_received, destination, starter_model, serial_number)
4. FastFields webhook enablement + field ID mapping
5. Railway deployment of webhook server
6. End-to-end test with one real core receipt
7. Update FastFields field IDs in webhook_server.js (FF_FIELDS object)
8. Confirm custom record type ID for Core Bank records (currently set to 'customrecord_starter_core' — verify with admin)
