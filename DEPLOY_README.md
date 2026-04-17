# CVIS Core Tracker — Deployment Guide

## Files in this package

| File | Purpose |
|------|---------|
| cvis_core_restlet.js | Upload to NetSuite SuiteScripts folder |
| webhook_server.js | Deploy to Railway or Render |
| package.json | Node.js dependencies |
| .env.example | Environment variables template |

## Step 1 — Deploy RESTlet to NetSuite (Admin does this)

1. Go to Documents → Files → SuiteScripts
2. Upload cvis_core_restlet.js
3. Go to Setup → Script → Scripts → New Script
4. Select the uploaded file — NetSuite detects it as RESTlet type
5. Set Script ID: customscript_cvis_core_tracker
6. Save, then click Deploy
7. Set Status: Released, Audience: All Roles
8. Copy the External URL shown — this is your NS_RESTLET_URL

## Step 2 — Create Connected App (Admin does this)

1. Setup → Integration → Manage Integrations → New
2. Name: CVIS Core Tracker
3. Enable: REST Web Services + SuiteScript
4. Auth: Client Credentials (Machine to Machine)
5. Save — COPY the Client ID and Client Secret immediately

## Step 3 — Deploy webhook server to Railway (5 minutes, free)

1. Go to railway.app → sign up free with GitHub
2. New Project → Deploy from GitHub repo (or drag this folder)
3. Add environment variables (Variables tab):
   - NS_ACCOUNT_ID = 5471843
   - NS_CLIENT_ID = (from Step 2)
   - NS_CLIENT_SECRET = (from Step 2)
   - NS_RESTLET_URL = (from Step 1)
4. Railway gives you a URL like: https://cvis-core-tracker.up.railway.app
5. Your webhook URL is: https://cvis-core-tracker.up.railway.app/webhook/fastfields

## Step 4 — Configure FastFields webhook

1. Log into FastFields web app
2. Open Core Receiving Log form → Form Settings → Webhooks
3. Add Webhook URL: (your Railway URL from Step 3)/webhook/fastfields
4. Trigger: On Submit
5. Save

## Step 5 — Update field names in webhook_server.js

Find FF_FIELDS near the top of webhook_server.js.
Replace the field name values with your actual FastFields field IDs.
You find these in FastFields form builder → click each field → "Field Name" property.

## Custom fields needed in NetSuite (Admin creates these)

These fields need to exist on the Sales Order line item:
- custcol_core_received (Checkbox)
- custcol_core_received_date (Date)
- custcol_core_destination (List: MASCO, CVIS, Hold, Warranty)
- custcol_starter_model (Free-form text)
- custcol_serial_number (Free-form text)

If these already exist under different IDs, update the RESTlet accordingly.
