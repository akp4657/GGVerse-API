import MatchmakingService from '../services/matchmakingService.js';
import prisma from '../prisma/prisma.js';
const matchmakingService = new MatchmakingService();

// Get match suggestions for a user
export const getMatchSuggestions = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 5, gameId } = req.query;
    const gameIdInt = gameId ? parseInt(gameId) : null;
    
    const suggestions = await matchmakingService.selectTopMatches(parseInt(userId), parseInt(limit), gameIdInt);
    res.json({ success: true, suggestions });
  } catch (error) {
    console.error('Error getting match suggestions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get detailed player data including skill, betting, and rivalry profiles
export const getPlayerData = async (req, res) => {
  try {
    const { userId } = req.params;
    const playerData = await matchmakingService.getPlayerData(parseInt(userId));
    res.json({ success: true, playerData });
  } catch (error) {
    console.error('Error getting player data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update player's MMI score for all games
export const updatePlayerMMI = async (req, res) => {
  try {
    const { userId } = req.params;
    const mmiScores = await matchmakingService.updatePlayerMMI(parseInt(userId));
    res.json({ success: true, mmiScores });
  } catch (error) {
    console.error('Error updating MMI:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update player's MMI score for a specific game
export const updatePlayerMMIForGame = async (req, res) => {
  try {
    const { userId, gameId } = req.params;
    const mmiScore = await matchmakingService.updatePlayerMMIForGame(parseInt(userId), parseInt(gameId));
    res.json({ success: true, mmiScore });
  } catch (error) {
    console.error('Error updating MMI for game:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get player's MMI score for a specific game
export const getPlayerMMIForGame = async (req, res) => {
  try {
    const { userId, gameId } = req.params;
    const mmiScore = await matchmakingService.getPlayerMMIForGame(parseInt(userId), parseInt(gameId));
    res.json({ success: true, mmiScore });
  } catch (error) {
    console.error('Error getting MMI for game:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get player's rivalries with detailed opponent information
export const getPlayerRivalries = async (req, res) => {
  try {
    const { userId } = req.params;
    const { gameId } = req.query;
    const gameIdInt = gameId ? parseInt(gameId) : null;
    const playerData = await matchmakingService.getPlayerData(parseInt(userId), gameIdInt);
    
    // Get rival details
    const rivals = [];
    for (const [opponentId, heatScore] of Object.entries(playerData.rivalryProfile.rivalryHeatScores)) {
      const opponent = await prisma.Users.findUnique({
        where: { id: parseInt(opponentId) },
        select: { id: true, Username: true, Avatar: true, Console: true }
      });
      
      if (opponent) {
        rivals.push({
          ...opponent,
          heatScore,
          matchCount: await matchmakingService.getRivalryMatchCount(parseInt(userId), parseInt(opponentId))
        });
      }
    }
    
    // Sort by heat score
    rivals.sort((a, b) => b.heatScore - a.heatScore);
    
    res.json({ success: true, rivals });
  } catch (error) {
    console.error('Error getting rivalries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get matchmaking statistics for a player
export const getMatchmakingStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const { gameId } = req.query;
    const gameIdInt = gameId ? parseInt(gameId) : null;
    const playerData = await matchmakingService.getPlayerData(parseInt(userId), gameIdInt);
    
    const stats = {
      totalMatches: playerData.skillProfile.totalMatches,
      winRate: playerData.skillProfile.winRate,
      currentStreak: playerData.skillProfile.streak,
      eloRating: playerData.skillProfile.elo,
      avgStakeSize: playerData.bettingProfile.avgStakeSize,
      wagerSuccessRate: playerData.bettingProfile.wagerSuccessRate,
      totalRivals: playerData.rivalryProfile.totalOpponents,
      mmiData: playerData.mmiData,
      allGames: playerData.allGames
    };
    
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error getting matchmaking stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get potential opponents with MMI scores
export const getPotentialOpponents = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 10, gameId } = req.query;
    
    // Get the player's Console to filter opponents by same Console
    const player = await prisma.Users.findUnique({
      where: { id: parseInt(userId) },
      select: { Console: true }
    });

    if (!player) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }
    
    // Get all active players with the same Console except the current player
    const allPlayers = await prisma.Users.findMany({
      where: {
        id: { not: parseInt(userId) },
        Active: true,
        Console: player.Console // Filter by same Console
      },
      select: { id: true, Username: true, Avatar: true, Console: true }
    });

    const potentialOpponents = allPlayers.map(p => p.id.toString());
    const gameIdInt = gameId ? parseInt(gameId) : null;
    const mmiScores = await matchmakingService.calculateMMIScores(parseInt(userId), potentialOpponents, gameIdInt);
    
    // Get game information if gameId is provided
    let gameInfo = null;
    if (gameIdInt) {
      gameInfo = await prisma.Lookup_Game.findUnique({
        where: { id: gameIdInt },
        select: { id: true, Game: true, API: true }
      });
    }
    
    // Add opponent details to MMI results
    const opponentsWithDetails = await Promise.all(
      mmiScores.slice(0, parseInt(limit)).map(async (match) => {
        const opponent = allPlayers.find(p => p.id === match.opponentId);
        return {
          ...match,
          gameType: gameInfo ? gameInfo.Game : null,
          gameId: gameIdInt,
          opponent: {
            id: opponent.id,
            username: opponent.Username,
            avatar: opponent.Avatar,
            console: opponent.Console
          }
        };
      })
    );
    
    res.json({ success: true, opponents: opponentsWithDetails });
  } catch (error) {
    console.error('Error getting potential opponents:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}; 