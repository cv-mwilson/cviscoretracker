/**
 * CVIS Core Tracker — FastFields Webhook + NetSuite Bridge
 *
 * Workflows handled:
 *   bin_pickup — core arriving from customer's bin (triggers FastFields + email to AP/AR)
 *   bank_draw  — pulling a banked core for a new SO (no FastFields, no email)
 *
 * Environment variables:
 *   NS_ACCOUNT_ID       5471843
 *   NS_CLIENT_ID        from NetSuite Connected App
 *   NS_CLIENT_SECRET    from NetSuite Connected App
 *   NS_RESTLET_URL      RESTlet deploy URL from NetSuite
 *   FASTFIELDS_SECRET   webhook secret from FastFields (optional)
 *   PORT                auto-set by Railway/Render
 */

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const qs      = require('qs');
const app     = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── NetSuite OAuth token cache ────────────────────────────────────────────
let nsToken = null;
let nsTokenExpiry = 0;

async function getNSToken() {
  if (nsToken && Date.now() < nsTokenExpiry) return nsToken;
  const url  = `https://${process.env.NS_ACCOUNT_ID}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
  const resp = await axios.post(url,
    qs.stringify({ grant_type: 'client_credentials', client_id: process.env.NS_CLIENT_ID }),
    { auth: { username: process.env.NS_CLIENT_ID, password: process.env.NS_CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  nsToken = resp.data.access_token;
  nsTokenExpiry = Date.now() + (resp.data.expires_in - 60) * 1000;
  return nsToken;
}

async function callRESTlet(method, data) {
  const token = await getNSToken();
  const resp  = await axios({
    method,
    url    : process.env.NS_RESTLET_URL,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'GET' ? { params: data } : { data })
  });
  return resp.data;
}

// ─── FastFields field name mapping ─────────────────────────────────────────
// UPDATE THESE with your actual FastFields field IDs
// Find them: FastFields form builder → click each field → "Field Name"
const FF = {
  referenceNumber : 'reference_number',
  modelNumber     : 'model_number',
  serialNumber    : 'serial_number',
  customerName    : 'customer_name',
  destination     : 'destination',
  submittedBy     : 'submitted_by',
};

const DEST_MAP = {
  'MASCO Core' : 'MASCO',
  'CVIS Core'  : 'CVIS',
  'Hold Shelf' : 'Hold',
  'Warranty Bin': 'Warranty',
  'masco':'MASCO', 'cvis':'CVIS', 'hold':'Hold', 'warranty':'Warranty'
};

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'CVIS Core Tracker running', time: new Date() }));

// ─── GET: Fetch outstanding cores from NetSuite ────────────────────────────
app.get('/api/cores', async (req, res) => {
  try {
    res.json(await callRESTlet('GET', {}));
  } catch (e) {
    console.error('GET /api/cores:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── POST: Bin pickup — core arriving from customer's bin ──────────────────
// Called by the mobile app when logging a new physical receipt
app.post('/api/cores/bin-pickup', async (req, res) => {
  try {
    const payload = { ...req.body, workflow: 'bin_pickup' };
    const result  = await callRESTlet('POST', payload);
    res.json(result);
  } catch (e) {
    console.error('POST /api/cores/bin-pickup:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── POST: Bank draw — pulling banked core for a new sales order ───────────
// Called by the mobile app from the Banked Cores tab
app.post('/api/cores/bank-draw', async (req, res) => {
  try {
    const payload = { ...req.body, workflow: 'bank_draw' };
    const result  = await callRESTlet('POST', payload);
    res.json(result);
  } catch (e) {
    console.error('POST /api/cores/bank-draw:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── POST: FastFields webhook ──────────────────────────────────────────────
// Fired by FastFields when Core Receiving Log is submitted on the tablet
// This is a SECONDARY record — NetSuite is already updated by the mobile app.
// We log it and confirm receipt but do NOT re-trigger NetSuite updates.
app.post('/webhook/fastfields', async (req, res) => {
  try {
    // Verify webhook signature if secret is configured
    const secret = process.env.FASTFIELDS_SECRET;
    if (secret) {
      const sig      = req.headers['x-fastfields-signature'] || '';
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
      if (sig !== expected) {
        console.warn('FastFields signature mismatch');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const formData = req.body.data || req.body;
    const ref      = formData[FF.referenceNumber] || '';
    const model    = formData[FF.modelNumber]     || '';
    const serial   = formData[FF.serialNumber]    || '';
    const customer = formData[FF.customerName]    || '';
    const destRaw  = formData[FF.destination]     || '';
    const dest     = DEST_MAP[destRaw] || destRaw || 'MASCO';
    const by       = formData[FF.submittedBy]     || '';

    // Log the submission — NetSuite was already updated via the mobile app
    console.log(`FastFields submission received: ref=${ref}, model=${model}, dest=${dest}, customer=${customer}, by=${by}`);

    // If Hold or Warranty destination, log a note — these need manual follow-up
    if (dest === 'Hold' || dest === 'Warranty') {
      console.warn(`ACTION REQUIRED: Core to ${dest} — ref=${ref}, model=${model}. Manual follow-up needed.`);
    }

    res.json({
      success  : true,
      logged   : true,
      ref, model, serial, customer, dest,
      message  : `FastFields submission recorded. NetSuite was already updated via the Core Tracker app.`
    });

  } catch (e) {
    console.error('Webhook error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CVIS Core Tracker server running on port ${PORT}`));
