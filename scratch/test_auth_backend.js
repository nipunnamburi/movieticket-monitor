import assert from 'assert';

const API_BASE = 'http://127.0.0.1:5055';

async function testAuthBackend() {
  console.log('🧪 Starting Auth & Password Policy Backend Verification...');

  const testEmail = `user_${Date.now()}@example.com`;

  // Test 1: Password < 8 chars rejected
  console.log('\n--- Test 1: Reject password with < 8 chars ---');
  const res1 = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'Pass1!' }),
  });
  const data1 = await res1.json();
  console.log('Status:', res1.status, 'Response:', data1);
  assert.strictEqual(res1.status, 400);
  assert(data1.message?.includes('at least 8 characters') || data1.error?.includes('at least 8 characters'));
  console.log('✅ Passed Test 1');

  // Test 2: Password missing number rejected
  console.log('\n--- Test 2: Reject password without number ---');
  const res2 = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'Password!@#' }),
  });
  const data2 = await res2.json();
  console.log('Status:', res2.status, 'Response:', data2);
  assert.strictEqual(res2.status, 400);
  assert(data2.message?.includes('at least 1 number') || data2.error?.includes('at least 1 number'));
  console.log('✅ Passed Test 2');

  // Test 3: Password missing special char rejected
  console.log('\n--- Test 3: Reject password without special character ---');
  const res3 = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'Password123' }),
  });
  const data3 = await res3.json();
  console.log('Status:', res3.status, 'Response:', data3);
  assert.strictEqual(res3.status, 400);
  assert(data3.message?.includes('special character') || data3.error?.includes('special character'));
  console.log('✅ Passed Test 3');

  // Test 4: Valid signup succeeds
  console.log('\n--- Test 4: Successful signup with compliant password ---');
  const validPassword = 'SecurePass@123';
  const res4 = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: validPassword, name: 'Test User' }),
  });
  const data4 = await res4.json();
  console.log('Status:', res4.status, 'Response:', { ...data4, token: data4.token ? `${data4.token.substring(0, 15)}...` : null });
  assert.strictEqual(res4.status, 200);
  assert(data4.token);
  assert.strictEqual(data4.user.email, testEmail);
  console.log('✅ Passed Test 4');

  const token = data4.token;

  // Test 5: Verify login with correct credentials
  console.log('\n--- Test 5: Successful login ---');
  const res5 = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: validPassword }),
  });
  const data5 = await res5.json();
  console.log('Status:', res5.status, 'User:', data5.user);
  assert.strictEqual(res5.status, 200);
  assert(data5.token);
  console.log('✅ Passed Test 5');

  // Test 6: Verify login rejection with wrong password
  console.log('\n--- Test 6: Reject login with wrong password ---');
  const res6 = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'WrongPassword!1' }),
  });
  console.log('Status:', res6.status);
  assert.strictEqual(res6.status, 401);
  console.log('✅ Passed Test 6');

  // Test 7: Create monitor as authenticated user -> check emailTo is automatically user's email!
  console.log('\n--- Test 7: Create monitor without manual email -> auto-routes to user email ---');
  const res7 = await fetch(`${API_BASE}/api/monitors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      name: 'Coolie IMAX Test',
      url: 'https://in.bookmyshow.com/hyderabad/movies/coolie/ET00395371',
      city: 'Hyderabad'
      // Note: emailTo is intentionally omitted!
    }),
  });
  const data7 = await res7.json();
  console.log('Created Monitor:', {
    id: data7.id,
    userId: data7.userId,
    emailTo: data7.emailTo,
    name: data7.name
  });
  assert.strictEqual(res7.status, 200);
  assert.strictEqual(data7.emailTo, testEmail, 'emailTo must automatically match authenticated user email');
  assert.strictEqual(data7.userId, data4.user.id, 'userId must match user id');
  console.log('✅ Passed Test 7: Email automatically assigned without manual input!');

  console.log('\n🎉 ALL BACKEND AUTH & PASSWORD POLICY TESTS PASSED SUCCESSFULLY!');
}

testAuthBackend().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
