import prisma from '../prisma/prisma.js';
import * as pushNotificationService from './pushNotificationService.js';

/**
 * Create a new challenge
 */
export const createChallenge = async (req, res) => {
  try {
    const { challengerId, challengedId, game, console, wager } = req.body;

    // Validate required fields
    if (!challengerId || !game || !wager) {
      return res.status(400).json({ 
        error: 'Missing required fields: challengerId, game, wager' 
      });
    }

    // Check if challenger exists
    const challenger = await prisma.Users.findUnique({ 
      where: { id: challengerId },
      select: {
        id: true,
        Username: true,
        Avatar: true,
        MMI: true,
        PushToken: true
      }
    });

    if (!challenger) {
      return res.status(404).json({ error: 'Challenger not found' });
    }

    // Determine challenge status and validate challengedId
    let status = 'pending';
    let challenged = null;
    
    if (challengedId) {
      // Traditional challenge with specific opponent
      challenged = await prisma.Users.findUnique({ 
        where: { id: challengedId },
        select: {
          id: true,
          Username: true,
          Avatar: true,
          MMI: true,
          PushToken: true
        }
      });

      if (!challenged) {
        return res.status(404).json({ error: 'Challenged user not found' });
      }

      // Prevent self-challenge
      if (challengerId === challengedId) {
        return res.status(400).json({ error: 'Cannot challenge yourself' });
      }

      // Check if there's already a pending challenge between these users
      const existingChallenge = await prisma.Challenges.findFirst({
        where: {
          OR: [
            {
              ChallengerId: challengerId,
              ChallengedId: challengedId,
              Status: 'pending'
            },
            {
              ChallengerId: challengedId,
              ChallengedId: challengerId,
              Status: 'pending'
            }
          ]
        }
      });

      if (existingChallenge) {
        return res.status(409).json({ 
          error: 'A pending challenge already exists between these users' 
        });
      }
    } else {
      // Open challenge - no specific opponent
      status = 'open';
    }

    // Set expiration to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const challenge = await prisma.Challenges.create({
      data: {
        ChallengerId: challengerId,
        ChallengedId: challengedId || null,
        Game: game,
        Console: console || null,
        Wager: parseFloat(wager),
        ExpiresAt: expiresAt,
        Status: status
      },
      include: {
        Users_Challenges_ChallengerIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        },
        Users_Challenges_ChallengedIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        }
      }
    });

    // Send push notification to challenged user (only if not an open challenge)
    if (challenged && challenged.PushToken) {
      try {
        await pushNotificationService.sendChallengeNotification(
          challenged.PushToken,
          challenger.Username || 'Someone',
          {
            id: challenge.id,
            challengerId: challenge.ChallengerId,
            game: challenge.Game,
            wager: challenge.Wager,
          }
        );
      } catch (notificationError) {
        // Don't fail challenge creation if notification fails
        console.error('Error sending push notification for challenge:', notificationError);
      }
    }

    res.status(201).send({
      message: 'Challenge created successfully',
      success: true,
      challenge
    });

  } catch (error) {
    console.error('Error creating challenge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all challenges for a user (as challenger or challenged)
 */
export const getUserChallenges = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    let whereClause = {
      OR: [
        { ChallengerId: parseInt(userId) },
        { ChallengedId: parseInt(userId) }
      ]
    };

    // Filter by status if provided
    if (status && ['pending', 'accepted', 'declined', 'expired'].includes(status)) {
      whereClause.Status = status;
    }

    const challenges = await prisma.Challenges.findMany({
      where: whereClause, 
      include: {
        Users_Challenges_ChallengerIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        },
        Users_Challenges_ChallengedIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        }
      },
      orderBy: {
        CreatedAt: 'desc'
      }
    });

    res.status(200).send({
      message: 'Challenges fetched successfully',
      success: true,
      challenges
    });

  } catch (error) {
    console.error('Error fetching user challenges:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all open challenges
 */
export const getOpenChallenges = async (req, res) => {
  try {
    const { game } = req.query;

    let whereClause = {
      Status: 'open',
      ChallengedId: null
    };

    // Filter by game if provided
    if (game) {
      whereClause.Game = game;
    }

    // Exclude expired challenges
    whereClause.ExpiresAt = {
      gt: new Date()
    };

    const challenges = await prisma.Challenges.findMany({
      where: whereClause,
      include: {
        Users_Challenges_ChallengerIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        }
      },
      orderBy: [
        { Game: 'asc' },
        { CreatedAt: 'desc' }
      ]
    });

    res.status(200).send({
      message: 'Open challenges fetched successfully',
      success: true,
      challenges
    });

  } catch (error) {
    console.error('Error fetching open challenges:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Accept a challenge
 */
export const acceptChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { userId } = req.body;

    const challenge = await prisma.Challenges.findUnique({
      where: { id: parseInt(challengeId) },
      include: {
        Users_Challenges_ChallengerIdToUsers: true,
        Users_Challenges_ChallengedIdToUsers: true
      }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Check if challenge has expired
    if (new Date() > challenge.ExpiresAt) {
      await prisma.Challenges.update({
        where: { id: parseInt(challengeId) },
        data: { Status: 'expired' }
      });
      return res.status(400).json({ error: 'Challenge has expired' });
    }

    // Handle open challenges vs regular challenges
    if (challenge.Status === 'open') {
      // Open challenge: any user can accept (except the challenger)
      if (challenge.ChallengerId === parseInt(userId)) {
        return res.status(400).json({ error: 'Cannot accept your own open challenge' });
      }

      // Get the challenged user info for notifications
      const challengedUser = await prisma.Users.findUnique({
        where: { id: parseInt(userId) },
        select: {
          id: true,
          Username: true,
          Avatar: true,
          MMI: true,
          PushToken: true
        }
      });

      if (!challengedUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update challenge: set ChallengedId and change status directly to accepted
      // This treats it the same as accepting from ChallengeScreen
      const updatedChallenge = await prisma.Challenges.update({
        where: { id: parseInt(challengeId) },
        data: { 
          ChallengedId: parseInt(userId),
          Status: 'accepted'
        },
        include: {
          Users_Challenges_ChallengerIdToUsers: {
            select: {
              id: true,
              Username: true,
              Avatar: true,
              MMI: true,
              PushToken: true
            }
          },
          Users_Challenges_ChallengedIdToUsers: {
            select: {
              id: true,
              Username: true,
              Avatar: true,
              MMI: true,
              PushToken: true
            }
          }
        }
      });

      // Send push notification to challenger (same as regular challenge acceptance)
      try {
        if (updatedChallenge.Users_Challenges_ChallengerIdToUsers.PushToken) {
          await pushNotificationService.sendChallengeAcceptedNotification(
            updatedChallenge.Users_Challenges_ChallengerIdToUsers.PushToken,
            updatedChallenge.Users_Challenges_ChallengedIdToUsers?.Username || 'Your opponent',
            {
              id: updatedChallenge.id,
              challengedId: updatedChallenge.ChallengedId,
            }
          );
        }
      } catch (notificationError) {
        // Don't fail challenge acceptance if notification fails
        console.error('Error sending push notification for challenge acceptance:', notificationError);
      }

      res.status(200).send({
        message: 'Challenge accepted successfully',
        success: true,
        challenge: updatedChallenge
      });
    } else if (challenge.Status === 'pending') {
      // Regular challenge: verify the user is the challenged player
      if (challenge.ChallengedId !== parseInt(userId)) {
        return res.status(403).json({ error: 'Only the challenged player can accept this challenge' });
      }

      // Update challenge status to accepted
      const updatedChallenge = await prisma.Challenges.update({
        where: { id: parseInt(challengeId) },
        data: { Status: 'accepted' },
        include: {
          Users_Challenges_ChallengerIdToUsers: {
            select: {
              id: true,
              Username: true,
              Avatar: true,
              MMI: true,
              PushToken: true
            }
          },
          Users_Challenges_ChallengedIdToUsers: {
            select: {
              id: true,
              Username: true,
              Avatar: true,
              MMI: true,
              PushToken: true
            }
          }
        }
      });

      // Send push notification to challenger
      try {
        if (updatedChallenge.Users_Challenges_ChallengerIdToUsers.PushToken) {
          await pushNotificationService.sendChallengeAcceptedNotification(
            updatedChallenge.Users_Challenges_ChallengerIdToUsers.PushToken,
            updatedChallenge.Users_Challenges_ChallengedIdToUsers.Username || 'Your opponent',
            {
              id: updatedChallenge.id,
              challengedId: updatedChallenge.ChallengedId,
            }
          );
        }
      } catch (notificationError) {
        // Don't fail challenge acceptance if notification fails
        console.error('Error sending push notification for challenge acceptance:', notificationError);
      }

      res.status(200).send({
        message: 'Challenge accepted successfully',
        success: true,
        challenge: updatedChallenge
      });
    } else {
      return res.status(400).json({ error: 'Challenge is not open or pending' });
    }

  } catch (error) {
    console.error('Error accepting challenge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Decline a challenge
 */
export const declineChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { userId } = req.body;

    const challenge = await prisma.Challenges.findUnique({
      where: { id: parseInt(challengeId) }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Verify the user is the challenged player
    if (challenge.ChallengedId !== parseInt(userId)) {
      return res.status(403).json({ error: 'Only the challenged player can decline this challenge' });
    }

    if (challenge.Status !== 'pending') {
      return res.status(400).json({ error: 'Challenge is not pending' });
    }

    // Get challenger info for notification
    const challenger = await prisma.Users.findUnique({
      where: { id: challenge.ChallengerId },
      select: { PushToken: true, Username: true }
    });

    // Update challenge status to declined
    const updatedChallenge = await prisma.Challenges.update({
      where: { id: parseInt(challengeId) },
      data: { Status: 'declined' },
      include: {
        Users_Challenges_ChallengerIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        },
        Users_Challenges_ChallengedIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        }
      }
    });

    // Send push notification to challenger
    try {
      if (challenger && challenger.PushToken) {
        await pushNotificationService.sendChallengeDeclinedNotification(
          challenger.PushToken,
          updatedChallenge.Users_Challenges_ChallengedIdToUsers.Username || 'Your opponent',
          {
            id: updatedChallenge.id,
            challengedId: updatedChallenge.ChallengedId,
          }
        );
      }
    } catch (notificationError) {
      // Don't fail challenge decline if notification fails
      console.error('Error sending push notification for challenge decline:', notificationError);
    }

    res.status(200).send({
      message: 'Challenge declined successfully',
      success: true,
      challenge: updatedChallenge
    });

  } catch (error) {
    console.error('Error declining challenge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update challenge with Discord thread information
 */
export const updateChallengeWithDiscordThread = async (challengeId, threadId, threadUrl) => {
  try {
    const updatedChallenge = await prisma.Challenges.update({
      where: { id: challengeId },
      data: {
        DiscordThreadId: threadId,
        DiscordThreadUrl: threadUrl || null
      }
    });

    return updatedChallenge;
  } catch (error) {
    console.error('Error updating challenge with Discord thread:', error);
    throw error;
  }
};

/**
 * Get challenge by ID
 */
export const getChallengeById = async (req, res) => {
  try {
    const { challengeId } = req.params;

    const challenge = await prisma.Challenges.findUnique({
      where: { id: parseInt(challengeId) },
      include: {
        Users_Challenges_ChallengerIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        },
        Users_Challenges_ChallengedIdToUsers: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        }
      }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    res.status(200).send({
      message: 'Challenge fetched successfully',
      success: true,
      challenge
    });

  } catch (error) {
    console.error('Error fetching challenge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Cancel a challenge (only challenger can cancel)
 */
export const cancelChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { userId } = req.body;

    const challenge = await prisma.Challenges.findUnique({
      where: { id: parseInt(challengeId) }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Verify the user is the challenger
    if (challenge.ChallengerId !== parseInt(userId)) {
      return res.status(403).json({ error: 'Only the challenger can cancel this challenge' });
    }

    if (challenge.Status !== 'pending') {
      return res.status(400).json({ error: 'Challenge is not pending' });
    }

    // Delete the challenge
    await prisma.Challenges.delete({
      where: { id: parseInt(challengeId) }
    });

    res.status(200).send({
      message: 'Challenge cancelled successfully',
      success: true
    });

  } catch (error) {
    console.error('Error cancelling challenge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
