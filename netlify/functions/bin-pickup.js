/**
 * POST /api/bin-pickup
 * Logs a core arriving from a customer's bin — updates NetSuite SO/Invoice/Quote
 */

const { callRESTlet } = require('./netsuite');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body    = JSON.parse(event.body || '{}');
    const payload = { ...body, workflow: 'bin_pickup' };
    const result  = await callRESTlet('POST', payload);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result)
    };
  } catch (e) {
    console.error('bin-pickup error:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
