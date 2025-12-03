import 'dotenv/config';
import axios from 'axios';
import ksuid from 'ksuid';

async function main() {
  const base = (process.env.PAYNETWORX_3DS_API_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('PAYNETWORX_3DS_API_URL not set');
  const user = process.env.PAYNETWORX_ACCESS_TOKEN_USER || process.env.PAYNETWORX_USERNAME;
  const pass = process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD || process.env.PAYNETWORX_PASSWORD;
  if (!user || !pass) throw new Error('PayNetWorx access token user/password not set');
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  console.log('Configuration:');
  console.log('  Base URL:', base);
  console.log('  Access Token User:', user ? `${user.substring(0, 4)}...` : 'NOT SET');
  console.log('  Access Token Password:', pass ? '***SET***' : 'NOT SET');
  console.log('  App URL:', appUrl);
  console.log('');

  const authHeader = `Basic ${btoa(`${user}:${pass}`)}`;
  const url = `${base}/transaction/auth`;
  console.log('Request URL:', url);

  // QA Test Cards:
  // Success: 2303779999000275
  // Failure: 2303779999000291
  // Challenge: 2303779999000408
  const testCard = process.argv[2] || '2303779999000275'; // Default to Success card
  
  const requestId = ksuid.randomSync().string;
  const browserInfoId = ksuid.randomSync().string;
  
  const payload = {
    Amount: { Total: '1.00', Fee: '0.00', Tax: '0.00', Currency: 'USD' },
    PaymentMethod: {
      Card: {
        CardPresent: false,
        CVC: { CVC: '123' },
        PAN: { PAN: testCard, ExpMonth: '12', ExpYear: '29' }
      },
      BillingAddress: { Name: 'Test User', Line1: 'N/A', City: 'N/A', State: 'NA', PostalCode: '00000', Country: 'US', Phone: '0000000000', Email: 'noreply@example.com' }
    },
    Attributes: { EntryMode: 'manual', ProcessingSpecifiers: { InitiatedByECommerce: true } },
    TransactionEntry: { Device: 'NA', DeviceVersion: 'NA', Application: 'GGVerse Smoke', ApplicationVersion: '1.0', Timestamp: new Date().toISOString() },
    Detail: {
      MerchantData: {}
    },
    ThreedsData: { deviceChannel: '02', threeDSRequestorURL: appUrl, browser_info_id: browserInfoId }
  };
  console.log('Request-ID (KSUID):', requestId);
  console.log('Browser Info ID (KSUID):', browserInfoId);
  console.log('');

  // Add request interceptor to log the full request
  axios.interceptors.request.use(request => {
    console.log('=== Outgoing Request ===');
    console.log('Method:', request.method?.toUpperCase());
    console.log('URL:', request.url);
    console.log('Headers:', JSON.stringify({
      'Authorization': request.headers['Authorization'] ? 'Basic ***' : undefined,
      'Content-Type': request.headers['Content-Type'],
      'Request-ID': request.headers['Request-ID']
    }, null, 2));
    console.log('Payload:', JSON.stringify(request.data, null, 2));
    console.log('========================');
    console.log('');
    return request;
  });

  const resp = await axios.post(url, payload, {
    headers: { Authorization: authHeader, 'Content-Type': 'application/json', 'Request-ID': requestId },
    validateStatus: () => true,
    timeout: 15000
  });

  console.log('=== Response ===');
  console.log('Status:', resp.status);
  console.log('Response Headers:', JSON.stringify(resp.headers, null, 2));
  console.log('Body:', JSON.stringify(resp.data, null, 2));
  console.log('================');
  console.log('');

  if (resp.status >= 400) {
    console.error('Error Response:', resp.data);
    throw new Error(`3DS auth request failed with status ${resp.status}`);
  }
  
  // Check for valid 3DS response structure
  if (!resp.data.threeDSServerTransID && !resp.data.PaymentResponse) {
    throw new Error('Unexpected 3DS response shape - missing threeDSServerTransID or PaymentResponse');
  }
  
  console.log('✓ 3DS Response received successfully');
  if (resp.data.threeDSMethodURL) {
    console.log('  → Method URL required (browser fingerprinting)');
  } else if (resp.data.challengeData) {
    console.log('  → Challenge flow required');
  } else if (resp.data.PaymentResponse) {
    console.log('  → Frictionless flow (no challenge)');
  }
}

main().then(() => {
  console.log('3DS smoke test completed.');
  process.exit(0);
}).catch(err => {
  console.error('3DS smoke test failed:', err.message);
  process.exit(1);
});


