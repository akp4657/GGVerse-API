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
        PushToken: true,
        Discord: true,
        Wallet: true
      }
    });

    if (!challenger) {
      return res.status(404).json({ error: 'Challenger not found' });
    }

    // Validate Discord ID is linked
    if (!challenger.Discord) {
      return res.status(400).json({
        error: 'Please link your Discord ID with GGVerse before creating a match'
      });
    }

    // Validate wallet has sufficient balance for wager
    if (challenger.Wallet < wager) {
      return res.status(400).json({
        error: 'Insufficient Balance. Please credit into your account to increase your wager limit'
      });
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

    const wagerAmount = parseFloat(wager);

    // Create challenge and deduct wallet in a transaction to ensure atomicity
    const challenge = await prisma.$transaction(async (tx) => {
      // Create the challenge
      const newChallenge = await tx.Challenges.create({
        data: {
          ChallengerId: challengerId,
          ChallengedId: challengedId || null,
          Game: game,
          Console: console || null,
          Wager: wagerAmount,
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

      // Deduct wager from challenger when challenge is created
      await tx.Users.update({
        where: { id: challengerId },
        data: { Wallet: { decrement: wagerAmount } }
      });

      return newChallenge;
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
 * Note: Open challenges are excluded - they should only appear in marketplace
 */
export const getUserChallenges = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.query;

    let whereClause = {
      OR: [
        { ChallengerId: parseInt(userId) },
        { ChallengedId: parseInt(userId) }
      ],
      // Exclude open challenges - they should only appear in marketplace
      Status: { not: 'open' }
    };

    // Filter by status if provided (but still exclude 'open')
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
        },
        // Include pending requests for challenges where user is challenger
        // Note: Only for non-open challenges that have requests
        Challenge_Requests: {
          where: {
            Status: 'request'
          },
          include: {
            Users: {
              select: {
                id: true,
                Username: true,
                Avatar: true,
                MMI: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      },
      orderBy: {
        CreatedAt: 'desc'
      }
    });

    // Get open challenges where user is challenger to show their pending requests
    // These are returned separately so frontend can display requests for open challenges
    const openChallengesWithRequests = await prisma.Challenges.findMany({
      where: {
        ChallengerId: parseInt(userId),
        Status: 'open'
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
        Challenge_Requests: {
          where: {
            Status: 'request'
          },
          include: {
            Users: {
              select: {
                id: true,
                Username: true,
                Avatar: true,
                MMI: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        }
      },
      orderBy: {
        CreatedAt: 'desc'
      }
    });

    // Also get requests where user created the request (ChallengerId in Challenge_Requests is the person creating the request)
    // Include both pending ('request') and declined requests so users can see their declined requests
    const userRequests = await prisma.Challenge_Requests.findMany({
      where: {
        ChallengerId: parseInt(userId), // Person who created the request
        //Status: 'request'
      },
      include: {
        Challenges: {
          include: {
            Users_Challenges_ChallengerIdToUsers: {
              select: {
                id: true,
                Username: true,
                Avatar: true,
                MMI: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.status(200).send({
      message: 'Challenges fetched successfully',
      success: true,
      challenges,
      openChallengesWithRequests, // Open challenges with requests (for displaying requests to challenger)
      requests: userRequests // Requests where user created the request
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
    const { userId, wager, requestId } = req.body;

    // Validate required fields
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const challenge = await prisma.Challenges.findUnique({
      where: { id: parseInt(challengeId) },
      include: {
        Users_Challenges_ChallengerIdToUsers: {
          select: {
            id: true,
            Username: true,
            Wallet: true
          }
        },
        Users_Challenges_ChallengedIdToUsers: {
          select: {
            id: true,
            Username: true,
            Wallet: true
          }
        }
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
      // If requestId is provided, challenger is accepting a specific request
      if (requestId) {
        // Challenger accepting a specific request for an open challenge
        if (challenge.ChallengerId !== parseInt(userId)) {
          return res.status(403).json({ error: 'Only the challenger can accept requests for this challenge' });
        }

        // Find the request
        const challengeRequest = await prisma.Challenge_Requests.findFirst({
          where: {
            id: parseInt(requestId),
            ChallengeId: parseInt(challengeId),
            Status: 'request'
          },
          include: {
            Users: {
              select: {
                id: true,
                Username: true,
                Avatar: true,
                MMI: true,
                PushToken: true,
                Discord: true,
                Wallet: true
              }
            }
          }
        });

        if (!challengeRequest) {
          return res.status(404).json({ error: 'Request not found or already processed' });
        }

        if (!challengeRequest.Users) {
          return res.status(404).json({ error: 'User associated with request not found' });
        }

        // Wager is stored in dollars
        const requestWager = challengeRequest.Wager;
        const originalWager = challenge.Wager;
        
        // Note: Wallet validation and deduction already happened when the request was created
        // No need to check again here

        // Adjust original challenger's wallet based on wager difference
        // If final wager is more than original, challenger pays the difference
        // If final wager is less than original, challenger gets a refund
        if (requestWager !== originalWager) {
          const wagerDifference = requestWager - originalWager;
          
          // Get challenger's current wallet to validate they can pay if needed
          const challenger = await prisma.Users.findUnique({
            where: { id: challenge.ChallengerId },
            select: { Wallet: true }
          });

          if (wagerDifference > 0) {
            // Final wager is higher - challenger needs to pay the difference
            if (challenger.Wallet < wagerDifference) {
              return res.status(400).json({
                error: 'Insufficient balance. You need additional funds to accept this wager amount.'
              });
            }
            // Deduct the difference from challenger
            await prisma.Users.update({
              where: { id: challenge.ChallengerId },
              data: { Wallet: { decrement: wagerDifference } }
            });
          } else {
            // Final wager is lower - challenger gets a refund
            await prisma.Users.update({
              where: { id: challenge.ChallengerId },
              data: { Wallet: { increment: Math.abs(wagerDifference) } }
            });
          }
        }

        // Update selected request to accepted
        await prisma.Challenge_Requests.update({
          where: { id: parseInt(requestId) },
          data: { Status: 'accepted' }
        });

        // Deny all other requests for this challenge (set to 'denied' so they can still be tracked)
        const deniedRequests = await prisma.Challenge_Requests.findMany({
          where: {
            ChallengeId: parseInt(challengeId),
            id: { not: parseInt(requestId) },
            Status: 'request'
          },
          include: {
            Users: {
              select: {
                id: true,
                Username: true,
                PushToken: true
              }
            }
          }
        });

        // Update all other requests to 'denied' status
        await prisma.Challenge_Requests.updateMany({
          where: {
            ChallengeId: parseInt(challengeId),
            id: { not: parseInt(requestId) },
            Status: 'request'
          },
          data: { Status: 'declined' }
        });

        // Update ChallengeRequests array - remove all request IDs since challenge is now accepted
        // The challenge is no longer open, so we clear the requests array
        await prisma.Challenges.update({
          where: { id: parseInt(challengeId) },
          data: {
            ChallengeRequests: []
          }
        });

        // Update challenge: set ChallengedId, Status, and Wager
        // ChallengerId in Challenge_Requests is the person who created the request (Player B)
        // This becomes the ChallengedId in the Challenges table
        const updatedChallenge = await prisma.Challenges.update({
          where: { id: parseInt(challengeId) },
          data: {
            ChallengedId: challengeRequest.ChallengerId, // Person who created the request (Player B)
            Status: 'accepted',
            Wager: requestWager
          },
          include: {
            Users_Challenges_ChallengerIdToUsers: {
              select: {
                id: true,
                Username: true,
                Avatar: true,
                MMI: true,
                PushToken: true,
                Discord: true
              }
            },
            Users_Challenges_ChallengedIdToUsers: {
              select: {
                id: true,
                Username: true,
                Avatar: true,
                MMI: true,
                PushToken: true,
                Discord: true
              }
            }
          }
        });

        // Send notifications to users whose requests were denied
        try {
          for (const deniedRequest of deniedRequests) {
            if (deniedRequest.Users?.PushToken) {
              await pushNotificationService.sendChallengeDeclinedNotification(
                deniedRequest.Users.PushToken,
                updatedChallenge.Users_Challenges_ChallengerIdToUsers.Username || 'Your opponent',
                {
                  id: updatedChallenge.id,
                  challengerId: updatedChallenge.ChallengerId,
                }
              );
            }
          }
        } catch (notificationError) {
          console.error('Error sending push notifications for declined requests:', notificationError);
        }

        // Discord thread will be created by frontend when it detects status is 'accepted'

        // Send push notification to challenged user
        try {
          if (challengeRequest.Users?.PushToken) {
            await pushNotificationService.sendChallengeAcceptedNotification(
              challengeRequest.Users.PushToken,
              updatedChallenge.Users_Challenges_ChallengerIdToUsers.Username || 'Your opponent',
              {
                id: updatedChallenge.id,
                challengerId: updatedChallenge.ChallengerId,
              }
            );
          }
        } catch (notificationError) {
          console.error('Error sending push notification for challenge acceptance:', notificationError);
        }

        return res.status(200).send({
          message: 'Challenge request sent successfully',
          success: true,
          challenge: updatedChallenge
        });
      }

      // Open challenge: any user can accept (except the challenger) - creates a request
      if (challenge.ChallengerId === parseInt(userId)) {
        return res.status(400).json({ error: 'Cannot accept your own open challenge' });
      }

      // Get the challenged user info for notifications and wallet validation
      const challengedUser = await prisma.Users.findUnique({
        where: { id: parseInt(userId) },
        select: {
          id: true,
          Username: true,
          Avatar: true,
          MMI: true,
          PushToken: true,
          Wallet: true
        }
      });

      if (!challengedUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Check if user already has a pending request for this challenge
      const existingRequest = await prisma.Challenge_Requests.findFirst({
        where: {
          ChallengeId: parseInt(challengeId),
          ChallengerId: parseInt(userId),
          Status: 'request'
        }
      });

      if (existingRequest) {
        return res.status(409).json({ error: 'You already have a pending request for this challenge' });
      }

      // Validate wager if provided
      let finalWager = challenge.Wager;
      if (wager !== undefined && wager !== null) {
        const wagerAmount = parseFloat(wager);
        if (isNaN(wagerAmount) || wagerAmount <= 0) {
          return res.status(400).json({ error: 'Invalid wager amount' });
        }
        // Validate challenged user has sufficient wallet balance
        if (challengedUser.Wallet < wagerAmount) {
          return res.status(400).json({
            error: 'Insufficient Balance. Please credit into your account to increase your wager limit'
          });
        }
        finalWager = wagerAmount;
      } else {
        finalWager = parseFloat(challenge.Wager);
        // Validate challenged user has sufficient wallet balance for default wager
        if (challengedUser.Wallet < finalWager) {
          return res.status(400).json({
            error: 'Insufficient Balance. Please credit into your account to increase your wager limit'
          });
        }
      }

      // Deduct wager from challenged user when they create a request for an open challenge
      // Challenger already paid when creating the challenge
      await prisma.Users.update({
        where: { id: parseInt(userId) },
        data: { Wallet: { decrement: finalWager } }
      });

      // Create a new ChallengeRequest instead of updating the challenge
      // Challenge stays 'open' and ChallengedId remains null
      // ChallengerId in Challenge_Requests is the person creating the request (Player B)
      const challengeRequest = await prisma.Challenge_Requests.create({
        data: {
          ChallengeId: parseInt(challengeId),
          ChallengerId: parseInt(userId), // Person creating the request (Player B)
          Wager: Math.round(finalWager), // Store as dollars (Int)
          Status: 'request'
        },
        include: {
          Users: {
            select: {
              id: true,
              Username: true,
              Avatar: true,
              MMI: true,
              PushToken: true
            }
          },
          Challenges: {
            include: {
              Users_Challenges_ChallengerIdToUsers: {
                select: {
                  id: true,
                  Username: true,
                  Avatar: true,
                  MMI: true,
                  PushToken: true
                }
              }
            }
          }
        }
      });

      // Update the ChallengeRequests array on the Challenges table to include the new request ID
      // Get current challenge to access existing ChallengeRequests array
      const currentChallenge = await prisma.Challenges.findUnique({
        where: { id: parseInt(challengeId) },
        select: { ChallengeRequests: true }
      });

      // Add the new request ID to the ChallengeRequests array
      const updatedRequestIds = [...(currentChallenge?.ChallengeRequests || []), challengeRequest.id];
      
      await prisma.Challenges.update({
        where: { id: parseInt(challengeId) },
        data: {
          ChallengeRequests: updatedRequestIds
        }
      });

      // Send push notification to challenger that challenge has been requested
      try {
        if (challengeRequest.Challenges.Users_Challenges_ChallengerIdToUsers.PushToken) {
          await pushNotificationService.sendChallengeAcceptedNotification(
            challengeRequest.Challenges.Users_Challenges_ChallengerIdToUsers.PushToken,
            challengeRequest.Users?.Username || 'Your opponent',
            {
              id: challengeRequest.Challenges.id,
              challengedId: challengeRequest.ChallengerId,
            }
          );
        }
      } catch (notificationError) {
        // Don't fail challenge acceptance if notification fails
        console.error('Error sending push notification for challenge acceptance:', notificationError);
      }

      res.status(200).send({
        message: 'Challenge requested successfully',
        success: true,
        request: challengeRequest,
        challenge: challengeRequest.Challenges // Return challenge from the request relation
      });
    } else if (challenge.Status === 'pending') {
      // Regular challenge: verify the user is the challenged player
      if (challenge.ChallengedId !== parseInt(userId)) {
        return res.status(403).json({ error: 'Only the challenged player can accept this challenge' });
      }

      // Get challenged user info for wallet validation if wager is being updated
      const challengedUser = await prisma.Users.findUnique({
        where: { id: parseInt(userId) },
        select: { Wallet: true }
      });

      // Validate wager if provided
      let finalWager = challenge.Wager;
      if (wager !== undefined && wager !== null) {
        const wagerAmount = parseFloat(wager);
        if (isNaN(wagerAmount) || wagerAmount <= 0) {
          return res.status(400).json({ error: 'Invalid wager amount' });
        }
        // Validate challenged user has sufficient wallet balance
        if (challengedUser && challengedUser.Wallet < wagerAmount) {
          return res.status(400).json({
            error: 'Insufficient Balance. Please credit into your account to increase your wager limit'
          });
        }
        finalWager = wagerAmount;
      } else {
        // Validate challenged user has sufficient wallet balance for default wager
        if (challengedUser && challengedUser.Wallet < challenge.Wager) {
          return res.status(400).json({
            error: 'Insufficient Balance. Please credit into your account to increase your wager limit'
          });
        }
      }

      // Note: Wallet deduction does NOT happen for pending challenges
      // Both users' wallets were already deducted when the challenge was created

      // Update challenge status to accepted, and wager if modified
      const updateData = { Status: 'accepted' };
      if (wager !== undefined && wager !== null && parseFloat(wager) !== challenge.Wager) {
        updateData.Wager = finalWager;
      }
      const updatedChallenge = await prisma.Challenges.update({
        where: { id: parseInt(challengeId) },
        data: updateData,
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
 * Get all requests for a specific challenge
 */
export const getChallengeRequests = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { status } = req.query;

    const challenge = await prisma.Challenges.findUnique({
      where: { id: parseInt(challengeId) }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    let whereClause = {
      ChallengeId: parseInt(challengeId)
    };

    // Filter by status if provided
    if (status && ['request', 'accepted', 'declined'].includes(status)) {
      whereClause.Status = status;
    }

    const requests = await prisma.Challenge_Requests.findMany({
      where: whereClause,
      include: {
        Users: {
          select: {
            id: true,
            Username: true,
            Avatar: true,
            MMI: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.status(200).send({
      message: 'Challenge requests fetched successfully',
      success: true,
      requests
    });

  } catch (error) {
    console.error('Error fetching challenge requests:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Decline a challenge or request
 */
export const declineChallenge = async (req, res) => {
  try {
    const { challengeId } = req.params;
    const { userId, requestId } = req.body;

    const challenge = await prisma.Challenges.findUnique({
      where: { id: parseInt(challengeId) }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // If requestId is provided, decline a specific request
    if (requestId) {
      const challengeRequest = await prisma.Challenge_Requests.findFirst({
        where: {
          id: parseInt(requestId),
          ChallengeId: parseInt(challengeId),
          Status: 'request'
        },
        include: {
          Users: {
            select: {
              id: true,
              Username: true,
              PushToken: true
            }
          },
          Challenges: {
            include: {
              Users_Challenges_ChallengerIdToUsers: {
                select: {
                  id: true,
                  Username: true,
                  PushToken: true
                }
              }
            }
          }
        }
      });

      if (!challengeRequest) {
        return res.status(404).json({ error: 'Request not found or already processed' });
      }

      // Check if user is the original challenger (declining someone's request) or the person who created the request (declining own request)
      // challengeRequest.Challenges.ChallengerId = original challenger (Player A who posted in marketplace)
      // challengeRequest.ChallengerId = person who created the request (Player B)
      const isOriginalChallenger = challengeRequest.Challenges.ChallengerId === parseInt(userId);
      const isRequestCreator = challengeRequest.ChallengerId === parseInt(userId);

      if (!isOriginalChallenger && !isRequestCreator) {
        return res.status(403).json({ error: 'You do not have permission to decline this request' });
      }

      // Refund Player B's wager when request is declined
      // Player B's wallet was deducted when they created the request, so they need a refund
      // This applies whether Player A declines the request OR Player B declines their own request
      const requestWager = challengeRequest.Wager;
      await prisma.Users.update({
        where: { id: challengeRequest.ChallengerId }, // Player B who created the request
        data: { Wallet: { increment: requestWager } }
      });

      // Update request status to declined
      await prisma.Challenge_Requests.update({
        where: { id: parseInt(requestId) },
        data: { Status: 'declined' }
      });

      // Remove the request ID from the ChallengeRequests array
      const currentChallenge = await prisma.Challenges.findUnique({
        where: { id: parseInt(challengeId) },
        select: { ChallengeRequests: true }
      });

      if (currentChallenge?.ChallengeRequests) {
        const updatedRequestIds = currentChallenge.ChallengeRequests.filter(id => id !== parseInt(requestId));
        await prisma.Challenges.update({
          where: { id: parseInt(challengeId) },
          data: {
            ChallengeRequests: updatedRequestIds
          }
        });
      }

      // Send notification
      try {
        if (isOriginalChallenger && challengeRequest.Users?.PushToken) {
          // Original challenger (Player A) declined the request - notify request creator (Player B)
          await pushNotificationService.sendChallengeDeclinedNotification(
            challengeRequest.Users.PushToken,
            challengeRequest.Challenges.Users_Challenges_ChallengerIdToUsers.Username || 'Your opponent',
            {
              id: challengeRequest.Challenges.id,
              challengerId: challengeRequest.Challenges.ChallengerId,
            }
          );
        } else if (isRequestCreator && challengeRequest.Challenges.Users_Challenges_ChallengerIdToUsers.PushToken) {
          // Request creator (Player B) declined their own request - notify original challenger (Player A)
          await pushNotificationService.sendChallengeDeclinedNotification(
            challengeRequest.Challenges.Users_Challenges_ChallengerIdToUsers.PushToken,
            challengeRequest.Users?.Username || 'Your opponent',
            {
              id: challengeRequest.Challenges.id,
              challengedId: challengeRequest.ChallengerId,
            }
          );
        }
      } catch (notificationError) {
        console.error('Error sending push notification for request decline:', notificationError);
      }

      return res.status(200).send({
        message: 'Request declined successfully',
        success: true
      });
    }

    // Regular challenge decline (non-open challenges)
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
        },
        // Include requests if challenge is open
        Challenge_Requests: {
          include: {
            Users: {
              select: {
                id: true,
                Username: true,
                Avatar: true,
                MMI: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
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
    const userId = req.user?.id || req.body?.userId; // Get from token or fallback to body

    const challenge = await prisma.Challenges.findUnique({
      where: { id: parseInt(challengeId) },
      include: {
        Challenge_Requests: {
          where: {
            Status: { in: ['request', 'pending'] } // Only refund active requests
          }
        }
      }
    });

    if (!challenge) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Verify the user is the challenger
    if (challenge.ChallengerId !== parseInt(userId)) {
      return res.status(403).json({ error: 'Only the challenger can cancel this challenge' });
    }

    // Allow canceling open or pending challenges
    if (challenge.Status !== 'pending' && challenge.Status !== 'open') {
      return res.status(400).json({ error: 'Challenge cannot be cancelled in its current state' });
    }

    // Refund challenger's wager
    await prisma.Users.update({
      where: { id: challenge.ChallengerId },
      data: { Wallet: { increment: challenge.Wager } }
    });

    // If it's an open challenge, refund all pending requests and mark them as cancelled
    if (challenge.Status === 'open' && challenge.Challenge_Requests && challenge.Challenge_Requests.length > 0) {
      // Refund each request creator's wager
      for (const request of challenge.Challenge_Requests) {
        if (request.Status === 'request' || request.Status === 'pending') {
          // Refund the request creator's wager
          await prisma.Users.update({
            where: { id: request.ChallengerId },
            data: { Wallet: { increment: request.Wager } }
          });

          // Mark request as cancelled/declined
          await prisma.Challenge_Requests.update({
            where: { id: request.id },
            data: { Status: 'declined' }
          });
        }
      }
    }

    // Delete all associated requests
    await prisma.Challenge_Requests.deleteMany({
      where: { ChallengeId: parseInt(challengeId) }
    });

    // Delete the challenge
    await prisma.Challenges.delete({
      where: { id: parseInt(challengeId) }
    });

    res.status(200).send({
      message: 'Challenge cancelled successfully. Wager refunded and all requests cancelled.',
      success: true
    });

  } catch (error) {
    console.error('Error cancelling challenge:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
