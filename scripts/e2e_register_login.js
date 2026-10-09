const http = require('http');

function request(path, method, data) {
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
    const user = {
      username: 'e2e_test_student',
      email: 'e2e-test-student@example.com',
      password: 'TestPass123!',
      name: 'E2E Test'
    };

    console.log('Registering user...');
    const reg = await request('/api/auth/register', 'POST', user);
    console.log('Register status', reg.status);
    console.log(JSON.stringify(reg.body, null, 2));

    console.log('Logging in...');
    const login = await request('/api/auth/login', 'POST', { email: user.email, password: user.password });
    console.log('Login status', login.status);
    console.log(JSON.stringify(login.body, null, 2));

    if (login.body && login.body.token) {
      console.log('\nTOKEN=' + login.body.token);
    } else if (login.body && login.body.data && login.body.token) {
      console.log('\nTOKEN=' + login.body.token);
    } else {
      console.error('No token returned');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
