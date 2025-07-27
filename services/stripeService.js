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
      totalUserWallet: totalUserWallet.toString(),
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
    res.status(500).json({ error: err.message });
  }
};

export const addFunds = async (req, res) => {
  const { amount, currency, paymentMethodId, userId } = req.body;
  try {
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

    res.json({ success: true, paymentIntent });
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: err.message });
  }
};

export const withdrawFunds = async (req, res) => {
  const { amount, currency, userId } = req.body;
  try {
    // 1. Check user balance
    const user = await prisma.users.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.Wallet < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
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

    res.json({ success: true, payout });
  } catch (err) {
    console.log(err);
    res.status(400).json({ error: err.message });
  }
};

export const getBalance = async(req, res) => {
    const balance = await stripe.balance.retrieve();
    res.json({ balance });
}   