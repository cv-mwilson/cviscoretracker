# CVIS Core Bin Tracker — Project Summary
**Cardinal Valley Industrial Supply, Inc.**
**Built:** April 2026

---

## What Was Built

A complete core tracking and operations system for Cardinal Valley's remanufactured air starter business. The system covers two areas:

1. **Core Bin Tracker** — a web app (desktop + mobile) that gives a real-time view of all outstanding cores, customer banked cores, and CVIS-owned inventory
2. **NetSuite Integration** — a SuiteScript 2.0 RESTlet, OAuth TBA auth, and a UserEventScript that connects the tracker to NetSuite and automates credit memo creation

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
- Credit memo auto-created in NetSuite when custcol235 is checked on the Invoice line (handled by auto_core_credit.js)

**Workflow B — Bank Draw**
Pulling a core already at CVIS from a customer's bank for a new sales order:
- Select core in Banked Cores tab → "Use for SO"
- New SO stamped "Core Received"
- Core Bank record status → Applied
- No credit email (bin customers not charged upfront)

### Credit Policy
- Within 30 days of sale date: **full credit**
- Past 30 days: **50% credit**

---

## Files Included

| File | Purpose |
|---|---|
| `mobile.html` | Mobile-first web app — the main Core Bin Tracker |
| `desktop.html` | Desktop version of the tracker |
| `cvis_core_restlet.js` | NetSuite SuiteScript 2.0 RESTlet — deploy inside NetSuite |
| `auto_core_credit.js` | NetSuite UserEventScript — auto-creates credit memos on Invoice save |
| `DEPLOY_README.md` | Step-by-step deployment guide |

---

## NetSuite Integration — What's Needed

### From Your NetSuite Admin (one-time setup)
1. Create a **Connected App** (Setup → Integration → Manage Integrations → New)
   - Name: CVIS Core Bin Tracker
   - Auth: Token-Based Authentication
   - Enable: REST Web Services + SuiteScript
   - Copy the Consumer Key and Consumer Secret (shown once only)

2. Upload and deploy **cvis_core_restlet.js**
   - Upload to: Documents → Files → SuiteScripts
   - Deploy as: RESTlet, Status: Released
   - Copy the External URL from the deployment page

3. Upload and deploy **auto_core_credit.js**
   - Upload to: Documents → Files → SuiteScripts
   - Deploy as: UserEventScript on Invoice, After Submit, Status: Released

4. Create or verify these **custom fields** on Transaction Line Fields:

| Field ID | Type | Purpose |
|---|---|---|
| custcol_core_received | Checkbox | Has core been returned? |
| custcol_core_received_date | Date | When core was received |
| custcol_core_destination | List | MASCO / CVIS / Hold / Warranty |
| custcol_starter_model | Free Text | Starter model number |
| custcol_serial_number | Free Text | Core serial number(s) |
| custcol_core_qty_ordered | Integer | How many cores on the order |
| custcol_core_qty_received | Integer | How many have come back (increments per receipt) |
| custcol235 | Checkbox | Trigger: auto credit memo creation on Invoice line |
| custcol236 | Checkbox | Marks Invoice line as already processed (prevents duplicates) |

5. Create or verify these **custom fields** on Invoice body:

| Field ID | Type | Purpose |
|---|---|---|
| custbody_core_received | Checkbox | Invoice-level core received flag |
| custbody_core_received_date | Date | When core was received |
| custbody_core_credit_memo | List/Record (Credit Memo) | Links auto-generated credit memo for traceability |

---

## Mobile App Features

### Outstanding Tab
- All outstanding cores from core bin customers
- Age badges: amber for 3-5 months, red ⚠ for 6+ months
- "Over 6 months" filter chip
- Quantity progress bar on multi-unit orders (e.g. 7 of 9 received)
- Tap any card → pre-filled receipt form
- + FAB button → blank receipt form for unexpected arrivals
- Customer filter: dropdown on desktop, scrollable chips on mobile

### Customer Banked Cores Tab
- Drill into any customer to see individual records with serial numbers
- "Use for SO →" button on each core for bank draw workflow

### CVIS Owned Inventory Tab
- Pulled from your CV_Core_Inventory.xlsx spreadsheet
- Velocity indicator showing 12-month sales volume
- Filter by: high velocity, pre-engage, inertia

---

## NetSuite Saved Search

A saved search called "Outstanding Cores Owed" was built directly in NetSuite with these criteria:
- Type = Sales Order
- Status = open statuses
- Formula {item} contains "CORE CHARGE"
- Core Rec'd? = false

---

## Quantity Tracking

When a customer orders multiple starters (e.g. 9 T100V), the core charge is a single line with qty 9. The system tracks this with:
- `custcol_core_qty_ordered` — total cores on the order
- `custcol_core_qty_received` — increments by 1 per receipt log
- Line stays open until qty_received = qty_ordered
- Serial numbers accumulate comma-separated on the line

---

## Key Contacts & Accounts
- NetSuite Account ID: 5471843
- AP/AR email: account@cardinalvalley.com

---

## Outstanding Items / Next Steps
1. NetSuite admin approval and Connected App creation
2. RESTlet deployment
3. Auto credit memo script deployment
4. Custom fields creation (verify all field IDs above)
5. Create custbody_core_credit_memo body field on Invoice
6. End-to-end test with one real core receipt
7. Confirm custom record type ID for Core Bank records (currently set to 'customrecord_starter_core' — verify with admin)
