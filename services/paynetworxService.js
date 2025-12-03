import axios from 'axios';
import ksuid from 'ksuid';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const THREE_DS_BASE_URL = process.env.PAYNETWORX_3DS_API_URL?.replace(/\/$/, '') || '';
// Payment API URL for ACH and other payment operations (not 3DS)
const PAYMENT_API_URL = process.env.PAYNETWORX_PAYMENT_API_URL?.replace(/\/$/, '') || process.env.PAYNETWORX_HOSTED_PAYMENTS_API_URL?.replace(/\/$/, '') || process.env.PAYNETWORX_3DS_API_URL?.replace(/\/$/, '') || '';
const ACCESS_TOKEN_USER = process.env.PAYNETWORX_ACCESS_TOKEN_USER || process.env.PAYNETWORX_USERNAME;
const ACCESS_TOKEN_PASSWORD = process.env.PAYNETWORX_ACCESS_TOKEN_PASSWORD || process.env.PAYNETWORX_PASSWORD;
const REQUEST_TIMEOUT_MS = Number(process.env.PAYNETWORX_REQUEST_TIMEOUT_MS || 15000);
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function getAuthHeader() {
  // Match PayNetWorx demo: use btoa() for base64 encoding
  return `Basic ${btoa(`${ACCESS_TOKEN_USER}:${ACCESS_TOKEN_PASSWORD}`)}`;
}

// Request helper for 3DS API endpoints
async function pnx3DSRequest(method, path, data) {
  const url = `${THREE_DS_BASE_URL}${path}`;
  const headers = {
    Authorization: getAuthHeader(),
    'Content-Type': 'application/json',
    'Request-ID': ksuid.randomSync().string
  };
  const resp = await axios({ method, url, data, headers, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true });
  if (resp.status >= 200 && resp.status < 300) return resp.data;
  const err = new Error(`PayNetWorx error ${resp.status}`);
  err.response = resp;
  throw err;
}

// Request helper for Payment API endpoints (ACH, etc.)
async function pnxPaymentRequest(method, path, data) {
  if (!PAYMENT_API_URL) {
    throw new Error('PayNetWorx Payment API URL not configured. Set PAYNETWORX_PAYMENT_API_URL or PAYNETWORX_HOSTED_PAYMENTS_API_URL');
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

    const pnx = await pnx3DSRequest('post', '/transaction/auth', authRequest);

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
    const pnx = await pnx3DSRequest('get', `/transaction/auth/${tranId}/3ds_method`);

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

// Step 2: Payment Processing with Tokens - Process payment using saved PayNetWorx token
export const processPaymentWithToken = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { paymentMethodId, amount, currency = 'USD', description } = req.body;
    if (!paymentMethodId || !amount) {
      return res.status(400).send({ error: 'paymentMethodId and amount are required' });
    }

    // Step 1: Look up PaymentMethod by ID and verify it belongs to user
    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: {
        id: parseInt(paymentMethodId),
        UserId: parseInt(userId),
        Active: true,
        Provider: 'paynetworx'
      }
    });

    if (!paymentMethod || !paymentMethod.ProviderPaymentMethodId) {
      return res.status(404).send({ error: 'Payment method not found or invalid' });
    }

    // Step 2: Create payment request using token
    // Note: PayNetWorx token payment structure - using 3DS API with token
    const paymentRequest = {
      Amount: {
        Total: String(amount),
        Fee: '0.00',
        Tax: '0.00',
        Currency: currency.toUpperCase()
      },
      PaymentMethod: {
        Token: {
          TokenValue: paymentMethod.ProviderPaymentMethodId
        }
      },
      Attributes: {
        EntryMode: 'token',
        ProcessingSpecifiers: { InitiatedByECommerce: true }
      },
      TransactionEntry: {
        Device: 'NA',
        DeviceVersion: 'NA',
        Application: 'GGVerse API',
        ApplicationVersion: '1.0',
        Timestamp: new Date().toISOString()
      },
      Detail: {
        MerchantData: {}
      }
    };

    // Step 3: Process payment via PayNetWorx 3DS API
    const pnx = await pnx3DSRequest('post', '/transaction/auth', paymentRequest);

    // Step 4: Create transaction record
    const trx = await prisma.transaction.create({
      data: {
        UserId: parseInt(userId),
        Type: 'deposit',
        Amount: Number(amount),
        Currency: currency.toUpperCase(),
        Description: description || 'Deposit via PayNetWorx token',
        PaynetworxPaymentId: pnx.TransactionID || null,
        Paynetworx3DSId: pnx.threeDSServerTransID || null,
        PaymentMethodId: parseInt(paymentMethodId),
        Status: pnx.PaymentResponse?.Response?.Approved || pnx.Approved ? 'completed' : 'failed'
      }
    });

    // Step 5: If approved, increment user wallet
    const approved = Boolean(pnx.PaymentResponse?.Response?.Approved) || Boolean(pnx.Approved);
    if (approved) {
      await prisma.users.update({
        where: { id: parseInt(userId) },
        data: { Wallet: { increment: Number(amount) } }
      });
    }

    return res.json({
      success: approved,
      transactionId: trx.id,
      paymentResponse: pnx,
      amount: Number(amount),
      currency: currency.toUpperCase()
    });
  } catch (e) {
    if (e.response) return res.status(e.response.status || 500).send(e.response.data || { error: 'Payment processing failed' });
    return res.status(500).send({ error: e.message });
  }
};

// Helper function to get tomorrow's date in YYYY-MM-DD format
function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// Helper function to get available balance (wallet - escrow)
async function getAvailableBalance(userId) {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { Wallet: true }
  });
  
  if (!user) return 0;
  
  // Check if ChallengeEscrow model exists (may not be migrated yet)
  try {
    const totalEscrow = await prisma.challengeEscrow.aggregate({
      where: {
        UserId: userId,
        Status: 'locked'
      },
      _sum: { Amount: true }
    });
    
    const available = Number(user.Wallet || 0) - Number(totalEscrow._sum.Amount || 0);
    return Math.max(0, available);
  } catch (error) {
    // ChallengeEscrow table doesn't exist yet, just return wallet balance
    return Number(user.Wallet || 0);
  }
}

// Withdrawal - Process withdrawal request (payout to user's bank account via ACH Credit)
export const processWithdrawal = async (req, res) => {
  let transaction = null;
  
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { 
      amount, 
      currency = 'USD', 
      description, 
      bankAccountId,  // Optional: if user has saved bank account token
      bankAccount     // Required if no bankAccountId
    } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).send({ error: 'Valid amount is required' });
    }

    // Step 1: Get user and calculate available balance
    const user = await prisma.users.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, Wallet: true, Username: true, Email: true }
    });

    if (!user) {
      return res.status(404).send({ error: 'User not found' });
    }

    const withdrawalAmount = Number(amount);
    const availableBalance = await getAvailableBalance(parseInt(userId));

    // Step 2: Validate sufficient balance
    if (withdrawalAmount > availableBalance) {
      const currentBalance = Number(user.Wallet || 0);
      const escrowedAmount = currentBalance - availableBalance;
      
      return res.status(400).send({ 
        error: 'Insufficient available balance',
        availableBalance,
        requestedAmount: withdrawalAmount,
        currentBalance,
        escrowedAmount: escrowedAmount > 0 ? escrowedAmount : 0
      });
    }

    // Step 3: Validate bank account information
    let achData = null;
    
    if (bankAccountId) {
      // Use saved bank account (if BankAccount model exists)
      try {
        const bankAccountToken = await prisma.bankAccount.findFirst({
          where: { 
            id: parseInt(bankAccountId), 
            UserId: parseInt(userId), 
            Active: true 
          }
        });
        
        if (!bankAccountToken) {
          return res.status(404).send({ error: 'Bank account not found or invalid' });
        }
        
        // If bank account has a token, use it
        if (bankAccountToken.ProviderBankId) {
          achData = {
            Token: { TokenID: bankAccountToken.ProviderBankId },
            ACH: {
              AchAccountType: bankAccountToken.AccountType,
              CustomerName: bankAccountToken.AccountName,
              EffectiveDate: getTomorrowDate()
            }
          };
        } else {
          // Bank account exists but not tokenized - require full account number for first withdrawal
          // Routing number is already saved, we just need the full account number
          if (!bankAccount || !bankAccount.accountNumber) {
            return res.status(400).send({ 
              error: 'Bank account not tokenized. Please provide your full account number to complete the withdrawal. This is a one-time process.',
              bankAccountId: parseInt(bankAccountId),
              message: 'Your bank account will be tokenized automatically after this withdrawal for future use.',
              requiredFields: ['accountNumber']
            });
          }
          
          // Validate account number (must be at least 4 digits)
          if (!bankAccount.accountNumber || bankAccount.accountNumber.length < 4) {
            return res.status(400).send({ error: 'Invalid account number. Must be at least 4 digits.' });
          }
          
          // Verify that the last 4 digits match what we have on file
          const providedLast4 = bankAccount.accountNumber.slice(-4);
          if (bankAccountToken.AccountLast4 && providedLast4 !== bankAccountToken.AccountLast4) {
            return res.status(400).send({ 
              error: 'Account number does not match. Please verify the last 4 digits match your saved account.',
              expectedLast4: bankAccountToken.AccountLast4
            });
          }
          
          // Use saved routing number (stored in RoutingLast4) and provided full account number
          // Tokenize during withdrawal
          achData = {
            ACH: {
              BankRoutingNumber: bankAccountToken.RoutingLast4, // Full routing number stored here
              AccountNumber: bankAccount.accountNumber, // Full account number provided by user
              AchAccountType: bankAccountToken.AccountType,
              CustomerName: bankAccountToken.AccountName,
              CustomerIdentifier: userId.toString(),
              EffectiveDate: getTomorrowDate()
            },
            DataAction: 'token/add' // Always tokenize on first use
          };
        }
      } catch (error) {
        // BankAccount model doesn't exist yet
        return res.status(400).send({ 
          error: 'Bank account tokenization not yet available. Please provide bank account details.' 
        });
      }
    } else {
      // Use provided bank account details
      if (!bankAccount || !bankAccount.routingNumber || !bankAccount.accountNumber || 
          !bankAccount.accountType || !bankAccount.accountHolderName) {
        return res.status(400).send({ 
          error: 'Bank account information is required',
          requiredFields: ['routingNumber', 'accountNumber', 'accountType', 'accountHolderName']
        });
      }
      
      // Validate routing number (must be 9 digits)
      if (!/^\d{9}$/.test(bankAccount.routingNumber)) {
        return res.status(400).send({ error: 'Invalid routing number. Must be 9 digits.' });
      }
      
      // Validate account type
      const validAccountTypes = ['PersonalChecking', 'PersonalSavings', 'BusinessChecking', 'BusinessSavings'];
      if (!validAccountTypes.includes(bankAccount.accountType)) {
        return res.status(400).send({ 
          error: 'Invalid account type',
          validTypes: validAccountTypes
        });
      }
      
      achData = {
        ACH: {
          BankRoutingNumber: bankAccount.routingNumber,
          AccountNumber: bankAccount.accountNumber,
          AchAccountType: bankAccount.accountType,
          CustomerName: bankAccount.accountHolderName,
          CustomerIdentifier: userId.toString(),
          EffectiveDate: getTomorrowDate()
        }
      };
      
      // If tokenize requested, add DataAction
      if (bankAccount.tokenize) {
        achData.DataAction = 'token/add';
      }
    }

    // Step 4: Create withdrawal transaction (status: pending)
    transaction = await prisma.transaction.create({
      data: {
        UserId: parseInt(userId),
        Type: 'withdrawal',
        Amount: withdrawalAmount,
        Currency: currency.toUpperCase(),
        Description: description || 'Withdrawal to bank account',
        Status: 'pending'
      }
    });

    // Step 5: Decrement wallet balance
    await prisma.users.update({
      where: { id: parseInt(userId) },
      data: { Wallet: { decrement: withdrawalAmount } }
    });

    // Step 6: Call PayNetWorx ACH Credit API
    // Format amount with exactly 2 decimal places for currency validation
    const formattedAmount = Number(withdrawalAmount).toFixed(2);
    const achCreditRequest = {
      Amount: {
        Total: formattedAmount,
        Currency: currency.toUpperCase()
      },
      PaymentMethod: achData,
      TransactionEntry: {
        Device: 'NA',
        DeviceVersion: 'NA',
        Application: 'GGVerse API',
        ApplicationVersion: '1.0',
        Timestamp: new Date().toISOString()
      },
      Detail: {
        MerchantData: {
          MerchantDefinedKey1: `withdrawal_${transaction.id}`,
          MerchantDefinedKey2: userId.toString()
        }
      }
    };

    const pnxResponse = await pnxPaymentRequest('post', '/transaction/achcredit', achCreditRequest);

    // Step 7: Handle response
    const approved = pnxResponse.Approved === true;

    if (approved) {
      // Update transaction status
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          Status: 'completed',
          PaynetworxPaymentId: pnxResponse.TransactionID
        }
      });

      // If tokenization occurred and token returned, save or update it
      if (pnxResponse.Token?.TokenID) {
        try {
          // If bankAccountId was provided, update that bank account with the token
          if (bankAccountId) {
            await prisma.bankAccount.update({
              where: { id: parseInt(bankAccountId) },
              data: {
                ProviderBankId: pnxResponse.Token.TokenID
              }
            });
          } else if (bankAccount && bankAccount.tokenize) {
            // New bank account - check if one exists with same details
            const existingBankAccount = await prisma.bankAccount.findFirst({
              where: {
                UserId: parseInt(userId),
                AccountLast4: bankAccount.accountNumber.slice(-4),
                RoutingLast4: bankAccount.routingNumber.slice(-4),
                AccountType: bankAccount.accountType
              }
            });

            if (existingBankAccount) {
              // Update existing bank account with token
              await prisma.bankAccount.update({
                where: { id: existingBankAccount.id },
                data: {
                  ProviderBankId: pnxResponse.Token.TokenID
                }
              });
            } else {
              // Create new bank account with token
              await prisma.bankAccount.create({
                data: {
                  UserId: parseInt(userId),
                  Provider: 'paynetworx',
                  ProviderBankId: pnxResponse.Token.TokenID,
                  AccountType: bankAccount.accountType,
                  AccountName: bankAccount.accountHolderName,
                  AccountLast4: bankAccount.accountNumber.slice(-4),
                  RoutingLast4: bankAccount.routingNumber.slice(-4),
                  Active: true,
                  IsDefault: false
                }
              });
            }
          }
        } catch (error) {
          // BankAccount model doesn't exist yet, just log
          console.error('Bank account tokenization skipped - model not available:', error.message);
        }
      }

      return res.json({
        success: true,
        transactionId: transaction.id,
        amount: withdrawalAmount,
        currency: currency.toUpperCase(),
        newBalance: availableBalance - withdrawalAmount,
        status: 'completed',
        paynetworxTransactionId: pnxResponse.TransactionID,
        message: 'Withdrawal processed successfully'
      });
    } else {
      // Payment failed - reverse wallet decrement
      await prisma.users.update({
        where: { id: parseInt(userId) },
        data: { Wallet: { increment: withdrawalAmount } }
      });

      await prisma.transaction.update({
        where: { id: transaction.id },
        data: { Status: 'failed' }
      });

      return res.status(400).send({
        error: 'Withdrawal failed',
        message: pnxResponse.ResponseText || 'ACH credit request was not approved',
        transactionId: transaction.id
      });
    }
  } catch (e) {
    // If wallet was decremented but API call failed, reverse it
    if (transaction && transaction.Status === 'pending') {
      try {
        await prisma.users.update({
          where: { id: parseInt(req.user?.userId || req.user?.id) },
          data: { Wallet: { increment: Number(req.body.amount) } }
        });
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { Status: 'failed' }
        });
      } catch (reversalError) {
        console.error('Error reversing withdrawal:', reversalError);
      }
    }

    // Log detailed error for debugging
    console.error('PayNetWorx ACH Credit Error:', e.response?.data || e.message);
    if (e.response) {
      console.error('Response Status:', e.response.status);
      console.error('Response Data:', JSON.stringify(e.response.data, null, 2));
      return res.status(e.response.status || 500).send(e.response.data || { error: 'Withdrawal processing failed' });
    }
    return res.status(500).send({ error: e.message });
  }
};

