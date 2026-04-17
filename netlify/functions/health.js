const required = ['NS_ACCOUNT_ID', 'NS_CONSUMER_KEY', 'NS_CONSUMER_SECRET', 'NS_TOKEN_ID', 'NS_TOKEN_SECRET', 'NS_RESTLET_URL'];

exports.handler = async () => {
  const missing = required.filter(k => !process.env[k]);
  const connected = missing.length === 0;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connected, missing })
  };
};
