import prisma from '../prisma/prisma.js';

export class MatchmakingService {
  // Configuration constants
  static MATCH_LIMIT = 20; // Limit matches for performance
  static RECENT_MATCHES = 20; // Recent matches for skill calculation
  static BETTING_MATCHES = 20; // Betting matches for profile calculation

  // Core data collection
  async getPlayerData(playerId, gameId = null) {
    const user = await prisma.Users.findUnique({
      where: { id: playerId }
    });

    if (!user) {
      throw new Error('Player not found');
    }

    // Calculate skill profile (game-specific if gameId provided)
    const skillProfile = await this.calculateSkillProfile(playerId, gameId);
    
    // Calculate betting profile (game-specific if gameId provided)
    const bettingProfile = await this.calculateBettingProfile(playerId, gameId);
    
    // Calculate rivalry profile (game-specific if gameId provided)
    const rivalryProfile = await this.calculateRivalryProfile(playerId, gameId);

    // Get MMI data for the specific game or all games
    let mmiData = null;
    if (gameId) {
      mmiData = await this.getPlayerMMIForGame(playerId, gameId);
    } else {
      // Return all MMI data if no specific game requested
      mmiData = user.MMI || {};
    }

    return { 
      skillProfile, 
      bettingProfile, 
      rivalryProfile, 
      mmiData,
      allGames: user.Games || []
    };
  }

  // Calculate skill profile from match history
  async calculateSkillProfile(playerId, gameId = null) {
    const whereClause = {
      OR: [
        { P1: playerId },
        { P2: playerId }
      ],
      Status: 2 // Completed matches
    };

    // Add game filter if gameId is provided
    if (gameId) {
      whereClause.Game = gameId;
    }

    const recentMatches = await prisma.Match_History.findMany({
      where: whereClause,
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
  async calculateBettingProfile(playerId, gameId = null) {
    const whereClause = {
      OR: [
        { P1: playerId },
        { P2: playerId }
      ],
      BetAmount: { not: null },
      Status: 2
    };

    // Add game filter if gameId is provided
    if (gameId) {
      whereClause.Game = gameId;
    }

    const bettingMatches = await prisma.Match_History.findMany({
      where: whereClause,
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
  async calculateRivalryProfile(playerId, gameId = null) {
    const whereClause = {
      OR: [
        { P1: playerId },
        { P2: playerId }
      ],
      Status: 2
    };

    // Add game filter if gameId is provided
    if (gameId) {
      whereClause.Game = gameId;
    }

    const allMatches = await prisma.Match_History.findMany({
      where: whereClause,
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
    const matches = await prisma.Match_History.findMany({
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
    const recentMatches = await prisma.Match_History.findMany({
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
  async calculateMMIScores(playerId, potentialOpponents, gameId = null) {
    const playerData = await this.getPlayerData(playerId, gameId);
    const MMIResults = [];

    // Get player's MMI for the specific game
    const playerMMI = await this.getPlayerMMIForGame(playerId, gameId || 1);

    for (const opponentId of potentialOpponents) {
      try {
        const opponentData = await this.getPlayerData(parseInt(opponentId), gameId);
        
        // Game Compatibility (0-1) - Check if both players have the game
        const gameCompatibility = await this.calculateGameCompatibility(playerId, parseInt(opponentId), gameId);
        
        // Skill Match (0-1) - Use MMI scores instead of Elo for better game-specific matching
        const opponentMMI = await this.getPlayerMMIForGame(parseInt(opponentId), gameId || 1);
        const mmiDiff = Math.abs(playerMMI - opponentMMI);
        const maxMMIDiff = 1000; // Maximum expected MMI difference
        const skillScore = Math.max(0, 1 - (mmiDiff / maxMMIDiff));

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

        // Weighted MMI - Adjusted weights to include game compatibility and MMI-based skill matching
        const MMI_score = (gameCompatibility * 0.30) + (skillScore * 0.30) + (finalBettingScore * 0.25) + (rivalryScore * 0.15);

        MMIResults.push({
          opponentId: parseInt(opponentId),
          MMI_score,
          playerMMI,
          opponentMMI,
          breakdown: {
            gameCompatibility,
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

  // Calculate game compatibility between two players
  async calculateGameCompatibility(player1Id, player2Id, gameId = null) {
    // If no specific game is requested, check overall game overlap
    if (!gameId) {
      const player1 = await prisma.Users.findUnique({
        where: { id: player1Id },
        select: { Games: true }
      });
      
      const player2 = await prisma.Users.findUnique({
        where: { id: player2Id },
        select: { Games: true }
      });

      if (!player1 || !player2) return 0;

      const player1Games = new Set(player1.Games);
      const player2Games = new Set(player2.Games);
      
      // Calculate Jaccard similarity (intersection over union)
      const intersection = [...player1Games].filter(game => player2Games.has(game));
      const union = [...new Set([...player1Games, ...player2Games])];
      
      return union.length > 0 ? intersection.length / union.length : 0;
    } else {
      // If specific game is requested, check if both players have it
      const player1 = await prisma.Users.findUnique({
        where: { id: player1Id },
        select: { Games: true }
      });
      
      const player2 = await prisma.Users.findUnique({
        where: { id: player2Id },
        select: { Games: true }
      });

      if (!player1 || !player2) return 0;

      const bothHaveGame = player1.Games.includes(gameId) && player2.Games.includes(gameId);
      return bothHaveGame ? 1.0 : 0.0;
    }
  }

  // Calculate volatility bonus for betting compatibility
  calculateVolatilityBonus(player1Betting, player2Betting) {
    const volatilityDiff = Math.abs(player1Betting.stakeVolatility - player2Betting.stakeVolatility);
    const maxVolatilityDiff = 1.0;
    
    // Bonus for similar volatility styles
    return Math.max(0, 0.2 * (1 - volatilityDiff / maxVolatilityDiff));
  }

  // Select top matches for a player
  async selectTopMatches(playerId, limit = 5, gameId = null) {
    // Get the player's Console to filter opponents by same Console
    const player = await prisma.Users.findUnique({
      where: { id: playerId },
      select: { Console: true }
    });

    if (!player) {
      throw new Error('Player not found');
    }

    // Get all active players with the same Console except the current player
    // Only filter by Console if it's not null/undefined
    let allPlayers = [];
    if (player.Console) {
      allPlayers = await prisma.Users.findMany({
        where: {
          id: { not: playerId },
          Active: true,
          Console: player.Console // Filter by same Console
        },
        select: { id: true, Username: true, Avatar: true, Console: true }
      });
    }

    // If no players found with same Console (or Console is null), fall back to all active players
    if (allPlayers.length === 0) {
      allPlayers = await prisma.Users.findMany({
        where: {
          id: { not: playerId },
          Active: true
        },
        select: { id: true, Username: true, Avatar: true, Console: true }
      });
    }

    const potentialOpponents = allPlayers.map(p => p.id.toString());
    const sortedMatches = await this.calculateMMIScores(playerId, potentialOpponents, gameId);
    const topMatches = sortedMatches.slice(0, limit);

    // Get game information if gameId is provided
    let gameInfo = null;
    if (gameId) {
      gameInfo = await prisma.Lookup_Game.findUnique({
        where: { id: gameId },
        select: { id: true, Game: true, API: true }
      });
    }

    // If no ideal matches found, return all players with default MMI scores
    if (topMatches.length === 0) {
      
      // Get player data once for the current player (to avoid repeated calls)
      let playerData = null;
      let playerMMI = 1000;
      try {
        playerData = await this.getPlayerData(playerId, gameId);
        playerMMI = await this.getPlayerMMIForGame(playerId, gameId || 1);
      } catch (error) {
        console.error(`Error getting player data for ${playerId}:`, error);
      }
      
      // Return all players formatted as match suggestions
      // Use Promise.allSettled to handle individual failures gracefully
      const allPlayerMatchesResults = await Promise.allSettled(
        allPlayers.map(async (opponent) => {
          // Calculate basic MMI score for each player
          let mmiScore = 0.5; // Default score
          let breakdown = {
            skillScore: 0.5,
            bettingScore: 0.5,
            rivalryScore: 0.5
          };

          // Try to get actual MMI score if available
          try {
            const opponentData = await this.getPlayerData(opponent.id, gameId);
            
            // Calculate basic compatibility scores
            const gameCompatibility = await this.calculateGameCompatibility(playerId, opponent.id, gameId);
            const opponentMMI = await this.getPlayerMMIForGame(opponent.id, gameId || 1);
            const mmiDiff = Math.abs(playerMMI - opponentMMI);
            const maxMMIDiff = 1000;
            const skillScore = Math.max(0, 1 - (mmiDiff / maxMMIDiff));
            
            const stakeDiff = playerData && opponentData 
              ? Math.abs(playerData.bettingProfile.avgStakeSize - opponentData.bettingProfile.avgStakeSize)
              : 50;
            const maxStakeDiff = 100;
            const bettingScore = Math.max(0, 1 - (stakeDiff / maxStakeDiff));
            
            const rivalryHeat = playerData?.rivalryProfile?.rivalryHeatScores?.[opponent.id] || 0;
            const maxHeat = 10;
            const rivalryScore = Math.min(1, rivalryHeat / maxHeat);
            
            mmiScore = (gameCompatibility * 0.30) + (skillScore * 0.30) + (bettingScore * 0.25) + (rivalryScore * 0.15);
            breakdown = {
              skillScore,
              bettingScore,
              rivalryScore
            };
          } catch (error) {
            console.error(`Error calculating MMI for opponent ${opponent.id}:`, error);
            // Use default scores if calculation fails
          }

          // Get incentives
          let incentives = { bonusXP: 0, bonusCoins: 0 };
          try {
            incentives = await this.calculateIncentives(playerId, opponent.id);
          } catch (error) {
            console.error(`Error calculating incentives for opponent ${opponent.id}:`, error);
          }

          console.log(opponent);
          return {
            opponentId: opponent.id,
            MMI_score: mmiScore,
            breakdown: {
              skillScore: breakdown.skillScore,
              bettingScore: breakdown.bettingScore,
              rivalryScore: breakdown.rivalryScore
            },
            opponent: {
              id: opponent.id,
              username: opponent.Username,
              avatar: opponent.Avatar,
              console: opponent.Console
            },
            gameType: gameInfo ? gameInfo.Game : null,
            gameId: gameId,
            incentives: incentives,
            estimatedBetAmount: 50 // Default bet amount
          };
        })
      );

      // Filter out failed promises and extract successful results
      const allPlayerMatches = allPlayerMatchesResults
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);

      // Sort by MMI score (highest first) and return
      const sortedMatches = allPlayerMatches.sort((a, b) => {
        const aScore = typeof a.MMI_score === 'number' ? a.MMI_score : 0;
        const bScore = typeof b.MMI_score === 'number' ? b.MMI_score : 0;
        return bScore - aScore;
      });
      
      return sortedMatches;
    }

    // Add opponent details and incentives to each match
    for (const match of topMatches) {
      const opponent = allPlayers.find(p => p.id === match.opponentId);
      match.opponent = {
        id: opponent.id,
        username: opponent.Username,
        avatar: opponent.Avatar,
        console: opponent.Console
      };
      match.gameType = gameInfo ? gameInfo.Game : null;
      match.gameId = gameId;
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
    const matches = await prisma.Match_History.count({
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
    const recentMatches = await prisma.Match_History.findMany({
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
    const recentMatches = await prisma.Match_History.findMany({
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

  // Update player's MMI score for all games
  async updatePlayerMMI(playerId) {
    // Get all games the player participates in
    const user = await prisma.Users.findUnique({
      where: { id: playerId },
      select: { Games: true, MMI: true }
    });

    if (!user) {
      throw new Error('Player not found');
    }

    const gameMMI = {};
    
    // Calculate MMI for each game the player has
    for (const gameId of user.Games) {
      const playerData = await this.getPlayerData(playerId, gameId);
      
      // Calculate MMI score for this specific game
      const skillComponent = playerData.skillProfile.winRate * 1000;
      const bettingComponent = playerData.bettingProfile.wagerSuccessRate * 1000;
      const rivalryComponent = Math.min(1000, Object.values(playerData.rivalryProfile.rivalryHeatScores).reduce((sum, heat) => sum + heat, 0));
      
      const gameMMIScore = (skillComponent + bettingComponent + rivalryComponent) / 3;
      gameMMI[gameId.toString()] = gameMMIScore;
    }

    // If no games, set default MMI structure
    if (user.Games.length === 0) {
      gameMMI["1"] = 1000; // Default to game 1 with max MMI
    }

    // Update the player's MMI score (assuming MMI field can store JSON)
    await prisma.Users.update({
      where: { id: playerId },
      data: {
        MMI: gameMMI,
        LastMMIUpdate: new Date()
      }
    });

    return gameMMI;
  }

  // Update player's MMI score for a specific game
  async updatePlayerMMIForGame(playerId, gameId) {
    const playerData = await this.getPlayerData(playerId, gameId);
    
    // Calculate MMI score for this specific game
    const skillComponent = playerData.skillProfile.winRate * 1000;
    const bettingComponent = playerData.bettingProfile.wagerSuccessRate * 1000;
    const rivalryComponent = Math.min(1000, Object.values(playerData.rivalryProfile.rivalryHeatScores).reduce((sum, heat) => sum + heat, 0));
    
    const gameMMIScore = (skillComponent + bettingComponent + rivalryComponent) / 3;

    // Get current MMI data
    const user = await prisma.Users.findUnique({
      where: { id: playerId },
      select: { MMI: true }
    });

    let currentMMI = {};
    if (user.MMI && typeof user.MMI === 'object') {
      currentMMI = user.MMI;
    } else if (typeof user.MMI === 'number') {
      // Migrate from old single MMI format
      currentMMI = { "1": user.MMI };
    }

    // Update the specific game's MMI
    currentMMI[gameId.toString()] = gameMMIScore;

    // Update the player's MMI score
    await prisma.Users.update({
      where: { id: playerId },
      data: {
        MMI: currentMMI,
        LastMMIUpdate: new Date()
      }
    });

    return gameMMIScore;
  }

  // Get player's MMI score for a specific game
  async getPlayerMMIForGame(playerId, gameId) {
    const user = await prisma.Users.findUnique({
      where: { id: playerId },
      select: { MMI: true }
    });

    if (!user) {
      throw new Error('Player not found');
    }

    if (user.MMI && typeof user.MMI === 'object') {
      return user.MMI[gameId.toString()] || 1000; // Default to 1000 if game not found
    } else if (typeof user.MMI === 'number') {
      // Legacy single MMI format - return for game 1, default for others
      return gameId === 1 ? user.MMI : 1000;
    }

    return 1000; // Default MMI
  }
}

export default MatchmakingService; 