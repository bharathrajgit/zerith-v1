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
    const token = process.argv[2] || process.env.E2E_TOKEN;
    if (!token) {
      console.error('Usage: node e2e_run_diagnostic.js <token>');
      process.exit(1);
    }

    console.log('Checking monitoring readiness...');
    const readiness = await request('/api/monitoring/readiness?sessionType=diagnostic', 'GET', null, token);
    console.log('Readiness:', readiness.status, JSON.stringify(readiness.body, null, 2));

    console.log('Starting monitoring session...');
    const start = await request('/api/monitoring/sessions/start', 'POST', { sessionType: 'diagnostic', previewEnabled: true }, token);
    console.log('Start session:', start.status, JSON.stringify(start.body, null, 2));

    const monitoringSessionId = start.body?.data?.monitoringSessionId;
    if (!monitoringSessionId) {
      console.error('Failed to create monitoring session');
      process.exit(1);
    }

    console.log('Starting diagnostic...');
    const diag = await request('/api/diagnostic/start', 'POST', { monitoringSessionId }, token);
    console.log('Diagnostic start:', diag.status, JSON.stringify(diag.body, null, 2));

    if (diag.body?.success && diag.body?.data?.token) {
      console.log('Diagnostic token:', diag.body.data.token);
      process.exit(0);
    }

    process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
