import 'dotenv/config';
import axios from 'axios';
import ksuid from 'ksuid';

async function testEndpoint(method, path, data = null) {
  const base = (process.env.PAYNETWORX_3DS_API_URL || '').replace(/\/$/, '');
  const user = process.env.PAYNETWORX_ACCESS_TOKEN_USER || process.env.PAYNETWORX_USERNAME;
  const pass = process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD || process.env.PAYNETWORX_PASSWORD;
  
  if (!base || !user || !pass) {
    throw new Error('PayNetWorx credentials not fully configured');
  }

  const authHeader = `Basic ${btoa(`${user}:${pass}`)}`;
  const url = `${base}${path}`;
  
  try {
    const config = {
      method,
      url,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'Request-ID': ksuid.randomSync().string
      },
      timeout: 10000,
      validateStatus: () => true
    };
    
    if (data) config.data = data;
    
    const resp = await axios(config);
    
    return {
      path,
      method,
      status: resp.status,
      success: resp.status >= 200 && resp.status < 300,
      hasData: !!resp.data,
      dataType: typeof resp.data,
      preview: typeof resp.data === 'string' 
        ? resp.data.substring(0, 200) 
        : JSON.stringify(resp.data).substring(0, 200)
    };
  } catch (error) {
    return {
      path,
      method,
      status: error.response?.status || 'ERROR',
      success: false,
      error: error.message
    };
  }
}

async function main() {
  console.log('PayNetWorx Key Validation Test\n');
  console.log('Configuration:');
  console.log('  Base URL:', process.env.PAYNETWORX_3DS_API_URL);
  console.log('  User:', process.env.PAYNETWORX_ACCESS_TOKEN_USER?.substring(0, 4) + '...');
  console.log('  Password:', process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD ? '***SET***' : 'NOT SET');
  console.log('\n' + '='.repeat(60) + '\n');

  // Test various endpoints to see what works
  const tests = [
    // Health/Status endpoints (if available)
    { method: 'GET', path: '/' },
    { method: 'GET', path: '/health' },
    { method: 'GET', path: '/status' },
    { method: 'GET', path: '/ping' },
    
    // API info endpoints
    { method: 'GET', path: '/v0' },
    { method: 'GET', path: '/v0/' },
    
    // Transaction endpoints (read-only first)
    { method: 'GET', path: '/transaction' },
    { method: 'GET', path: '/transaction/auth' },
    
    // Minimal auth test (if endpoint exists)
    { method: 'POST', path: '/transaction/auth', data: {} },
    
    // Test with minimal valid payload
    { 
      method: 'POST', 
      path: '/transaction/auth', 
      data: {
        Amount: { Total: '0.01', Fee: '0.00', Tax: '0.00', Currency: 'USD' },
        PaymentMethod: {
          Card: {
            CardPresent: false,
            CVC: { CVC: '123' },
            PAN: { PAN: '2303779999000275', ExpMonth: '12', ExpYear: '29' }
          },
          BillingAddress: {
            Name: 'Test', Line1: 'N/A', City: 'N/A', State: 'NA', 
            PostalCode: '00000', Country: 'US', Phone: '0000000000', Email: 'test@example.com'
          }
        },
        Attributes: { EntryMode: 'manual', ProcessingSpecifiers: { InitiatedByECommerce: true } },
        TransactionEntry: {
          Device: 'NA', DeviceVersion: 'NA', Application: 'Test', ApplicationVersion: '1.0',
          Timestamp: new Date().toISOString()
        },
        Detail: { MerchantData: {} },
        ThreedsData: { deviceChannel: '02', threeDSRequestorURL: 'http://localhost:3000' }
      }
    }
  ];

  const results = [];
  for (const test of tests) {
    console.log(`Testing ${test.method} ${test.path}...`);
    const result = await testEndpoint(test.method, test.path, test.data);
    results.push(result);
    
    if (result.success) {
      console.log(`  ✓ SUCCESS (${result.status})`);
      if (result.preview) console.log(`  Preview: ${result.preview}`);
    } else {
      console.log(`  ✗ FAILED (${result.status})`);
      if (result.error) console.log(`  Error: ${result.error}`);
    }
    console.log('');
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n' + '='.repeat(60));
  console.log('\nSummary:');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`  Successful: ${successful.length}/${results.length}`);
  console.log(`  Failed: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log('\n✓ Your keys ARE active and can access:');
    successful.forEach(r => console.log(`  - ${r.method} ${r.path} (${r.status})`));
  }
  
  if (failed.length > 0 && failed.every(f => f.status === 403)) {
    console.log('\n⚠ All requests returned 403 Forbidden.');
    console.log('  This suggests:');
    console.log('    - Keys may be invalid or expired');
    console.log('    - Keys may not have permission for these endpoints');
    console.log('    - IP restrictions may be in place');
    console.log('    - Wrong API environment (QA vs Production)');
  } else if (failed.length > 0) {
    console.log('\n✗ Failed endpoints:');
    failed.forEach(r => console.log(`  - ${r.method} ${r.path} (${r.status})`));
  }
}

main().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});

