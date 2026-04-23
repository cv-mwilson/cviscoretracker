const { callRESTlet } = require('./netsuite');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (event.httpMethod === 'GET') {
    try {
      const data = await callRESTlet('GET', {});
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: e.message }) };
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const body   = JSON.parse(event.body || '{}');
      const result = await callRESTlet('POST', body);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: e.message }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
