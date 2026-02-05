import prisma from '../prisma/prisma.js';

export class SimpleRankingService {
  // Normalization thresholds (99th percentile caps)
  static MAX_MATCHES = 500;
  static MAX_WINS = 400;
  static MAX_EARNINGS = 10000; // $10,000 in cents

  // Weights for ranking components
  static WEIGHT_MATCHES_PLAYED = 0.50;
  static WEIGHT_MATCHES_WON = 0.30;
  static WEIGHT_EARNINGS = 0.20;

  /**
   * Calculate normalized rank score (0-1000) for a user
   * Formula: (matchesPlayed * 0.50 + matchesWon * 0.30 + earnings * 0.20) * 1000
   */
  async calculateRankScore(userId) {
    try {
      const matchesPlayed = await this.getMatchesPlayed(userId);
      const matchesWon = await this.getMatchesWon(userId);
      const lifetimeEarnings = await this.getLifetimeEarnings(userId);

      // Normalize each component (0-1 scale)
      const normalizedPlayed = this.normalizeMatchesPlayed(matchesPlayed);
      const normalizedWon = this.normalizeMatchesWon(matchesWon);
      const normalizedEarnings = this.normalizeEarnings(lifetimeEarnings);

      // Apply weights and scale to 0-1000
      const score = (
        normalizedPlayed * SimpleRankingService.WEIGHT_MATCHES_PLAYED +
        normalizedWon * SimpleRankingService.WEIGHT_MATCHES_WON +
        normalizedEarnings * SimpleRankingService.WEIGHT_EARNINGS
      ) * 1000;

      return Math.round(score);
    } catch (error) {
      console.error(`Error calculating rank score for user ${userId}:`, error);
      return 0; // Fallback to 0 on error
    }
  }

  /**
   * Normalize matches played using sigmoid smoothing
   */
  normalizeMatchesPlayed(matches) {
    return this.sigmoidNormalize(matches, SimpleRankingService.MAX_MATCHES);
  }

  /**
   * Normalize matches won using sigmoid smoothing
   */
  normalizeMatchesWon(wins) {
    return this.sigmoidNormalize(wins, SimpleRankingService.MAX_WINS);
  }

  /**
   * Normalize lifetime earnings using sigmoid smoothing
   */
  normalizeEarnings(earnings) {
    return this.sigmoidNormalize(earnings, SimpleRankingService.MAX_EARNINGS);
  }

  /**
   * Sigmoid normalization with smoothing to prevent harsh cutoffs
   * Returns value between 0 and 1
   */
  sigmoidNormalize(value, maxThreshold) {
    if (value <= 0) return 0;
    if (maxThreshold <= 0) return 0;

    const ratio = value / maxThreshold;
    // Sigmoid function: 1 / (1 + e^(-5 * (ratio - 0.5)))
    const sigmoid = 1 / (1 + Math.exp(-5 * (ratio - 0.5)));

    return Math.min(1, sigmoid);
  }

  /**
   * Count completed matches for a user (Status = 2)
   */
  async getMatchesPlayed(userId) {
    try {
      const count = await prisma.Match_History.count({
        where: {
          OR: [
            { P1: userId },
            { P2: userId }
          ],
          Status: 2 // Completed matches only
        }
      });
      return count;
    } catch (error) {
      console.error(`Error getting matches played for user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Count wins for a user
   * Win = (P1 with Result=true) OR (P2 with Result=false)
   */
  async getMatchesWon(userId) {
    try {
      const count = await prisma.Match_History.count({
        where: {
          OR: [
            { P1: userId, Result: true },  // User is P1 and won
            { P2: userId, Result: false }  // User is P2 and P1 lost (so P2 won)
          ],
          Status: 2 // Completed matches only
        }
      });
      return count;
    } catch (error) {
      console.error(`Error getting matches won for user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Get lifetime earnings from Users.Earnings field
   */
  async getLifetimeEarnings(userId) {
    try {
      const user = await prisma.Users.findUnique({
        where: { id: userId },
        select: { Earnings: true }
      });
      return user?.Earnings || 0;
    } catch (error) {
      console.error(`Error getting lifetime earnings for user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Update a user's rank score and reassign all rank positions
   * Returns the new rank score
   */
  async updateUserRank(userId) {
    try {
      const score = await this.calculateRankScore(userId);

      // Update the user's RankScore
      await prisma.Users.update({
        where: { id: userId },
        data: { RankScore: score }
      });

      console.log(`Updated rank score for user ${userId}: ${score}`);

      // Reassign all rank positions based on RankScore
      await this.reassignRankPositions();

      return score;
    } catch (error) {
      console.error(`Failed to update rank for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Reassign unique rank positions (1, 2, 3...) based on RankScore
   * Tie-breaker: Lower user ID = earlier registration = higher rank
   */
  async reassignRankPositions() {
    try {
      // Step 1: Clear all existing ranks to avoid unique constraint conflicts
      // Set all ranks to negative values temporarily (userId * -1)
      const allUsers = await prisma.Users.findMany({ select: { id: true } });
      for (const user of allUsers) {
        await prisma.Users.update({
          where: { id: user.id },
          data: { Rank: user.id * -1 } // Temporary negative value
        });
      }

      // Step 2: Get all users sorted by RankScore (DESC), then by id (ASC for tie-breaking)
      const users = await prisma.Users.findMany({
        select: { id: true, RankScore: true },
        orderBy: [
          { RankScore: 'desc' },
          { id: 'asc' } // Tie-breaker: lower ID = earlier registration = higher rank
        ]
      });

      // Step 3: Assign sequential rank positions
      for (let i = 0; i < users.length; i++) {
        const rankPosition = i + 1; // Rank positions start at 1
        await prisma.Users.update({
          where: { id: users[i].id },
          data: { Rank: rankPosition }
        });
      }

      console.log(`Reassigned rank positions for ${users.length} users`);
    } catch (error) {
      console.error('Failed to reassign rank positions:', error);
      throw error;
    }
  }

  /**
   * Backfill Earnings field from historical Match_History data
   * One-time operation to populate Earnings from existing matches
   */
  async backfillEarnings() {
    try {
      console.log('Starting earnings backfill...');
      const users = await prisma.Users.findMany({
        select: { id: true, Username: true }
      });

      let processedCount = 0;
      let totalEarnings = 0;

      for (const user of users) {
        // Find all wins for this user
        const wins = await prisma.Match_History.findMany({
          where: {
            OR: [
              { P1: user.id, Result: true },  // User is P1 and won
              { P2: user.id, Result: false }  // User is P2 and won
            ],
            Status: 2,
            BetAmount: { not: null }
          },
          select: { BetAmount: true }
        });

        // Sum all BetAmounts from wins
        const userEarnings = wins.reduce((sum, match) => {
          return sum + parseFloat(match.BetAmount);
        }, 0);

        // Update Earnings field
        await prisma.Users.update({
          where: { id: user.id },
          data: { Earnings: Math.round(userEarnings) }
        });

        processedCount++;
        totalEarnings += userEarnings;

        if (processedCount % 10 === 0) {
          console.log(`Processed ${processedCount}/${users.length} users...`);
        }
      }

      console.log(`Earnings backfill complete! Processed ${processedCount} users with total earnings: $${(totalEarnings / 100).toFixed(2)}`);
      return { processedCount, totalEarnings };
    } catch (error) {
      console.error('Earnings backfill failed:', error);
      throw error;
    }
  }

  /**
   * Recalculate ranks for all users
   * Batch operation - can be scheduled as a daily job
   */
  async recalculateAllRanks() {
    try {
      console.log('Starting rank recalculation for all users...');
      const users = await prisma.Users.findMany({
        select: { id: true }
      });

      let processedCount = 0;

      // Step 1: Calculate and update RankScore for each user
      for (const user of users) {
        const score = await this.calculateRankScore(user.id);
        await prisma.Users.update({
          where: { id: user.id },
          data: { RankScore: score }
        });
        processedCount++;

        if (processedCount % 10 === 0) {
          console.log(`Calculated rank scores: ${processedCount}/${users.length}...`);
        }
      }

      // Step 2: Reassign rank positions once at the end (more efficient)
      await this.reassignRankPositions();

      console.log(`Rank recalculation complete! Processed ${processedCount} users.`);
      return { processedCount };
    } catch (error) {
      console.error('Rank recalculation failed:', error);
      throw error;
    }
  }

  /**
   * Get detailed rank breakdown for a user
   * Useful for debugging and user profile display
   */
  async getRankBreakdown(userId) {
    try {
      const matchesPlayed = await this.getMatchesPlayed(userId);
      const matchesWon = await this.getMatchesWon(userId);
      const lifetimeEarnings = await this.getLifetimeEarnings(userId);
      const rankScore = await this.calculateRankScore(userId);

      // Get current rank position from database
      const user = await prisma.Users.findUnique({
        where: { id: userId },
        select: { Rank: true, RankScore: true }
      });

      const normalizedPlayed = this.normalizeMatchesPlayed(matchesPlayed);
      const normalizedWon = this.normalizeMatchesWon(matchesWon);
      const normalizedEarnings = this.normalizeEarnings(lifetimeEarnings);

      return {
        userId,
        rank: user?.Rank || 0,           // Position (#1, #2, #3...)
        rankScore: user?.RankScore || 0,  // Performance score (0-1000)
        components: {
          matchesPlayed: {
            value: matchesPlayed,
            normalized: normalizedPlayed,
            weight: SimpleRankingService.WEIGHT_MATCHES_PLAYED,
            contribution: Math.round(normalizedPlayed * SimpleRankingService.WEIGHT_MATCHES_PLAYED * 1000)
          },
          matchesWon: {
            value: matchesWon,
            normalized: normalizedWon,
            weight: SimpleRankingService.WEIGHT_MATCHES_WON,
            contribution: Math.round(normalizedWon * SimpleRankingService.WEIGHT_MATCHES_WON * 1000)
          },
          lifetimeEarnings: {
            value: lifetimeEarnings,
            normalized: normalizedEarnings,
            weight: SimpleRankingService.WEIGHT_EARNINGS,
            contribution: Math.round(normalizedEarnings * SimpleRankingService.WEIGHT_EARNINGS * 1000)
          }
        }
      };
    } catch (error) {
      console.error(`Error getting rank breakdown for user ${userId}:`, error);
      throw error;
    }
  }
}

export default SimpleRankingService;
