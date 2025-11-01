import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const THREE_DS_BASE_URL = process.env.PAYNETWORX_3DS_API_URL?.replace(/\/$/, '') || '';
const ACCESS_TOKEN_USER = process.env.PAYNETWORX_ACCESS_TOKEN_USER || process.env.PAYNETWORX_USERNAME;
const ACCESS_TOKEN_PASSWORD = process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD || process.env.PAYNETWORX_PASSWORD;
const REQUEST_TIMEOUT_MS = Number(process.env.PAYNETWORX_REQUEST_TIMEOUT_MS || 15000);
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function getAuthHeader() {
  // Match PayNetWorx demo: use btoa() for base64 encoding
  return `Basic ${btoa(`${ACCESS_TOKEN_USER}:${ACCESS_TOKEN_PASSWORD}`)}`;
}

async function pnxRequest(method, path, data) {
  const url = `${THREE_DS_BASE_URL}${path}`;
  const headers = {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
    'Request-ID': uuidv4()
  };
  const resp = await axios({ method, url, data, headers, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
  if (resp.status >= 200 && resp.status < 300) return resp.data;
  const err = new Error(`PayNetWorx error ${resp.status}`);
  err.response = resp;
  throw err;
}

export const initiate3DSAuth = async (req, res) => {
  try {
    const { cardNumber, cardHolder, expiryDate, cvv, amount, currency = 'USD', userId, browser_info } = req.body;

    if (!cardNumber || !expiryDate || !cvv || !amount || !userId) {
      return res.status(400).send({ error: 'Missing required fields: cardNumber, expiryDate, cvv, amount, userId' });
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
      Detail: {
        MerchantData: {}
      },
      ThreedsData: Object.assign({ deviceChannel: '02', threeDSRequestorURL: APP_URL }, browser_info || {})
    };

    const pnx = await pnxRequest('post', '/transaction/auth', authRequest);

    // Record pending transaction
    const trx = await prisma.transaction.create({
      data: {
        UserId: parseInt(userId),
        Type: 'deposit',
        Amount: Number(amount),
        Currency: currency.toUpperCase(),
        Description: 'Deposit via PayNetWorx 3DS',
        PaynetworxPaymentId: pnx.TransactionID || null,
        Paynetworx3DSId: pnx.threeDSServerTransID || null,
        Status: 'pending_3ds'
      }
    });

    if (pnx.threeDSMethodURL) {
      return res.json({
        threeDSServerTransID: pnx.threeDSServerTransID,
        transactionId: trx.id,
        MethodData: {
          threeDSMethodURL: pnx.threeDSMethodURL,
          threeDSMethodNotificationURL: pnx.threeDSMethodNotificationURL
        }
      });
    }

    if (pnx.challengeData) {
      return res.json({
        threeDSServerTransID: pnx.threeDSServerTransID,
        transactionId: trx.id,
        challengeData: {
          CompleteAuthChallengeURL: pnx.CompleteAuthChallengeURL,
          acsURL: pnx.challengeData.acsURL,
          acsChallengeMandated: pnx.challengeData.acsChallengeMandated,
          encodedCReq: pnx.challengeData.encodedCReq
        }
      });
    }

    // Frictionless — mark completed and increment wallet
    await prisma.users.update({ where: { id: parseInt(userId) }, data: { Wallet: { increment: Number(amount) } } });
    await prisma.transaction.update({ where: { id: trx.id }, data: { Status: 'completed' } });

    return res.json({ threeDSServerTransID: pnx.threeDSServerTransID, transactionId: trx.id, PaymentResponse: pnx, status: 'completed' });
  } catch (e) {
    if (e.response) {
      return res.status(e.response.status || 500).send(e.response.data || { error: '3DS initiation failed' });
    }
    return res.status(500).send({ error: e.message });
  }
};

export const check3DSMethod = async (req, res) => {
  try {
    const { tranId } = req.params;
    if (!tranId) return res.status(400).send({ error: 'tranId is required' });
    const pnx = await pnxRequest('get', `/transaction/auth/${tranId}/3ds_method`);

    if (pnx.challengeData) {
      return res.json({
        threeDSServerTransID: pnx.threeDSServerTransID,
        challengeData: {
          CompleteAuthChallengeURL: pnx.CompleteAuthChallengeURL,
          acsURL: pnx.challengeData.acsURL,
          acsChallengeMandated: pnx.challengeData.acsChallengeMandated,
          encodedCReq: pnx.challengeData.encodedCReq
        }
      });
    }

    // frictionless after method
    const trx = await prisma.transaction.findFirst({ where: { Paynetworx3DSId: pnx.threeDSServerTransID } });
    if (trx && trx.Status === 'pending_3ds') {
      await prisma.users.update({ where: { id: trx.UserId }, data: { Wallet: { increment: Number(trx.Amount) } } });
      await prisma.transaction.update({ where: { id: trx.id }, data: { Status: 'completed' } });
    }

    return res.json({ threeDSServerTransID: pnx.threeDSServerTransID, PaymentResponse: pnx, status: 'completed' });
  } catch (e) {
    if (e.response) return res.status(e.response.status || 500).send(e.response.data);
    return res.status(500).send({ error: e.message });
  }
};

async function waitForChallenge(tranId, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const headers = { Authorization: getAuthHeader(), 'Content-Type': 'application/json' };
    const url = `${THREE_DS_BASE_URL}/transaction/auth/${tranId}/auth_challenge`;
    try {
      const resp = await axios.get(url, { headers, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
      if (resp.status === 404) throw Object.assign(new Error('Not ready'), { notReady: true });
      if (resp.status >= 200 && resp.status < 300) return resp.data;
      const err = new Error(`PayNetWorx error ${resp.status}`); err.response = resp; throw err;
    } catch (err) {
      if (err.notReady || (err.response && err.response.status === 404)) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Challenge result not ready');
}

export const checkChallengeResult = async (req, res) => {
  try {
    const { tranId } = req.params;
    if (!tranId) return res.status(400).send({ error: 'tranId is required' });

    const result = await waitForChallenge(tranId);
    const trx = await prisma.transaction.findFirst({ where: { Paynetworx3DSId: result.threeDSServerTransID } });

    if (trx) {
      const approved = Boolean(result?.PaymentResponse?.Response?.Approved) || Boolean(result?.Approved);
      if (approved) {
        await prisma.users.update({ where: { id: trx.UserId }, data: { Wallet: { increment: Number(trx.Amount) } } });
        await prisma.transaction.update({ where: { id: trx.id }, data: { Status: 'completed' } });
      } else {
        await prisma.transaction.update({ where: { id: trx.id }, data: { Status: 'failed' } });
      }
    }

    return res.json({ threeDSServerTransID: result.threeDSServerTransID, PaymentResponse: result });
  } catch (e) {
    if (e.response) return res.status(e.response.status || 500).send(e.response.data);
    return res.status(500).send({ error: e.message });
  }
};


