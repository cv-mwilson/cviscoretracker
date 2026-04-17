/**
 * POST /api/bank-draw
 * Pulls a banked core for a new sales order — updates NetSuite SO
 */

const { callRESTlet } = require('./netsuite');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body    = JSON.parse(event.body || '{}');
    const payload = { ...body, workflow: 'bank_draw' };
    const result  = await callRESTlet('POST', payload);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result)
    };
  } catch (e) {
    console.error('bank-draw error:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: e.message })
    };
  }
};
