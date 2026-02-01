import Decimal from 'decimal.js';
import prisma from '../prisma/prisma.js';
import * as paynetworxService from './paynetworxService.js';

// Get current wallet balance for a user
export const getWalletBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Validate userId
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).send({ error: 'Valid userId is required' });
    }

    const user = await prisma.Users.findUnique({
      where: { id: parseInt(userId) },
      select: { 
        id: true, 
        Username: true, 
        Wallet: true,
        Email: true 
      }
    });

    if (!user) {
      return res.status(404).send({ error: 'User not found' });
    }

    res.json({
      userId: user.id,
      username: user.Username,
      email: user.Email,
      balance: user.Wallet,
      currency: 'USD'
    });
  } catch (err) {
    console.error('Error getting wallet balance:', err);
    // Handle database connection errors
    if (err.code === 'P1001') {
      return res.status(503).send({ error: 'Database temporarily unavailable. Please try again.' });
    }
    res.status(500).send({ error: 'Failed to get wallet balance' });
  }
};

// Get transaction history for a user
export const getTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, type, provider } = req.query;
    
    // Validate userId
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).send({ error: 'Valid userId is required' });
    }

    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return res.status(400).send({ error: 'Invalid pagination parameters' });
    }

    // Check if user exists
    const user = await prisma.Users.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, Username: true }
    });

    if (!user) {
      return res.status(404).send({ error: 'User not found' });
    }

    // Build where clause
    const whereClause = {
      UserId: parseInt(userId)
    };

    // Add type filter if provided
    if (type && ['deposit', 'withdrawal', 'transfer', 'game_payout', 'game_loss'].includes(type)) {
      whereClause.Type = type;
    }

    // Add provider filter if provided (venmo, cashapp, paynetworx)
    if (provider && ['venmo', 'cashapp', 'paynetworx'].includes(provider)) {
      whereClause.Provider = provider;
    }

    // Get transactions with pagination
    const transactions = await prisma.Transaction.findMany({
      where: whereClause,
      orderBy: { created_at: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      select: {
        id: true,
        Type: true,
        Amount: true,
        Currency: true,
        Description: true,
        PaynetworxPaymentId: true,
        Paynetworx3DSId: true,
        Status: true,
        Provider: true,
        created_at: true,
      }
    });

    // Get total count for pagination
    const totalCount = await prisma.Transaction.count({
      where: whereClause
    });

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.status(200).send({
      userId: user.id,
      username: user.Username,
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.Type,
        amount: t.Amount,
        currency: t.Currency,
        description: t.Description,
        status: t.Status,
        provider: t.Provider,
        created_at: t.created_at.toISOString(),
        paynetworxPaymentId: t.PaynetworxPaymentId,
        paynetworx3DSId: t.Paynetworx3DSId
      })),
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasNextPage,
        hasPrevPage,
        limit: limitNum
      }
    });
  } catch (err) {
    console.error('Error getting transaction history:', err);
    // Handle database connection errors
    if (err.code === 'P1001') {
      return res.status(503).send({ error: 'Database temporarily unavailable. Please try again.' });
    }
    res.status(500).send({ error: 'Failed to get transaction history' });
  }
};

// Add funds to user wallet - supports PayNetWorx tokens via paymentMethodId
export const addFunds = async (req, res) => {
  //console.log('addFunds', req.body);
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { amount, currency = 'USD', paymentMethodId, bankAccountId, bankAccount, description } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).send({ error: 'Valid amount is required' });
    }

    // If paymentMethodId is provided, use saved PayNetWorx card token
    if (paymentMethodId) {
      const originalBody = { ...req.body };
      req.body.paymentMethodId = parseInt(paymentMethodId);
      req.body.amount = String(amount);
      req.body.currency = currency;
      req.body.description = description || 'Add funds to wallet';
      try {
        return await paynetworxService.processPaymentWithToken(req, res);
      } finally {
        req.body = originalBody;
      }
    }

    // If bankAccountId or bankAccount is provided, use ACH Debit deposit
    if (bankAccountId || bankAccount) {
      return await paynetworxService.processDepositWithBankAccount(req, res);
    }

    return res.status(400).send({ 
      error: 'paymentMethodId or bank account is required',
      message: 'Please provide a saved payment method ID, bank account, or use the 3DS flow to add funds'
    });
  } catch (err) {
    console.error('Error adding funds:', err);
    res.status(500).send({ error: 'Failed to add funds' });
  }
}; 

// CRUD add/withdraw methods specifically for venmo/cashapp
export const withdrawFundsCRUD = async (req, res) => {
  const { amount, provider: providerParam } = req.body;
  const provider = ['venmo', 'cashapp'].includes(providerParam) ? providerParam : 'cashapp';
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });
    
    const user = await prisma.Users.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, Username: true, Wallet: true }
    });

    if (!user) return res.status(404).send({ error: 'User not found' });
    
    const wallet = Number(user.Wallet);
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) return res.status(400).send({ error: 'Valid amount is required' });
    if (wallet < numAmount) return res.status(400).send({ error: 'Insufficient funds' });

    await prisma.Users.update({
      where: { id: parseInt(userId) },
      data: { Wallet: wallet - numAmount }
    });

    await prisma.Transaction.create({
      data: {
        UserId: parseInt(userId),
        Type: 'withdrawal',
        Amount: numAmount,
        Currency: 'USD',
        Description: provider === 'venmo' ? 'Withdrawal via Venmo' : 'Withdrawal via CashApp',
        Status: 'completed',
        Provider: provider
      }
    });

    res.status(200).send({ message: 'Funds withdrawn successfully' });
  } catch (err) {
    console.error('Error withdrawing funds:', err);
    res.status(500).send({ error: 'Failed to withdraw funds' });
  }
};

export const addFundsCRUD = async (req, res) => {
  const { amount, provider: providerParam } = req.body;
  const provider = ['venmo', 'cashapp'].includes(providerParam) ? providerParam : 'venmo';
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });
    
    const user = await prisma.Users.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, Username: true, Wallet: true }
    });

    if (!user) return res.status(404).send({ error: 'User not found' });

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) return res.status(400).send({ error: 'Valid amount is required' });

    await prisma.Users.update({
      where: { id: parseInt(userId) },
      data: { Wallet: Number(user.Wallet) + numAmount }
    });

    await prisma.Transaction.create({
      data: {
        UserId: parseInt(userId),
        Type: 'deposit',
        Amount: numAmount,
        Currency: 'USD',
        Description: provider === 'venmo' ? 'Deposit via Venmo' : 'Deposit via CashApp',
        Status: 'completed',
        Provider: provider
      }
    });

    res.status(200).send({ message: 'Funds added successfully' });
  } catch (err) {
    console.error('Error adding funds:', err);
    res.status(500).send({ error: 'Failed to add funds' });
  }
};