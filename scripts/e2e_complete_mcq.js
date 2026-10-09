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
      console.error('Usage: node e2e_complete_mcq.js <authToken> <diagToken>');
      process.exit(1);
    }

    let loop = 0;
    while (loop < 100) {
      loop += 1;
      console.log('\n--- Iteration', loop);
      const q = await request('/api/diagnostic/question', 'POST', { token: diagToken }, authToken);
      if (!q.body?.success) {
        console.error('Question failed', q.status, JSON.stringify(q.body));
        process.exit(1);
      }
      console.log('Question', q.body.data.questionNumber || 'N/A');

      const ans = await request('/api/diagnostic/answer', 'POST', { token: diagToken, selectedOption: 0, timeTaken: 1 }, authToken);
      console.log('Answer status', ans.status, JSON.stringify(ans.body?.data || ans.body));

      if (ans.body?.data?.isComplete) {
        console.log('MCQ phase complete');
        process.exit(0);
      }

      // small delay
      await new Promise((r) => setTimeout(r, 100));
    }

    console.error('Did not complete in 100 iterations');
    process.exit(1);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
