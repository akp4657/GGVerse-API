# Challenge Payment Flow Integration Plan

## Overview

Implement payment flow for challenges using internal wallet system. Users deposit via PayNetWorx tokens (already working), wagers are locked in escrow when challenges are accepted, and winners receive payouts from wallet on completion.

## Current State

- ✅ Tokenization working (PayNetWorx tokens saved)
- ✅ Deposit flow working (addFunds → processPaymentWithToken → Wallet increment)
- ✅ Challenge creation/acceptance endpoints exist
- ❌ No escrow system
- ❌ No challenge completion/payout logic
- ❌ No balance validation

## Implementation Steps

### 1. Database Schema Updates

**File: `prisma/schema.prisma`**

Add to `Challenges` model:

```prisma
model Challenges {
  // ... existing fields ...
  WinnerId              Int?      // Set when challenge completes
  CompletedAt           DateTime? // Completion timestamp
}
```

Add new `ChallengeEscrow` model:

```prisma
model ChallengeEscrow {
  id          Int       @id @default(autoincrement())
  ChallengeId Int
  UserId      Int
  Amount      Decimal   @db.Decimal
  Status      String    @default("locked") // 'locked' | 'released' | 'refunded'
  CreatedAt   DateTime  @default(now()) @db.Timestamptz(6)
  ReleasedAt  DateTime? @db.Timestamptz(6)
  
  Challenge   Challenges @relation(fields: [ChallengeId], references: [id], onDelete: Cascade)
  User        Users     @relation(fields: [UserId], references: [id], onDelete: Cascade)
  
  @@index([ChallengeId])
  @@index([UserId])
  @@index([Status])
}
```

Add relation to `Users` model:

```prisma
model Users {
  // ... existing fields ...
  ChallengeEscrow       ChallengeEscrow[]
}
```

Add relation to `Transaction` model:

```prisma
model Transaction {
  // ... existing fields ...
  ChallengeId           Int?
  Challenge             Challenges? @relation(fields: [ChallengeId], references: [id])
}
```

**Migration:** Run `npx prisma migrate dev --name add_challenge_escrow`

### 2. Balance Validation Helper

**File: `services/challengeService.js`**

Add helper function to check available balance:

```javascript
/**
 * Get user's available balance (wallet - escrow)
 */
const getAvailableBalance = async (userId) => {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { Wallet: true }
  });
  
  const totalEscrow = await prisma.challengeEscrow.aggregate({
    where: {
      UserId: userId,
      Status: 'locked'
    },
    _sum: { Amount: true }
  });
  
  const available = Number(user.Wallet || 0) - Number(totalEscrow._sum.Amount || 0);
  return available;
};
```

### 3. Update Challenge Acceptance

**File: `services/challengeService.js` - `acceptChallenge()` function**

Add before status update (around line 237):

```javascript
// Check both players have sufficient balance
const challengerBalance = await getAvailableBalance(challenge.ChallengerId);
const challengedBalance = await getAvailableBalance(challenge.ChallengedId);
const wagerAmount = Number(challenge.Wager);

if (challengerBalance < wagerAmount) {
  return res.status(400).json({ 
    error: 'Challenger has insufficient balance',
    availableBalance: challengerBalance,
    required: wagerAmount
  });
}

if (challengedBalance < wagerAmount) {
  return res.status(400).json({ 
    error: 'You have insufficient balance to accept this challenge',
    availableBalance: challengedBalance,
    required: wagerAmount
  });
}

// Create escrow records for both players
await prisma.challengeEscrow.createMany({
  data: [
    {
      ChallengeId: challenge.id,
      UserId: challenge.ChallengerId,
      Amount: wagerAmount,
      Status: 'locked'
    },
    {
      ChallengeId: challenge.id,
      UserId: challenge.ChallengedId,
      Amount: wagerAmount,
      Status: 'locked'
    }
  ]
});
```

### 4. Challenge Completion Endpoint

**File: `services/challengeService.js`**

Add new function:

```javascript
/**
 * Complete a challenge and process payouts
 */
export const completeChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { winnerId, result } = req.body; // result: score, proof, etc.
    
    const challenge = await prisma.challenges.findUnique({
      where: { id: parseInt(challengeId) },
      include: { Challenger: true, Challenged: true }
    });
    
    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }
    
    if (challenge.Status !== 'accepted') {
      return res.status(400).json({ error: 'Challenge must be accepted to complete' });
    }
    
    // Validate winner is one of the players
    if (winnerId !== challenge.ChallengerId && winnerId !== challenge.ChallengedId) {
      return res.status(400).json({ error: 'Invalid winner' });
    }
    
    const wagerAmount = Number(challenge.Wager);
    const totalPot = wagerAmount * 2;
    const platformFee = totalPot * 0.05; // 5% platform fee
    const winnerPayout = totalPot - platformFee;
    const loserId = winnerId === challenge.ChallengerId 
      ? challenge.ChallengedId 
      : challenge.ChallengerId;
    
    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Release escrow and payout winner
      await tx.challengeEscrow.updateMany({
        where: {
          ChallengeId: challenge.id,
          UserId: winnerId,
          Status: 'locked'
        },
        data: {
          Status: 'released',
          ReleasedAt: new Date()
        }
      });
      
      // Refund loser's escrow
      await tx.challengeEscrow.updateMany({
        where: {
          ChallengeId: challenge.id,
          UserId: loserId,
          Status: 'locked'
        },
        data: {
          Status: 'refunded',
          ReleasedAt: new Date()
        }
      });
      
      // Update winner's wallet (their wager + opponent's wager - fee)
      await tx.users.update({
        where: { id: winnerId },
        data: { Wallet: { increment: winnerPayout } }
      });
      
      // Loser's wallet unchanged (escrow was already locked, now refunded)
      await tx.users.update({
        where: { id: loserId },
        data: { Wallet: { increment: wagerAmount } } // Refund their wager
      });
      
      // Create payout transaction for winner
      await tx.transaction.create({
        data: {
          UserId: winnerId,
          Type: 'game_payout',
          Amount: winnerPayout,
          Currency: 'USD',
          Description: `Challenge win payout - ${challenge.Game}`,
          ChallengeId: challenge.id,
          Status: 'completed'
        }
      });
      
      // Create refund transaction for loser
      await tx.transaction.create({
        data: {
          UserId: loserId,
          Type: 'challenge_refund',
          Amount: wagerAmount,
          Currency: 'USD',
          Description: `Challenge refund - ${challenge.Game}`,
          ChallengeId: challenge.id,
          Status: 'completed'
        }
      });
      
      // Update challenge status
      await tx.challenges.update({
        where: { id: challenge.id },
        data: {
          Status: 'completed',
          WinnerId: winnerId,
          CompletedAt: new Date()
        }
      });
      
      // Create match history record
      await tx.match_History.create({
        data: {
          Game: challenge.Game,
          P1: challenge.ChallengerId,
          P2: challenge.ChallengedId,
          Result: winnerId === challenge.ChallengerId,
          Status: 2, // Completed
          BetAmount: wagerAmount
        }
      });
    });
    
    // Fetch updated challenge
    const completedChallenge = await prisma.challenges.findUnique({
      where: { id: challenge.id },
      include: {
        Challenger: { select: { id: true, Username: true, Avatar: true } },
        Challenged: { select: { id: true, Username: true, Avatar: true } }
      }
    });
    
    res.status(200).json({
      message: 'Challenge completed successfully',
      success: true,
      challenge: completedChallenge,
      winnerId,
      payout: winnerPayout
    });
    
  } catch (error) {
    console.error('Error completing challenge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
```

### 5. Challenge Cancellation (Refund Escrow)

**File: `services/challengeService.js` - Update `cancelChallenge()` function**

Add escrow refund logic (around line 466):

```javascript
// If challenge is accepted, refund escrow
if (challenge.Status === 'accepted') {
  const escrowRecords = await prisma.challengeEscrow.findMany({
    where: {
      ChallengeId: challenge.id,
      Status: 'locked'
    }
  });
  
  await prisma.$transaction(async (tx) => {
    for (const escrow of escrowRecords) {
      // Refund to wallet
      await tx.users.update({
        where: { id: escrow.UserId },
        data: { Wallet: { increment: Number(escrow.Amount) } }
      });
      
      // Mark escrow as refunded
      await tx.challengeEscrow.update({
        where: { id: escrow.id },
        data: {
          Status: 'refunded',
          ReleasedAt: new Date()
        }
      });
      
      // Create refund transaction
      await tx.transaction.create({
        data: {
          UserId: escrow.UserId,
          Type: 'challenge_refund',
          Amount: escrow.Amount,
          Currency: 'USD',
          Description: 'Challenge cancellation refund',
          ChallengeId: challenge.id,
          Status: 'completed'
        }
      });
    }
    
    // Delete challenge
    await tx.challenges.delete({
      where: { id: parseInt(challengeId) }
    });
  });
} else {
  // Just delete if not accepted
  await prisma.challenges.delete({
    where: { id: parseInt(challengeId) }
  });
}
```

### 6. API Endpoint

**File: `app.js`**

Add new route:

```javascript
app.post('/challenges/:challengeId/complete', geofence, challengeService.completeChallenge);
```

### 7. Update Balance Endpoint

**File: `services/walletService.js` - Update `getWalletBalance()`**

Add available balance calculation:

```javascript
// Get total escrow
const totalEscrow = await prisma.challengeEscrow.aggregate({
  where: {
    UserId: parseInt(userId),
    Status: 'locked'
  },
  _sum: { Amount: true }
});

res.json({
  userId: user.id,
  username: user.Username,
  email: user.Email,
  balance: user.Wallet,
  availableBalance: Number(user.Wallet) - Number(totalEscrow._sum.Amount || 0),
  escrowedAmount: Number(totalEscrow._sum.Amount || 0),
  currency: 'USD'
});
```

## Testing Checklist

- [ ] User with insufficient balance cannot accept challenge
- [ ] Escrow created when challenge accepted
- [ ] Available balance decreases when challenge accepted
- [ ] Challenge completion pays winner correctly
- [ ] Loser gets refund on completion
- [ ] Challenge cancellation refunds escrow
- [ ] Transaction history shows escrow/payout records
- [ ] Match history created on completion

## Notes

- Platform fee: 5% (configurable via env var)
- Escrow uses logical locking (no wallet decrement on acceptance)
- All financial operations use database transactions for atomicity
- PayNetWorx tokens only used for initial deposits, not challenge payouts
- Payouts use internal wallet (no PayNetWorx payout API needed for challenges)