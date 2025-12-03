import 'dotenv/config';
import axios from 'axios';
import ksuid from 'ksuid';

async function testTokenizationSession() {
  const base = process.env.PAYNETWORX_HOSTED_PAYMENTS_API_URL;
  if (!base) throw new Error('PAYNETWORX_HOSTED_PAYMENTS_API_URL not set');
  
  const hostedPaymentsKey = process.env.PAYNETWORX_HOSTED_PAYMENTS_API_KEY;
  const merchantId = process.env.PAYNETWORX_MERCHANT_ID;
  
  if (!hostedPaymentsKey) {
    throw new Error('PAYNETWORX_HOSTED_PAYMENTS_API_KEY not set');
  }

  if (!merchantId) {
    throw new Error('PAYNETWORX_MERCHANT_ID not set');
  }

  console.log('Testing Tokenization Session Creation\n');
  console.log('Configuration:');
  console.log('  Base URL:', base);
  console.log('  Endpoint: /v1/payments/sessions/create');
  console.log('  API Key:', hostedPaymentsKey ? hostedPaymentsKey : 'NOT SET');
  console.log('  Merchant ID:', merchantId);
  console.log('');

  // Use literal auth header provided by PayNetWorx
  const authHeader = 'pnx-bZMmOZkAWM89z7F80o2TDFnRsqrSUN:3xmnicbB6rFcHoRIY4jDt9Ic5ZYH9m';
  const requestId = ksuid.randomSync().string;

  // According to PayNetWorx docs: https://www.card-docs.paynetworx.com/hosted_payments/overview/examples.html
  // The payload should have payment_session_use nested inside a payment_session object
  const payload = {
    payment_session: {
      payment_session_use: 'TOKENIZE'
    }
  };

  console.log('Request Payload:', JSON.stringify(payload, null, 2));
  console.log('');

  const url = `${base}/v1/payments/sessions/create`;
  console.log('Request URL:', url);
  console.log('');

  try {
    const headers = {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      'Request-ID': requestId
    };
    
    if (merchantId) {
      headers['X-Merchant-Id'] = merchantId;
    }
    
    const resp = await axios.post(url, payload, {
      headers,
      validateStatus: () => true,
      timeout: 15000
    });

    console.log('=== Response ===');
    console.log('Status:', resp.status);
    console.log('Body:', JSON.stringify(resp.data, null, 2));
    console.log('================');
    console.log('');

    if (resp.status >= 200 && resp.status < 300) {
      console.log('✓ SUCCESS! Tokenization session created');
      return resp.data;
    } else if (resp.status === 401) {
      console.log('✗ 401 Unauthorized - Authentication failed');
      console.log('  This indicates the API key format or authentication method may be incorrect');
    } else if (resp.status === 403) {
      console.log('✗ 403 Forbidden - Access denied');
    } else {
      console.log(`✗ Error: ${resp.status}`);
    }
  } catch (error) {
    console.error('✗ Request failed:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await testTokenizationSession();
    console.log('\nTest completed.');
    process.exit(0);
  } catch (error) {
    console.error('\nTest failed:', error.message);
    process.exit(1);
  }
}

main();
