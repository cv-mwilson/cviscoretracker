# CVIS Core Tracker — Deployment Guide

## Files in this package

| File | Purpose |
|------|---------|
| cvis_core_restlet.js | Upload to NetSuite SuiteScripts folder |
| auto_core_credit.js | Upload to NetSuite SuiteScripts folder — UserEventScript on Invoice |

## Step 1 — Deploy RESTlet to NetSuite (Admin does this)

1. Go to Documents → Files → SuiteScripts
2. Upload cvis_core_restlet.js
3. Go to Setup → Script → Scripts → New Script
4. Select the uploaded file — NetSuite detects it as RESTlet type
5. Set Script ID: customscript_cvis_core_tracker
6. Save, then click Deploy
7. Set Status: Released, Audience: All Roles
8. Copy the External URL shown — this is your NS_RESTLET_URL

## Step 2 — Deploy Auto Credit Memo Script (Admin does this)

1. Go to Documents → Files → SuiteScripts
2. Upload auto_core_credit.js
3. Go to Setup → Script → Scripts → New Script
4. Select the uploaded file — NetSuite detects it as UserEventScript type
5. Set Script ID: customscript_auto_core_credit
6. Save, then click Deploy
7. Set Record Type: Invoice, Event: After Submit, Status: Released

## Step 3 — Create Connected App (Admin does this)

1. Setup → Integration → Manage Integrations → New
2. Name: CVIS Core Tracker
3. Enable: REST Web Services + SuiteScript
4. Auth: Token-Based Authentication
5. Save — COPY the Consumer Key and Consumer Secret immediately
6. Generate Token ID and Token Secret under the user's Access Tokens

## Custom fields needed in NetSuite (Admin creates these)

These fields need to exist on the Sales Order line item:
- custcol_core_received (Checkbox)
- custcol_core_received_date (Date)
- custcol_core_destination (List: MASCO, CVIS, Hold, Warranty)
- custcol_starter_model (Free-form text)
- custcol_serial_number (Free-form text)
- custcol_core_qty_ordered (Integer)
- custcol_core_qty_received (Integer)

These fields need to exist on the Invoice body:
- custbody_core_received (Checkbox)
- custbody_core_received_date (Date)
- custbody_core_credit_memo (List/Record — Credit Memo, for traceability)

These fields need to exist on the Invoice line item:
- custcol235 (Checkbox — trigger for auto credit memo creation)
- custcol236 (Checkbox — marks line as already processed, prevents duplicates)

If these already exist under different IDs, update the scripts accordingly.
