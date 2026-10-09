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
      console.error('Usage: node e2e_mcq_one_question.js <authToken> <diagToken>');
      process.exit(1);
    }

    console.log('Fetching question...');
    const q = await request('/api/diagnostic/question', 'POST', { token: diagToken }, authToken);
    console.log('Question response:', q.status, JSON.stringify(q.body, null, 2));

    const question = q.body?.data;
    if (!question) {
      console.error('No question returned');
      process.exit(1);
    }

    console.log('Submitting answer (option 0)...');
    const ans = await request('/api/diagnostic/answer', 'POST', { token: diagToken, selectedOption: 0, timeTaken: 1 }, authToken);
    console.log('Answer response:', ans.status, JSON.stringify(ans.body, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
