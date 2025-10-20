import { PrismaClient } from '@prisma/client';
import * as challengeService from './challengeService.js';

const prisma = new PrismaClient();

/**
 * Create a Discord thread for an accepted challenge
 * This endpoint will be called by ther Discord bot when both players accept a challenge
 */
export const createDiscordThread = async (req, res) => {
  try {
    const { challengeId, threadId, threadUrl } = req.body;

    // Validate required fields
    if (!challengeId || !threadId) {
      console.log('Missing required fields: challengeId, threadId');
      return res.status(400).json({ 
        error: 'Missing required fields: challengeId, threadId' 
      });
    }

    // Find the challenge
    const challenge = await prisma.challenges.findUnique({
      where: { id: parseInt(challengeId) },
      include: {
        Challenger: true,
        Challenged: true
      }
    });

    if (!challenge) {
      console.log('Challenge not found');
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Update the challenge with Discord thread information
    const updatedChallenge = await challengeService.updateChallengeWithDiscordThread(
      parseInt(challengeId),
      threadId,
      threadUrl
    );

    // Create a Discord thread record in the existing Discord_Threads table
    const discordThread = await prisma.discord_Threads.create({
      data: {
        ThreadId: threadId,
        Members: [challenge.ChallengerId, challenge.ChallengedId],
        Open: true,
        Dispute: false
      }
    });

    res.status(201).send({
      message: 'Discord thread created successfully',
      success: true,
      challenge: updatedChallenge,
      discordThread
    });

  } catch (error) {
    console.error('Error creating Discord thread:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get Discord thread information for a challenge
 */
export const getDiscordThreadInfo = async (req, res) => {
  try {
    const { challengeId } = req.params;

    const challenge = await prisma.challenges.findUnique({
      where: { id: parseInt(challengeId) },
      select: {
        id: true,
        DiscordThreadId: true,
        DiscordThreadUrl: true,
        Status: true,
        Challenger: {
          select: {
            id: true,
            Username: true,
            Discord: true
          }
        },
        Challenged: {
          select: {
            id: true,
            Username: true,
            Discord: true
          }
        }
      }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    if (!challenge.DiscordThreadId) {
      return res.status(404).json({ error: 'No Discord thread found for this challenge' });
    }

    res.status(200).send({
      message: 'Discord thread info fetched successfully',
      success: true,
      challenge
    });

  } catch (error) {
    console.error('Error fetching Discord thread info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Close a Discord thread (mark as closed)
 */
export const closeDiscordThread = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { userId } = req.body;

    const challenge = await prisma.challenges.findUnique({
      where: { id: parseInt(challengeId) },
      include: {
        Challenger: true,
        Challenged: true
      }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Verify the user is part of the challenge
    if (challenge.ChallengerId !== parseInt(userId) && challenge.ChallengedId !== parseInt(userId)) {
      return res.status(403).json({ error: 'Not authorized to close this thread' });
    }

    if (!challenge.DiscordThreadId) {
      return res.status(404).json({ error: 'No Discord thread found for this challenge' });
    }

    // Update the Discord thread to closed
    await prisma.discord_Threads.updateMany({
      where: { ThreadId: challenge.DiscordThreadId },
      data: { Open: false }
    });

    res.status(200).send({
      message: 'Discord thread closed successfully',
      success: true
    });

  } catch (error) {
    console.error('Error closing Discord thread:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all Discord threads for a user
 */
export const getUserDiscordThreads = async (req, res) => {
  try {
    const { userId } = req.params;

    // Get all challenges for the user that have Discord threads
    const challenges = await prisma.challenges.findMany({
      where: {
        OR: [
          { ChallengerId: parseInt(userId) },
          { ChallengedId: parseInt(userId) }
        ],
        DiscordThreadId: { not: null }
      },
      include: {
        Challenger: {
          select: {
            id: true,
            Username: true,
            Avatar: true
          }
        },
        Challenged: {
          select: {
            id: true,
            Username: true,
            Avatar: true
          }
        }
      },
      orderBy: {
        CreatedAt: 'desc'
      }
    });

    res.status(200).send({
      message: 'User Discord threads fetched successfully',
      success: true,
      challenges
    });

  } catch (error) {
    console.error('Error fetching user Discord threads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
