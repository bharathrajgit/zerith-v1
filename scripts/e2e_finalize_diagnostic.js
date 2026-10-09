const http = require('http');
function request(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0,
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}
(async () => {
  try {
    const authToken = process.argv[2];
    const diagToken = process.argv[3];
    const monitoringSessionId = process.argv[4];
    if (!authToken || !diagToken || !monitoringSessionId) {
      console.error('Usage: node e2e_finalize_diagnostic.js <authToken> <diagToken> <monitoringSessionId>');
      process.exit(1);
    }

    console.log('Finalizing coding phase...');
    const res = await request('/api/diagnostic/coding/complete', 'POST', { sessionToken: diagToken, sessionData: {}, monitoringSessionId }, authToken);
    console.log('Status', res.status, JSON.stringify(res.body, null, 2));
    process.exit(res.body?.success ? 0 : 1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
