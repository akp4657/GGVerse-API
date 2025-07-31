import Stripe from 'stripe';
import Decimal from 'decimal.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Reconciliation function
export const reconcileBalances = async (req, res) => {
  try {
    // 1. Sum all user Wallets
    const users = await prisma.users.findMany({ select: { Wallet: true } });
    const totalUserWallet = users.reduce(
      (sum, user) => sum.plus(new Decimal(user.Wallet)),
      new Decimal(0)
    );

    // 2. Fetch Stripe available balance (in cents)
    const balance = await stripe.balance.retrieve();
    const usdBalance = balance.available.find(b => b.currency === 'usd');
    const stripeAvailable = usdBalance ? usdBalance.amount : 0; // in cents

    // 3. Compare
    const totalUserWalletCents = totalUserWallet.times(100).toNumber();

    res.json({
      totalUserWallet: totalUserWallet,
      totalUserWalletCents,
      stripeAvailable,
      difference: stripeAvailable - totalUserWalletCents,
      status:
        stripeAvailable >= totalUserWalletCents
          ? 'OK: Stripe balance covers all user balances'
          : 'WARNING: Stripe balance is less than user balances!',
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: err.message });
  }
};

export const addFunds = async (req, res) => {
  const { amount, currency, paymentMethodId, userId } = req.body;
  try {
    // Validate required fields
    if (!amount || !currency || !paymentMethodId || !userId) {
      return res.status(400).send({ error: 'Missing required fields: amount, currency, paymentMethodId, userId' });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).send({ error: 'Amount must be greater than 0' });
    }

    // Check if user exists
    const user = await prisma.users.findUnique({
      where: { id: parseInt(userId) }
    });

    if (!user) {
      return res.status(404).send({ error: 'User not found' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency,
      payment_method: paymentMethodId,
      payment_method_types: ['card'],
      confirm: true,
    });

    // Update user wallet in DB (assuming amount is in dollars)
    await prisma.users.update({
      where: { id: userId },
      data: { Wallet: { increment: amount } },
    });

    // Record transaction
    await prisma.transaction.create({
      data: {
        UserId: parseInt(userId),
        Type: 'deposit',
        Amount: new Decimal(amount),
        Currency: currency.toUpperCase(),
        Description: `Deposit via ${paymentMethodId}`,
        StripePaymentIntentId: paymentIntent.id,
        Status: 'completed'
      }
    });

    console.log(Number(user.Wallet) + Number(amount));
    console.log(typeof user.Wallet);
    console.log(typeof amount);
    res.json({ 
      success: true, 
      paymentIntent,
      newBalance: Number(user.Wallet) + Number(amount)
    });
  } catch (err) {
    console.log(err);
    res.status(400).send({ error: err.message });
  }
};

export const withdrawFunds = async (req, res) => {
  const { amount, currency, userId } = req.body;
  try {
    // Validate required fields
    if (!amount || !currency || !userId) {
      return res.status(400).send({ error: 'Missing required fields: amount, currency, userId' });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).send({ error: 'Amount must be greater than 0' });
    }

    // 1. Check user balance
    const user = await prisma.users.findUnique({ where: { id: parseInt(userId) } });
    if (!user) return res.status(404).send({ error: 'User not found' });

    if (user.Wallet < amount) {
      return res.status(400).send({ error: 'Insufficient balance' });
    }

    // 2. Initiate payout
    const payout = await stripe.payouts.create({
      amount: amount * 100,
      currency,
      // destination: ... (if using Stripe Connect)
    });

    // 3. Decrement user wallet
    await prisma.users.update({
      where: { id: userId },
      data: { Wallet: { decrement: amount } },
    });

    // Record transaction
    await prisma.transaction.create({
      data: {
        UserId: parseInt(userId),
        Type: 'withdrawal',
        Amount: new Decimal(amount),
        Currency: currency.toUpperCase(),
        Description: `Withdrawal to bank account`,
        StripePayoutId: payout.id,
        Status: 'completed'
      }
    });

    res.json({ 
      success: true, 
      payout,
      newBalance: Number(user.Wallet) - Number(amount)
    });
  } catch (err) {
    console.log(err);
    res.status(400).send({ error: err.message });
  }
};

export const getBalance = async(req, res) => {
    const balance = await stripe.balance.retrieve();
    res.json({ balance });
}   