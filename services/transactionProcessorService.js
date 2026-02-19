import prisma from '../prisma/prisma.js';
import cron from 'node-cron';

/**
 * Process pending Venmo/CashApp transactions that have reached their processAt time
 * This function should be called periodically (e.g., every minute) via cron job
 */
export const processPendingTransactions = async () => {
  try {
    const now = new Date();
    
    // Find all pending transactions where processAt has passed
    const pendingTransactions = await prisma.Transaction.findMany({
      where: {
        Status: 'pending',
        Provider: {
          in: ['venmo', 'cashapp']
        },
        processAt: {
          lte: now
        }
      },
      include: {
        Users: {
          select: {
            id: true,
            Username: true,
            Wallet: true
          }
        }
      },
      orderBy: {
        processAt: 'asc' // Process oldest first
      }
    });

    if (pendingTransactions.length === 0) {
      return { processed: 0, errors: [] };
    }

    console.log(`[TransactionProcessor] Found ${pendingTransactions.length} pending transactions to process`);

    const errors = [];
    let processed = 0;

    for (const transaction of pendingTransactions) {
      try {
        const user = transaction.Users;
        if (!user) {
          console.error(`[TransactionProcessor] User not found for transaction ${transaction.id}`);
          errors.push({ transactionId: transaction.id, error: 'User not found' });
          continue;
        }

        const amount = Number(transaction.Amount);
        const currentWallet = Number(user.Wallet);

        if (transaction.Type === 'deposit') {
          // For deposits: add funds to wallet
          const newBalance = currentWallet + amount;
          
          await prisma.$transaction([
            prisma.Users.update({
              where: { id: user.id },
              data: { Wallet: newBalance }
            }),
            prisma.Transaction.update({
              where: { id: transaction.id },
              data: { Status: 'completed' }
            })
          ]);

          console.log(`[TransactionProcessor] Processed deposit: Transaction ${transaction.id}, User ${user.id}, Amount $${amount}, New Balance $${newBalance}`);
          processed++;

        } else if (transaction.Type === 'withdrawal') {
          // For withdrawals: deduct funds from wallet
          // Double-check sufficient funds (in case balance changed)
          if (currentWallet < amount) {
            console.error(`[TransactionProcessor] Insufficient funds for withdrawal: Transaction ${transaction.id}, User ${user.id}, Balance $${currentWallet}, Requested $${amount}`);
            
            // Mark transaction as failed
            await prisma.Transaction.update({
              where: { id: transaction.id },
              data: { Status: 'failed' }
            });
            
            errors.push({ 
              transactionId: transaction.id, 
              error: `Insufficient funds. Balance: $${currentWallet}, Requested: $${amount}` 
            });
            continue;
          }

          const newBalance = currentWallet - amount;
          
          await prisma.$transaction([
            prisma.Users.update({
              where: { id: user.id },
              data: { Wallet: newBalance }
            }),
            prisma.Transaction.update({
              where: { id: transaction.id },
              data: { Status: 'completed' }
            })
          ]);

          console.log(`[TransactionProcessor] Processed withdrawal: Transaction ${transaction.id}, User ${user.id}, Amount $${amount}, New Balance $${newBalance}`);
          processed++;
        }
      } catch (error) {
        console.error(`[TransactionProcessor] Error processing transaction ${transaction.id}:`, error);
        errors.push({ transactionId: transaction.id, error: error.message });
      }
    }

    console.log(`[TransactionProcessor] Completed: ${processed} processed, ${errors.length} errors`);
    return { processed, errors };
  } catch (error) {
    console.error('[TransactionProcessor] Fatal error:', error);
    return { processed: 0, errors: [{ error: error.message }] };
  }
};

/**
 * Start the transaction processor cron job
 * Runs every minute to check for pending transactions
 */
export const startTransactionProcessor = () => {
  // Run every minute: * * * * *
  cron.schedule('* * * * *', async () => {
    await processPendingTransactions();
  });

  // Also run immediately on startup to catch any overdue transactions
  console.log('[TransactionProcessor] Starting transaction processor...');
  processPendingTransactions().catch(error => {
    console.error('[TransactionProcessor] Error in initial run:', error);
  });

  console.log('[TransactionProcessor] Transaction processor started (runs every minute via cron)');
};
