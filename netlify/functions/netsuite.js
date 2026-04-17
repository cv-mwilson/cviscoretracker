/**
 * CVIS Core Tracker — NetSuite TBA Auth Helper
 * Shared by all Netlify Functions
 */

const crypto = require('crypto');
const https  = require('https');

function buildTBAHeader(method, url) {
  const accountId      = process.env.NS_ACCOUNT_ID;
  const consumerKey    = process.env.NS_CONSUMER_KEY;
  const consumerSecret = process.env.NS_CONSUMER_SECRET;
  const tokenId        = process.env.NS_TOKEN_ID;
  const tokenSecret    = process.env.NS_TOKEN_SECRET;

  const nonce     = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const baseParams = [
    ['oauth_consumer_key',     consumerKey],
    ['oauth_nonce',            nonce],
    ['oauth_signature_method', 'HMAC-SHA256'],
    ['oauth_timestamp',        timestamp],
    ['oauth_token',            tokenId],
    ['oauth_version',          '1.0'],
  ];

  const paramStr = baseParams
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramStr)
  ].join('&');

  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  const signature  = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');

  const headerParams = [...baseParams, ['oauth_signature', signature]];
  const headerStr = headerParams
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(', ');

  return `OAuth realm="${accountId}", ${headerStr}`;
}

async function callRESTlet(method, data) {
  const url        = process.env.NS_RESTLET_URL;
  const authHeader = buildTBAHeader(method, url);

  // Use built-in https — no axios needed (Netlify Functions are lightweight)
  return new Promise((resolve, reject) => {
    const body    = method === 'GET' ? null : JSON.stringify(data);
    const reqUrl  = method === 'GET'
      ? url + '&' + Object.entries(data).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : url;

    const parsed  = new URL(reqUrl);
    const options = {
      hostname: parsed.hostname,
      path    : parsed.pathname + parsed.search,
      method  : method,
      headers : {
        Authorization  : authHeader,
        'Content-Type' : 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ raw }); }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = { callRESTlet };
