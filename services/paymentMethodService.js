import axios from 'axios';
import ksuid from 'ksuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// For tokenization, we need Hosted Payments API URL, not 3DS API URL
const PAYMENT_API_URL = process.env.PAYNETWORX_HOSTED_PAYMENTS_API_URL?.replace(/\/$/, '') || process.env.PAYNETWORX_PAYMENT_API_URL?.replace(/\/$/, '') || process.env.PAYNETWORX_3DS_API_URL?.replace(/\/$/, '') || '';
const HOSTED_PAYMENTS_API_KEY = process.env.PAYNETWORX_HOSTED_PAYMENTS_API_KEY;
const ACCESS_TOKEN_USER = process.env.PAYNETWORX_ACCESS_TOKEN_USER || process.env.PAYNETWORX_USERNAME;
const ACCESS_TOKEN_PASSWORD = process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD || process.env.PAYNETWORX_PASSWORD;
const MERCHANT_ID = process.env.PAYNETWORX_MERCHANT_ID;
const REQUEST_TIMEOUT_MS = Number(process.env.PAYNETWORX_REQUEST_TIMEOUT_MS || 15000);
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function getAuthHeader() {
  // For Hosted Payments API, use the API key directly as provided by PayNetWorx
  // The key format is: "pnx-xxxxx:yyyyy" and should be used as-is in Authorization header
  if (HOSTED_PAYMENTS_API_KEY) {
    return HOSTED_PAYMENTS_API_KEY;
  }
  // Fallback to Basic Auth with username/password for other PayNetWorx APIs
  return `Basic ${btoa(`${ACCESS_TOKEN_USER}:${ACCESS_TOKEN_PASSWORD}`)}`;
}

async function pnxRequest(method, path, data) {
  // Check if we have the required configuration
  if (!PAYMENT_API_URL) {
    throw new Error('PayNetWorx API URL not configured. Set PAYNETWORX_HOSTED_PAYMENTS_API_URL or PAYNETWORX_PAYMENT_API_URL');
  }
  
  const url = `${PAYMENT_API_URL}${path}`;
  const headers = {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
    'Request-ID': ksuid.randomSync().string
  };
  
  // Add merchant ID header if available
  if (MERCHANT_ID) {
    headers['X-Merchant-Id'] = MERCHANT_ID;
  }
  
  const resp = await axios({ method, url, data, headers, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
  if (resp.status >= 200 && resp.status < 300) return resp.data;
  const err = new Error(`PayNetWorx error ${resp.status}`);
  err.response = resp;
  throw err;
}

export const initializeTokenizationSession = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    // According to PayNetWorx docs: https://www.card-docs.paynetworx.com/hosted_payments/overview/examples.html
    // The payload should have payment_session_use nested inside a payment_session object
    const sessionData = {
      payment_session: {
        payment_session_use: 'TOKENIZE'
      }
    };

    const response = await pnxRequest('post', '/v1/payments/sessions/create', sessionData);
    
    // Response structure: { payment_session: { payment_session_id, payment_session_url, payment_session_request_id, ... } }
    const paymentSession = response.payment_session || response;
    
    // Log full response for debugging
    console.log('PayNetWorx session creation response:', JSON.stringify(response, null, 2));
    
    // Extract all relevant session identifiers
    const sessionId = paymentSession.payment_session_id || paymentSession.session_id || paymentSession.id;
    const paymentSessionRequestId = paymentSession.payment_session_request_id;
    const iframeUrl = paymentSession.payment_session_url || paymentSession.iframe_url || paymentSession.url;
    
    return res.json({
      sessionId: sessionId,
      paymentSessionRequestId: paymentSessionRequestId, // Include this for tokenization request
      iframeUrl: iframeUrl,
      success: true
    });
  } catch (e) {
    if (e.response) return res.status(e.response.status || 500).send(e.response.data || { error: 'Tokenization session creation failed' });
    return res.status(500).send({ error: e.message });
  }
};

export const saveTokenizedPaymentMethod = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { token, cardLast4, cardBrand, cardExpMonth, cardExpYear } = req.body;
    if (!token || !cardLast4) return res.status(400).send({ error: 'Token and cardLast4 are required' });

    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        UserId: parseInt(userId),
        Provider: 'paynetworx',
        ProviderPaymentMethodId: token,
        CardLast4: String(cardLast4).slice(-4),
        CardBrand: cardBrand || null,
        CardExpMonth: cardExpMonth || null,
        CardExpYear: cardExpYear || null,
        Active: true,
        Verified: false
      }
    });

    return res.json({
      success: true,
      paymentMethod: {
        id: paymentMethod.id,
        cardLast4: paymentMethod.CardLast4,
        cardBrand: paymentMethod.CardBrand,
        cardExpMonth: paymentMethod.CardExpMonth,
        cardExpYear: paymentMethod.CardExpYear
      }
    });
  } catch (e) {
    return res.status(500).send({ error: e.message });
  }
};

// Step 1: Payment Method Management - Get all payment methods for authenticated user
export const getUserPaymentMethods = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    // Fetch all active payment methods for user (exclude tokens, return metadata only)
    const paymentMethods = await prisma.paymentMethod.findMany({
      where: {
        UserId: parseInt(userId),
        Active: true
      },
      select: {
        id: true,
        CardLast4: true,
        CardBrand: true,
        CardExpMonth: true,
        CardExpYear: true,
        Verified: true,
        IsDefault: true,
        created_at: true
      },
      orderBy: { created_at: 'desc' }
    });

    return res.json({
      success: true,
      paymentMethods: paymentMethods.map(pm => ({
        id: pm.id,
        cardLast4: pm.CardLast4,
        cardBrand: pm.CardBrand,
        cardExpMonth: pm.CardExpMonth,
        cardExpYear: pm.CardExpYear,
        verified: pm.Verified,
        isDefault: pm.IsDefault || false,
        createdAt: pm.created_at
      }))
    });
  } catch (e) {
    return res.status(500).send({ error: e.message });
  }
};

// Step 1: Payment Method Management - Set default payment method (soft delete others' default status)
export const setDefaultPaymentMethod = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { paymentMethodId } = req.params;
    if (!paymentMethodId) return res.status(400).send({ error: 'paymentMethodId is required' });

    // Verify payment method belongs to user
    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: {
        id: parseInt(paymentMethodId),
        UserId: parseInt(userId),
        Active: true
      }
    });

    if (!paymentMethod) {
      return res.status(404).send({ error: 'Payment method not found or inactive' });
    }

    // Set selected payment method as default
    await prisma.paymentMethod.update({
      where: { id: parseInt(paymentMethodId) },
      data: { IsDefault: true }
    });

    // Unset all other user payment methods' default status
    await prisma.paymentMethod.updateMany({
      where: {
        UserId: parseInt(userId),
        id: { not: parseInt(paymentMethodId) }
      },
      data: { IsDefault: false }
    });

    // Return updated payment method
    const updatedPaymentMethod = await prisma.paymentMethod.findUnique({
      where: { id: parseInt(paymentMethodId) },
      select: {
        id: true,
        CardLast4: true,
        CardBrand: true,
        CardExpMonth: true,
        CardExpYear: true,
        Verified: true,
        IsDefault: true
      }
    });
    
    return res.json({
      success: true,
      message: 'Default payment method set',
      paymentMethod: {
        id: updatedPaymentMethod.id,
        cardLast4: updatedPaymentMethod.CardLast4,
        cardBrand: updatedPaymentMethod.CardBrand,
        cardExpMonth: updatedPaymentMethod.CardExpMonth,
        cardExpYear: updatedPaymentMethod.CardExpYear,
        verified: updatedPaymentMethod.Verified,
        isDefault: updatedPaymentMethod.IsDefault
      }
    });
  } catch (e) {
    return res.status(500).send({ error: e.message });
  }
};

// Step 1: Payment Method Management - Soft delete payment method
export const deletePaymentMethod = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { paymentMethodId } = req.params;
    if (!paymentMethodId) return res.status(400).send({ error: 'paymentMethodId is required' });

    // Verify payment method belongs to user
    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: {
        id: parseInt(paymentMethodId),
        UserId: parseInt(userId)
      }
    });

    if (!paymentMethod) {
      return res.status(404).send({ error: 'Payment method not found' });
    }

    // Soft delete: set Active = false
    await prisma.paymentMethod.update({
      where: { id: parseInt(paymentMethodId) },
      data: { Active: false }
    });

    return res.json({
      success: true,
      message: 'Payment method deleted'
    });
  } catch (e) {
    return res.status(500).send({ error: e.message });
  }
};

// Step 3: Combined Flow - Verify card via 3DS then tokenize and save
export const verifyAndTokenizeCard = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { cardNumber, cardHolder, expiryDate, cvv, amount, currency = 'USD', browser_info } = req.body;
    if (!cardNumber || !expiryDate || !cvv || !amount) {
      return res.status(400).send({ error: 'Missing required fields: cardNumber, expiryDate, cvv, amount' });
    }

    // Step 1: Initiate 3DS authentication
    const THREE_DS_BASE_URL = process.env.PAYNETWORX_3DS_API_URL?.replace(/\/$/, '') || '';
    const ACCESS_TOKEN_USER = process.env.PAYNETWORX_ACCESS_TOKEN_USER || process.env.PAYNETWORX_USERNAME;
    const ACCESS_TOKEN_PASSWORD = process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD || process.env.PAYNETWORX_PASSWORD;
    
    function get3DSAuthHeader() {
      return `Basic ${btoa(`${ACCESS_TOKEN_USER}:${ACCESS_TOKEN_PASSWORD}`)}`;
    }

    const user = await prisma.users.findUnique({ where: { id: parseInt(userId) } });
    if (!user) return res.status(404).send({ error: 'User not found' });

    const authRequest = {
      Amount: {
        Total: String(amount),
        Fee: '0.00',
        Tax: '0.00',
        Currency: currency.toUpperCase()
      },
      PaymentMethod: {
        Card: {
          CardPresent: false,
          CVC: { CVC: String(cvv) },
          PAN: {
            PAN: String(cardNumber).replace(/\s/g, ''),
            ExpMonth: String(expiryDate).slice(0, 2),
            ExpYear: String(expiryDate).slice(2, 4)
          }
        },
        BillingAddress: {
          Name: cardHolder || user.Username || user.Email || 'Cardholder',
          Line1: 'N/A', City: 'N/A', State: 'NA', PostalCode: '00000', Country: 'US', Phone: '0000000000', Email: user.Email || 'noreply@example.com'
        }
      },
      Attributes: { EntryMode: 'manual', ProcessingSpecifiers: { InitiatedByECommerce: true } },
      TransactionEntry: {
        Device: 'NA', DeviceVersion: 'NA', Application: 'GGVerse API', ApplicationVersion: '1.0', Timestamp: new Date().toISOString()
      },
      Detail: { MerchantData: {} },
      ThreedsData: Object.assign({ deviceChannel: '02', threeDSRequestorURL: APP_URL }, browser_info || {})
    };

    // Call 3DS initiate
    const headers = {
      Authorization: get3DSAuthHeader(),
      'Content-Type': 'application/json',
      'Request-ID': ksuid.randomSync().string
    };
    const pnx3DS = await axios.post(`${THREE_DS_BASE_URL}/transaction/auth`, authRequest, { 
      headers, 
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true 
    });
    
    // Check for error status
    if (pnx3DS.status < 200 || pnx3DS.status >= 300) {
      return res.status(pnx3DS.status).send(pnx3DS.data || { error: '3DS initiation failed' });
    }

    // If 3DS requires challenge or method, return early (frontend must complete 3DS first)
    if (pnx3DS.data.threeDSMethodURL || pnx3DS.data.challengeData) {
      return res.json({
        success: false,
        requires3DS: true,
        threeDSServerTransID: pnx3DS.data.threeDSServerTransID,
        threeDSMethodURL: pnx3DS.data.threeDSMethodURL,
        challengeData: pnx3DS.data.challengeData,
        message: '3DS authentication required. Complete 3DS flow first, then retry tokenization.'
      });
    }

    // Step 2: If frictionless (approved), proceed to tokenization
    const approved = Boolean(pnx3DS.data.PaymentResponse?.Response?.Approved) || Boolean(pnx3DS.data.Approved);
    if (!approved) {
      return res.status(400).send({ error: '3DS authentication failed' });
    }

    // Step 3: Create tokenization session
    const sessionData = {
      payment_session: {
        payment_session_use: 'TOKENIZE'
      }
    };
    const tokenizationResponse = await pnxRequest('post', '/v1/payments/sessions/create', sessionData);
    const paymentSession = tokenizationResponse.payment_session || tokenizationResponse;

    return res.json({
      success: true,
      message: '3DS verified. Tokenization session created.',
      sessionId: paymentSession.payment_session_id,
      iframeUrl: paymentSession.payment_session_url,
      threeDSServerTransID: pnx3DS.data.threeDSServerTransID
    });
  } catch (e) {
    if (e.response) return res.status(e.response.status || 500).send(e.response.data || { error: 'Verify and tokenize failed' });
    return res.status(500).send({ error: e.message });
  }
};

// ============================================================================
// Bank Account Management
// ============================================================================

// Helper to get tomorrow's date in YYYY-MM-DD format (required for ACH)
function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// Request helper for Payment API endpoints (ACH, etc.)
// Uses same configuration as paynetworxService.js for consistency
async function pnxPaymentRequest(method, path, data) {
  // Use same PAYMENT_API_URL configuration as paynetworxService.js
  const PAYMENT_API_URL = process.env.PAYNETWORX_PAYMENT_API_URL?.replace(/\/$/, '') || 
                          process.env.PAYNETWORX_HOSTED_PAYMENTS_API_URL?.replace(/\/$/, '') || 
                          process.env.PAYNETWORX_3DS_API_URL?.replace(/\/$/, '') || '';
  const HOSTED_PAYMENTS_API_KEY = process.env.PAYNETWORX_HOSTED_PAYMENTS_API_KEY;
  const ACCESS_TOKEN_USER = process.env.PAYNETWORX_ACCESS_TOKEN_USER || process.env.PAYNETWORX_USERNAME;
  const ACCESS_TOKEN_PASSWORD = process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD || process.env.PAYNETWORX_PASSWORD;
  const REQUEST_TIMEOUT_MS = Number(process.env.PAYNETWORX_REQUEST_TIMEOUT_MS || 15000);

  if (!PAYMENT_API_URL) {
    throw new Error('PayNetWorx Payment API URL not configured. Set PAYNETWORX_PAYMENT_API_URL or PAYNETWORX_HOSTED_PAYMENTS_API_URL');
  }

  function getAuthHeader() {
    // Use same logic as top-level getAuthHeader - check for API key first
    // For Hosted Payments API, use the API key directly as provided by PayNetWorx
    // The key format is: "pnx-xxxxx:yyyyy" and should be used as-is in Authorization header
    if (HOSTED_PAYMENTS_API_KEY) {
      return HOSTED_PAYMENTS_API_KEY;
    }
    // Fallback to Basic Auth with username/password for other PayNetWorx APIs
    return `Basic ${btoa(`${ACCESS_TOKEN_USER}:${ACCESS_TOKEN_PASSWORD}`)}`;
  }

  const url = `${PAYMENT_API_URL}${path}`;
  const headers = {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
    'Request-ID': ksuid.randomSync().string
  };
  const resp = await axios({ method, url, data, headers, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
  if (resp.status >= 200 && resp.status < 300) return resp.data;
  const err = new Error(`PayNetWorx Payment API error ${resp.status}`);
  err.response = resp;
  throw err;
}

// Get all bank accounts for the authenticated user
export const getUserBankAccounts = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    // Fetch all active bank accounts for user (exclude tokens, return metadata only)
    const bankAccounts = await prisma.bankAccount.findMany({
      where: {
        UserId: parseInt(userId),
        Active: true
      },
      select: {
        id: true,
        AccountLast4: true,
        AccountType: true,
        AccountName: true,
        RoutingLast4: true,
        IsDefault: true,
        Provider: true,
        ProviderBankId: true, // Include to check if tokenized
        created_at: true
      },
      orderBy: [
        { IsDefault: 'desc' },
        { created_at: 'desc' }
      ]
    });

    return res.json({
      success: true,
      bankAccounts: bankAccounts.map(ba => ({
        id: ba.id,
        accountLast4: ba.AccountLast4,
        accountType: ba.AccountType,
        accountName: ba.AccountName,
        routingLast4: ba.RoutingLast4,
        isDefault: ba.IsDefault || false,
        isTokenized: !!ba.ProviderBankId, // Indicate if bank account has been tokenized
        providerBankId: ba.ProviderBankId,
        provider: ba.Provider,
        createdAt: ba.created_at
      }))
    });
  } catch (e) {
    return res.status(500).send({ error: e.message });
  }
};

// Save a bank account (save minimal info only, tokenize on first withdrawal)
// This approach avoids storing full account numbers and only tokenizes during actual transactions
export const saveBankAccount = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const {
      routingNumber,
      accountNumber, // Last 4 digits only when adding
      accountType,
      accountHolderName
    } = req.body;

    // Validate required fields
    if (!routingNumber || !accountNumber || !accountType || !accountHolderName) {
      return res.status(400).send({
        error: 'Missing required fields',
        requiredFields: ['routingNumber', 'accountNumber', 'accountType', 'accountHolderName']
      });
    }

    // Validate routing number (must be 9 digits)
    if (!/^\d{9}$/.test(routingNumber)) {
      return res.status(400).send({ error: 'Invalid routing number. Must be 9 digits.' });
    }

    // Validate account number (should be last 4 digits when adding)
    if (!/^\d{4}$/.test(accountNumber)) {
      return res.status(400).send({ error: 'Invalid account number. Please provide the last 4 digits only.' });
    }

    // Validate account type
    const validAccountTypes = ['PersonalChecking', 'PersonalSavings', 'BusinessChecking', 'BusinessSavings'];
    if (!validAccountTypes.includes(accountType)) {
      return res.status(400).send({
        error: 'Invalid account type',
        validTypes: validAccountTypes
      });
    }

    // Save bank account with minimal info:
    // - Full routing number stored in RoutingLast4 (despite the name, we store full routing number here)
    // - Last 4 digits of account number stored in AccountLast4
    // Tokenization will happen automatically on first withdrawal when full account number is provided
    const bankAccount = await prisma.bankAccount.create({
      data: {
        UserId: parseInt(userId),
        Provider: 'paynetworx',
        ProviderBankId: null, // Will be set when tokenized during first withdrawal
        AccountType: accountType,
        AccountName: accountHolderName,
        AccountLast4: accountNumber, // Last 4 digits only
        RoutingLast4: routingNumber, // Full routing number stored here
        Active: true,
        IsDefault: false
      }
    });

    return res.json({
      success: true,
      bankAccount: {
        id: bankAccount.id,
        accountLast4: bankAccount.AccountLast4,
        accountType: bankAccount.AccountType,
        accountName: bankAccount.AccountName,
        routingLast4: bankAccount.RoutingLast4,
        isDefault: bankAccount.IsDefault || false,
        isTokenized: false, // Not tokenized yet - will be tokenized on first withdrawal
        provider: bankAccount.Provider,
        createdAt: bankAccount.created_at
      },
      message: 'Bank account saved successfully. It will be tokenized automatically on your first withdrawal.'
    });
  } catch (error) {
    console.error('Error saving bank account:', error);
    return res.status(500).send({ error: error.message || 'Failed to save bank account' });
  }
};

// Set a bank account as default
export const setDefaultBankAccount = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { bankAccountId } = req.params;
    if (!bankAccountId) return res.status(400).send({ error: 'bankAccountId is required' });

    // First, unset all other default bank accounts for this user
    await prisma.bankAccount.updateMany({
      where: {
        UserId: parseInt(userId),
        IsDefault: true
      },
      data: { IsDefault: false }
    });

    // Set this bank account as default
    const bankAccount = await prisma.bankAccount.update({
      where: {
        id: parseInt(bankAccountId),
        UserId: parseInt(userId)
      },
      data: { IsDefault: true }
    });

    return res.json({
      success: true,
      bankAccount: {
        id: bankAccount.id,
        accountLast4: bankAccount.AccountLast4,
        isDefault: true
      }
    });
  } catch (error) {
    console.error('Error setting default bank account:', error);
    return res.status(500).send({ error: 'Failed to set default bank account' });
  }
};

// Delete a bank account (soft delete)
export const deleteBankAccount = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { bankAccountId } = req.params;
    if (!bankAccountId) return res.status(400).send({ error: 'bankAccountId is required' });

    const bankAccount = await prisma.bankAccount.update({
      where: {
        id: parseInt(bankAccountId),
        UserId: parseInt(userId)
      },
      data: { Active: false }
    });

    return res.json({
      success: true,
      message: 'Bank account deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting bank account:', error);
    return res.status(500).send({ error: 'Failed to delete bank account' });
  }
};

