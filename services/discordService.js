import prisma from '../prisma/prisma.js';
import jwt from 'jsonwebtoken';

// Discord API configuration
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/api/user/discord/oauth/callback';

// In-memory state storage (in production, use Redis or database)
const oauthStates = new Map();

/**
 * Generate OAuth URL for Discord authorization
 */
export const getOAuthUrl = async (req, res) => {
  try {
    if (!DISCORD_CLIENT_ID) {
      return res.status(500).send({ 
        message: 'Discord OAuth not configured' 
      });
    }

    // Generate random state parameter for security
    const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    // Store state with user ID and timestamp (in production, use Redis/database)
    oauthStates.set(state, {
      userId: req.user.userId,
      timestamp: Date.now()
    });

    // Clean up old states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    for (const [key, value] of oauthStates.entries()) {
      if (value.timestamp < tenMinutesAgo) {
        oauthStates.delete(key);
      }
    }

    const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${state}`;
    
    res.json({ 
      oauthUrl, 
      state,
      message: 'OAuth URL generated successfully'
    });

  } catch (error) {
    console.error('Error generating OAuth URL:', error);
    res.status(500).send({ 
      message: 'Failed to generate OAuth URL' 
    });
  }
};

/**
 * Handle OAuth callback from Discord
 */
export const handleOAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || !state) {
      return res.status(400).send({ 
        message: 'Missing authorization code or state parameter' 
      });
    }

    // Verify state parameter
    const stateData = oauthStates.get(state);
    if (!stateData) {
      return res.status(400).send({ 
        message: 'Invalid or expired state parameter' 
      });
    }

    // Clean up used state
    oauthStates.delete(state);

    // Check if state is expired (10 minutes)
    const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
    if (stateData.timestamp < tenMinutesAgo) {
      return res.status(400).send({ 
        message: 'OAuth state expired. Please try again.' 
      });
    }

    const { userId } = stateData;

    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      console.error('Discord token exchange failed:', await tokenResponse.text());
      return res.status(500).send({ 
        message: 'Failed to exchange authorization code for token' 
      });
    }

    const tokenData = await tokenResponse.json();
    const { access_token } = tokenData;

    // Get user info from Discord
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    if (!userResponse.ok) {
      console.error('Discord user info fetch failed:', await userResponse.text());
      return res.status(500).send({ 
        message: 'Failed to fetch Discord user information' 
      });
    }

    const discordUser = await userResponse.json();
    const { id: discordId, username: discordUsername } = discordUser;

    // Check if Discord account is already linked to another user
    const existingUser = await prisma.Users.findFirst({
      where: {
        Discord: discordId,
        id: { not: userId }
      }
    });

    if (existingUser) {
      return res.status(400).send({ 
        message: 'This Discord account is already linked to another user' 
      });
    }

    // Link Discord account to user profile
    const updatedUser = await prisma.Users.update({
      where: { id: userId },
      data: { Discord: discordId },
      select: {
        id: true,
        Username: true,
        Discord: true,
        Avatar: true,
        Gamertag: true
      }
    });

    // Check if request is from mobile device
    const isMobile = req.headers['user-agent']?.includes('Mobile') || 
                     req.headers['user-agent']?.includes('Android') || 
                     req.headers['user-agent']?.includes('iPhone');

    if (isMobile) {
      // For mobile, redirect to custom URL scheme
      const successUrl = `ggverse://discord-oauth?success=true&username=${encodeURIComponent(discordUsername)}`;
      res.redirect(successUrl);
    } else {
      // For web, use existing logic
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const successUrl = `${frontendUrl}/profile?discord=success&username=${encodeURIComponent(discordUsername)}`;
      res.redirect(successUrl);
    }

  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    
    // Check if request is from mobile device
    const isMobile = req.headers['user-agent']?.includes('Mobile') || 
                     req.headers['user-agent']?.includes('Android') || 
                     req.headers['user-agent']?.includes('iPhone');

    if (isMobile) {
      // For mobile, redirect to custom URL scheme
      const errorUrl = `ggverse://discord-oauth?success=false&message=${encodeURIComponent('Failed to link Discord account')}`;
      res.redirect(errorUrl);
    } else {
      // For web, use existing logic
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const errorUrl = `${frontendUrl}/profile?discord=error&message=${encodeURIComponent('Failed to link Discord account')}`;
      res.redirect(errorUrl);
    }
  }
};

/**
 * Get Discord linking status for the current user
 */
export const getDiscordStatus = async (req, res) => {
  try {
    const user = await prisma.Users.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        Username: true,
        Discord: true
      }
    });

    if (!user) {
      return res.status(404).send({ 
        message: 'User not found' 
      });
    }

    // If Discord is linked, try to get additional info from Discord API
    let discordInfo = null;
    if (user.Discord && DISCORD_BOT_TOKEN) {
      try {
        const response = await fetch(`${DISCORD_API_BASE}/users/${user.Discord}`, {
          headers: {
            'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const discordUser = await response.json();
          discordInfo = {
            username: discordUser.username,
            discriminator: discordUser.discriminator,
            avatar: discordUser.avatar,
            verified: discordUser.verified
          };
        }
      } catch (error) {
        console.error('Error fetching Discord user info:', error);
        // Continue without Discord info
      }
    }

    res.status(200).send({
      linked: !!user.Discord,
      verified: !!discordInfo,
      discordId: user.Discord,
      username: user.Username,
      discordInfo
    });

  } catch (error) {
    console.error('Error getting Discord status:', error);
    res.status(500).send({ 
      message: 'Failed to get Discord status' 
    });
  }
};

/**
 * Unlink Discord account from user profile
 */
export const unlinkDiscordAccount = async (req, res) => {
  try {
    const updatedUser = await prisma.Users.update({
      where: { id: req.user.userId },
      data: { Discord: null },
      select: {
        id: true,
        Username: true,
        Discord: true,
        Avatar: true,
        Gamertag: true
      }
    });

    res.status(200).send({
      message: 'Discord account unlinked successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Error unlinking Discord account:', error);
    res.status(500).send({ 
      message: 'Failed to unlink Discord account' 
    });
  }
};
