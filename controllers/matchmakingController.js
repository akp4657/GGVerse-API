import MatchmakingService from '../services/matchmakingService.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const matchmakingService = new MatchmakingService();

// Get match suggestions for a user
export const getMatchSuggestions = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 3, gameId } = req.query;
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

// Update player's MMI score
export const updatePlayerMMI = async (req, res) => {
  try {
    const { userId } = req.params;
    const mmiScore = await matchmakingService.updatePlayerMMI(parseInt(userId));
    res.json({ success: true, mmiScore });
  } catch (error) {
    console.error('Error updating MMI:', error);
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
      const opponent = await prisma.users.findUnique({
        where: { id: parseInt(opponentId) },
        select: { id: true, Username: true, Avatar: true }
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
      mmiScore: playerData.skillProfile.elo // This will be updated when MMI is calculated
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
    
    // Get all active players except the current player
    const allPlayers = await prisma.users.findMany({
      where: {
        id: { not: parseInt(userId) },
        Active: true
      },
      select: { id: true, Username: true, Avatar: true }
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
            avatar: opponent.Avatar
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