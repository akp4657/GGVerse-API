import axios from 'axios';
import ksuid from 'ksuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PAYMENT_API_URL = process.env.PAYNETWORX_PAYMENT_API_URL?.replace(/\/$/, '') || process.env.PAYNETWORX_3DS_API_URL?.replace(/\/$/, '') || '';
const ACCESS_TOKEN_USER = process.env.PAYNETWORX_ACCESS_TOKEN_USER || process.env.PAYNETWORX_USERNAME;
const ACCESS_TOKEN_PASSWORD = process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD || process.env.PAYNETWORX_PASSWORD;
const MERCHANT_ID = process.env.PAYNETWORX_MERCHANT_ID;
const REQUEST_TIMEOUT_MS = Number(process.env.PAYNETWORX_REQUEST_TIMEOUT_MS || 15000);
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function getAuthHeader() {
  return `Basic ${btoa(`${ACCESS_TOKEN_USER}:${ACCESS_TOKEN_PASSWORD}`)}`;
}

async function pnxRequest(method, path, data) {
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

    const sessionData = {
      payment_session_use: 'TOKENIZE',
      merchant_id: MERCHANT_ID,
      return_url: `${APP_URL}/payment-methods/tokenize/callback`,
      cancel_url: `${APP_URL}/payment-methods/tokenize/cancel`
    };

    const session = await pnxRequest('post', '/v1/payments/sessions/create', sessionData);
    
    return res.json({
      sessionId: session.session_id || session.id,
      iframeUrl: session.iframe_url || session.url,
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

