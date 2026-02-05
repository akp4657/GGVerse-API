import { SimpleRankingService } from '../services/simpleRankingService.js';

/**
 * Backfill Earnings field from historical match data
 * Admin endpoint - should be run once after deployment
 * POST /api/admin/backfill-earnings
 */
export const backfillEarnings = async (req, res) => {
  try {
    console.log('Backfill earnings request received');
    const service = new SimpleRankingService();
    const result = await service.backfillEarnings();

    res.status(200).json({
      success: true,
      message: 'Earnings backfilled successfully',
      data: {
        usersProcessed: result.processedCount,
        totalEarnings: result.totalEarnings
      }
    });
  } catch (error) {
    console.error('Backfill earnings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to backfill earnings',
      message: error.message
    });
  }
};

/**
 * Recalculate ranks for all users
 * Admin endpoint - can be run manually or scheduled daily
 * POST /api/admin/recalculate-ranks
 */
export const recalculateAllRanks = async (req, res) => {
  try {
    console.log('Recalculate all ranks request received');
    const service = new SimpleRankingService();
    const result = await service.recalculateAllRanks();

    res.status(200).json({
      success: true,
      message: 'All ranks recalculated successfully',
      data: {
        usersProcessed: result.processedCount
      }
    });
  } catch (error) {
    console.error('Recalculate ranks error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to recalculate ranks',
      message: error.message
    });
  }
};

/**
 * Get detailed rank breakdown for a specific user
 * Public endpoint - shows rank components and contributions
 * GET /api/ranking/user/:userId
 */
export const getUserRankDetails = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId || isNaN(parseInt(userId))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }

    const service = new SimpleRankingService();
    const breakdown = await service.getRankBreakdown(parseInt(userId));

    res.status(200).json({
      success: true,
      data: breakdown
    });
  } catch (error) {
    console.error('Get rank details error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get rank details',
      message: error.message
    });
  }
};
