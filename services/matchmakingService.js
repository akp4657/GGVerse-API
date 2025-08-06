import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class MatchmakingService {
  // Configuration constants
  static MATCH_LIMIT = 20; // Limit matches for performance
  static RECENT_MATCHES = 20; // Recent matches for skill calculation
  static BETTING_MATCHES = 20; // Betting matches for profile calculation

  // Core data collection
  async getPlayerData(playerId) {
    const user = await prisma.users.findUnique({
      where: { id: playerId }
    });

    if (!user) {
      throw new Error('Player not found');
    }

    // Calculate skill profile
    const skillProfile = await this.calculateSkillProfile(playerId);
    
    // Calculate betting profile
    const bettingProfile = await this.calculateBettingProfile(playerId);
    
    // Calculate rivalry profile
    const rivalryProfile = await this.calculateRivalryProfile(playerId);

    return { skillProfile, bettingProfile, rivalryProfile };
  }

  // Calculate skill profile from match history
  async calculateSkillProfile(playerId) {
    const recentMatches = await prisma.match_History.findMany({
      where: {
        OR: [
          { P1: playerId },
          { P2: playerId }
        ],
        Status: 2 // Completed matches
      },
      orderBy: { created_at: 'desc' },
      take: MatchmakingService.RECENT_MATCHES
    });

    let wins = 0;
    let totalMatches = recentMatches.length;
    
    recentMatches.forEach(match => {
      const isPlayer1 = match.P1 === playerId;
      const playerWon = isPlayer1 ? match.Result : !match.Result;
      if (playerWon) wins++;
    });

    const winRate = totalMatches > 0 ? wins / totalMatches : 0;
    
    // Calculate Elo (simplified version)
    const currentElo = await this.calculateElo(playerId, recentMatches);
    
    // Calculate streak
    const streak = await this.calculateStreak(playerId);

    return {
      winRate,
      elo: currentElo,
      streak,
      totalMatches
    };
  }

  // Calculate betting profile from match history
  async calculateBettingProfile(playerId) {
    const bettingMatches = await prisma.match_History.findMany({
      where: {
        OR: [
          { P1: playerId },
          { P2: playerId }
        ],
        BetAmount: { not: null },
        Status: 2
      },
      orderBy: { created_at: 'desc' },
      take: MatchmakingService.BETTING_MATCHES
    });

    if (bettingMatches.length === 0) {
      return {
        avgStakeSize: 0,
        stakeVolatility: 0,
        wagerSuccessRate: 0
      };
    }

    const stakes = bettingMatches.map(match => parseFloat(match.BetAmount));
    const avgStakeSize = stakes.reduce((sum, stake) => sum + stake, 0) / stakes.length;

    // Calculate volatility (coefficient of variation)
    const variance = stakes.reduce((sum, stake) => sum + Math.pow(stake - avgStakeSize, 2), 0) / stakes.length;
    const stdDev = Math.sqrt(variance);
    const stakeVolatility = avgStakeSize > 0 ? stdDev / avgStakeSize : 0;

    // Calculate wager success rate
    let totalWagered = 0;
    let totalWon = 0;

    bettingMatches.forEach(match => {
      const stake = parseFloat(match.BetAmount);
      const isPlayer1 = match.P1 === playerId;
      const playerWon = isPlayer1 ? match.Result : !match.Result;
      
      totalWagered += stake;
      if (playerWon) {
        totalWon += stake; // Assuming 1:1 payout
      }
    });

    const wagerSuccessRate = totalWagered > 0 ? totalWon / totalWagered : 0;

    return {
      avgStakeSize,
      stakeVolatility,
      wagerSuccessRate
    };
  }

  // Calculate rivalry profile
  async calculateRivalryProfile(playerId) {
    const allMatches = await prisma.match_History.findMany({
      where: {
        OR: [
          { P1: playerId },
          { P2: playerId }
        ],
        Status: 2
      },
      orderBy: { created_at: 'desc' },
      take: MatchmakingService.MATCH_LIMIT
    });

    // Get unique opponents
    const opponents = new Set();
    allMatches.forEach(match => {
      const opponent = match.P1 === playerId ? match.P2 : match.P1;
      if (opponent) opponents.add(opponent);
    });

    const rivalryHeatScores = {};
    
    for (const opponentId of opponents) {
      rivalryHeatScores[opponentId] = await this.calculateRivalryHeat(playerId, opponentId);
    }

    return {
      rivalryHeatScores,
      totalOpponents: opponents.size
    };
  }

  // Calculate rivalry heat between two players
  async calculateRivalryHeat(player1Id, player2Id) {
    const matches = await prisma.match_History.findMany({
      where: {
        OR: [
          { P1: player1Id, P2: player2Id },
          { P1: player2Id, P2: player1Id }
        ],
        Status: 2
      },
      orderBy: { created_at: 'desc' },
      take: MatchmakingService.MATCH_LIMIT
    });

    let heatScore = 0;
    
    matches.forEach((match, index) => {
      // Recency bonus (more recent = higher heat)
      const daysAgo = (Date.now() - match.created_at) / (1000 * 60 * 60 * 24);
      const recencyMultiplier = Math.exp(-daysAgo / 30); // Decay over 30 days
      
      // Stake bonus (higher stakes = higher heat)
      const stakeMultiplier = match.BetAmount ? parseFloat(match.BetAmount) / 100 : 1;
      
      // Frequency bonus (more matches = higher heat)
      const frequencyBonus = Math.min(index * 0.1, 1.0);
      
      heatScore += (recencyMultiplier * stakeMultiplier * (1 + frequencyBonus));
    });

    return heatScore;
  }

  // Calculate Elo rating (simplified)
  async calculateElo(playerId, recentMatches) {
    // Start with base Elo of 1000
    let elo = 1000;
    const kFactor = 32; // How much each match affects rating

    for (let i = recentMatches.length - 1; i >= 0; i--) {
      const match = recentMatches[i];
      const isPlayer1 = match.P1 === playerId;
      const playerWon = isPlayer1 ? match.Result : !match.Result;
      
      // Simplified: assume opponent has same Elo for now
      const expectedScore = 0.5; // 50% chance to win
      const actualScore = playerWon ? 1 : 0;
      
      elo += kFactor * (actualScore - expectedScore);
    }

    return Math.max(elo, 100); // Minimum Elo of 100
  }

  // Calculate current streak
  async calculateStreak(playerId) {
    const recentMatches = await prisma.match_History.findMany({
      where: {
        OR: [
          { P1: playerId },
          { P2: playerId }
        ],
        Status: 2
      },
      orderBy: { created_at: 'desc' },
      take: MatchmakingService.RECENT_MATCHES
    });

    let streak = 0;
    let isWinningStreak = null;

    for (const match of recentMatches) {
      const isPlayer1 = match.P1 === playerId;
      const playerWon = isPlayer1 ? match.Result : !match.Result;
      
      if (isWinningStreak === null) {
        isWinningStreak = playerWon;
        streak = 1;
      } else if (playerWon === isWinningStreak) {
        streak++;
      } else {
        break;
      }
    }

    return isWinningStreak ? streak : -streak;
  }

  // Calculate MMI scores for potential opponents
  async calculateMMIScores(playerId, potentialOpponents) {
    const playerData = await this.getPlayerData(playerId);
    const MMIResults = [];

    for (const opponentId of potentialOpponents) {
      try {
        const opponentData = await this.getPlayerData(parseInt(opponentId));
        
        // Skill Match (0-1)
        const skillDiff = Math.abs(playerData.skillProfile.elo - opponentData.skillProfile.elo);
        const maxEloDiff = 1000; // Maximum expected Elo difference
        const skillScore = Math.max(0, 1 - (skillDiff / maxEloDiff));

        // Betting Compatibility (0-1)
        const stakeDiff = Math.abs(playerData.bettingProfile.avgStakeSize - opponentData.bettingProfile.avgStakeSize);
        const maxStakeDiff = 100; // Maximum expected stake difference
        const bettingScore = Math.max(0, 1 - (stakeDiff / maxStakeDiff));
        
        // Add volatility bonus
        const volatilityBonus = this.calculateVolatilityBonus(playerData.bettingProfile, opponentData.bettingProfile);
        const finalBettingScore = Math.min(1, bettingScore + volatilityBonus);

        // Rivalry Potential (0-1+boost)
        const rivalryHeat = playerData.rivalryProfile.rivalryHeatScores[opponentId] || 0;
        const maxHeat = 10; // Maximum expected heat score
        const rivalryScore = Math.min(1, rivalryHeat / maxHeat);

        // Weighted MMI
        const MMI_score = (skillScore * 0.40) + (finalBettingScore * 0.35) + (rivalryScore * 0.25);

        MMIResults.push({
          opponentId: parseInt(opponentId),
          MMI_score,
          breakdown: {
            skillScore,
            bettingScore: finalBettingScore,
            rivalryScore
          }
        });
      } catch (error) {
        console.error(`Error calculating MMI for opponent ${opponentId}:`, error);
      }
    }

    return MMIResults.sort((a, b) => b.MMI_score - a.MMI_score);
  }

  // Calculate volatility bonus for betting compatibility
  calculateVolatilityBonus(player1Betting, player2Betting) {
    const volatilityDiff = Math.abs(player1Betting.stakeVolatility - player2Betting.stakeVolatility);
    const maxVolatilityDiff = 1.0;
    
    // Bonus for similar volatility styles
    return Math.max(0, 0.2 * (1 - volatilityDiff / maxVolatilityDiff));
  }

  // Select top matches for a player
  async selectTopMatches(playerId, limit = 3) {
    // Get all active players except the current player
    const allPlayers = await prisma.users.findMany({
      where: {
        id: { not: playerId },
        Active: true
      },
      select: { id: true, Username: true, Avatar: true }
    });

    const potentialOpponents = allPlayers.map(p => p.id.toString());
    const sortedMatches = await this.calculateMMIScores(playerId, potentialOpponents);
    const topMatches = sortedMatches.slice(0, limit);

    // Add opponent details and incentives to each match
    for (const match of topMatches) {
      const opponent = allPlayers.find(p => p.id === match.opponentId);
      match.opponent = {
        id: opponent.id,
        username: opponent.Username,
        avatar: opponent.Avatar
      };
      match.incentives = await this.calculateIncentives(playerId, match.opponentId);
    }

    return topMatches;
  }

  // Calculate incentives for rivalry matches
  async calculateIncentives(playerId, opponentId) {
    const rivalryCount = await this.getRivalryMatchCount(playerId, opponentId);
    
    if (rivalryCount === 1) {
      return { bonusXP: 50, bonusCoins: 100 };
    } else if (rivalryCount === 2) {
      return { bonusXP: 100, bonusCoins: 200 };
    } else if (rivalryCount >= 3) {
      return { bonusXP: 150, bonusCoins: 300, specialTitle: "Rival Crusher" };
    } else {
      return { bonusXP: 0, bonusCoins: 0 };
    }
  }

  // Get rivalry match count
  async getRivalryMatchCount(player1Id, player2Id) {
    const matches = await prisma.match_History.count({
      where: {
        OR: [
          { P1: player1Id, P2: player2Id },
          { P1: player2Id, P2: player1Id }
        ],
        Status: 2
      }
    });

    return matches;
  }

  // Apply guardrails to matches
  async applyGuardrails(matches, playerId) {
    return matches.filter(async (match) => {
      // Check for blowouts
      const hasBlowouts = await this.hasMultipleBlowouts(playerId, match.opponentId);
      if (hasBlowouts) return false;

      // Check for too many consecutive matches
      const tooManyConsecutive = await this.tooManyConsecutiveMatches(playerId, match.opponentId);
      if (tooManyConsecutive) return false;

      return true;
    });
  }

  // Check for multiple blowouts
  async hasMultipleBlowouts(player1Id, player2Id) {
    const recentMatches = await prisma.match_History.findMany({
      where: {
        OR: [
          { P1: player1Id, P2: player2Id },
          { P1: player2Id, P2: player1Id }
        ],
        Status: 2
      },
      orderBy: { created_at: 'desc' },
      take: 5
    });

    let blowoutCount = 0;
    const blowoutThreshold = 20; // Point difference threshold

    recentMatches.forEach(match => {
      if (match.PointDiff && match.PointDiff > blowoutThreshold) {
        blowoutCount++;
      }
    });

    return blowoutCount >= 2; // More than 2 blowouts
  }

  // Check for too many consecutive matches
  async tooManyConsecutiveMatches(player1Id, player2Id) {
    const recentMatches = await prisma.match_History.findMany({
      where: {
        OR: [
          { P1: player1Id, P2: player2Id },
          { P1: player2Id, P2: player1Id }
        ],
        Status: 2
      },
      orderBy: { created_at: 'desc' },
      take: 10
    });

    // Check if they've played each other in the last 5 matches
    const consecutiveCount = recentMatches.filter(match => 
      (match.P1 === player1Id && match.P2 === player2Id) ||
      (match.P1 === player2Id && match.P2 === player1Id)
    ).length;

    return consecutiveCount >= 3; // More than 3 consecutive matches
  }

  // Update player's MMI score
  async updatePlayerMMI(playerId) {
    const playerData = await this.getPlayerData(playerId);
    
    // Calculate overall MMI score (average of all components)
    const skillComponent = playerData.skillProfile.winRate * 1000;
    const bettingComponent = playerData.bettingProfile.wagerSuccessRate * 1000;
    const rivalryComponent = Math.min(1000, Object.values(playerData.rivalryProfile.rivalryHeatScores).reduce((sum, heat) => sum + heat, 0));
    
    const overallMMI = (skillComponent + bettingComponent + rivalryComponent) / 3;

    // Update the player's MMI score
    await prisma.users.update({
      where: { id: playerId },
      data: {
        MMI: overallMMI,
        LastMMIUpdate: new Date()
      }
    });

    return overallMMI;
  }
}

export default MatchmakingService; 