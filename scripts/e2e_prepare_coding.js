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
    if (!authToken || !diagToken) {
      console.error('Usage: node e2e_prepare_coding.js <authToken> <diagToken>');
      process.exit(1);
    }

    console.log('Preparing coding phase...');
    const res = await request('/api/diagnostic/complete', 'POST', { token: diagToken }, authToken);
    console.log('Status', res.status, JSON.stringify(res.body, null, 2));
    process.exit(res.body?.success ? 0 : 1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
