import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();

// Get current wallet balance for a user
export const getWalletBalance = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Validate userId
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'Valid userId is required' });
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
      return res.status(404).json({ error: 'User not found' });
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
    res.status(500).json({ error: 'Failed to get wallet balance' });
  }
};

// Get transaction history for a user
export const getTransactionHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, type } = req.query;
    
    // Validate userId
    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).json({ error: 'Valid userId is required' });
    }

    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    }

    // Check if user exists
    const user = await prisma.users.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, Username: true }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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
        Status: true,
        created_at: true,
        StripePaymentIntentId: true,
        StripePayoutId: true
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

    res.json({
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
        stripePaymentIntentId: t.StripePaymentIntentId,
        stripePayoutId: t.StripePayoutId
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
    res.status(500).json({ error: 'Failed to get transaction history' });
  }
}; 