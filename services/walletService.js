import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import * as paynetworxService from './paynetworxService.js';

const prisma = new PrismaClient();

// Get current wallet balance for a user
export const getWalletBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Validate userId
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).send({ error: 'Valid userId is required' });
    }

    const user = await prisma.users.findUnique({
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
    res.status(500).send({ error: 'Failed to get wallet balance' });
  }
};

// Get transaction history for a user
export const getTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, type } = req.query;
    
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
    const user = await prisma.users.findUnique({
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

    // Get transactions with pagination
    const transactions = await prisma.transaction.findMany({
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
        created_at: true,
      }
    });

    // Get total count for pagination
    const totalCount = await prisma.transaction.count({
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
    res.status(500).send({ error: 'Failed to get transaction history' });
  }
};

// Add funds to user wallet - supports PayNetWorx tokens via paymentMethodId
export const addFunds = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    if (!userId) return res.status(401).send({ error: 'User authentication required' });

    const { amount, currency = 'USD', paymentMethodId, description } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).send({ error: 'Valid amount is required' });
    }

    // If paymentMethodId is provided, use saved PayNetWorx token
    if (paymentMethodId) {
      // Forward to processPaymentWithToken by updating req.body
      // processPaymentWithToken expects: paymentMethodId, amount, currency, description
      const originalBody = { ...req.body };
      req.body.paymentMethodId = parseInt(paymentMethodId);
      req.body.amount = String(amount);
      req.body.currency = currency;
      req.body.description = description || 'Add funds to wallet';
      
      // Call processPaymentWithToken - it handles the payment and wallet increment
      // Restore original body after call (though res will be sent, so this is just cleanup)
      try {
        console.log('Processing payment with token:', req.body);
        return await paynetworxService.processPaymentWithToken(req, res);
      } finally {
        req.body = originalBody;
      }
    }

    // If no paymentMethodId, return error - user must provide a payment method
    // In the future, this could fall back to 3DS flow or other payment methods
    return res.status(400).send({ 
      error: 'paymentMethodId is required',
      message: 'Please provide a saved payment method ID or use the 3DS flow to add funds'
    });
  } catch (err) {
    console.error('Error adding funds:', err);
    res.status(500).send({ error: 'Failed to add funds' });
  }
}; 