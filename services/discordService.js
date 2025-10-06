import prisma from '../prisma/prisma.js';
import jwt from 'jsonwebtoken';
import * as emailService from './emailService.js';

// Discord API configuration
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_SERVER_ID = process.env.DISCORD_SERVER_ID;
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
    console.log('handleOAuthCallback');
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

    console.log('existingUser', existingUser);

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

    console.log('updatedUser', updatedUser);
    // Automatically create Discord server invite and DM user if configured
    if (DISCORD_SERVER_ID) {
      try {
        const inviteResult = await createDiscordServerInviteAndDM(
          DISCORD_SERVER_ID,
          discordId,
          discordUsername
        );
        
        if (inviteResult.success) {
          console.log(`Successfully sent Discord server invite to ${discordUsername}: ${inviteResult.inviteUrl}`);
        } else {
          console.error(`Failed to send Discord server invite:`, inviteResult.error);
          // If DM fails but invite was created, send email instead
          if (inviteResult.inviteUrl) {
            console.log(`Sending Discord invite via email to ${updatedUser.Username}`);
            try {
              await emailService.sendDiscordInviteEmail(
                updatedUser.Email,
                updatedUser.Username,
                inviteResult.inviteUrl
              );
              console.log(`Discord invite email sent successfully to ${updatedUser.Username}`);
            } catch (emailError) {
              console.error(`Failed to send Discord invite email:`, emailError);
            }
          }
        }
      } catch (error) {
        console.error('Error creating Discord server invite and sending DM:', error);
        // Don't fail the OAuth flow if Discord operations fail
      }
    }

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

/**
 * Helper function to create Discord server invite and DM user
 */
const createDiscordServerInviteAndDM = async (guildId, userId, username) => {
  try {
    // Validate required environment variables
    if (!DISCORD_BOT_TOKEN) {
      console.error('Discord bot not configured properly');
      return { success: false, error: 'Discord bot not configured' };
    }

    if (!guildId || !userId) {
      console.error('Missing guild ID or user ID for Discord server invite');
      return { success: false, error: 'Missing required parameters' };
    }

    // First, get a channel from the guild to create the invite
    const guildChannelsResponse = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
      method: 'GET',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!guildChannelsResponse.ok) {
      const errorData = await guildChannelsResponse.json();
      console.error('Failed to fetch guild channels:', errorData);
      return { 
        success: false, 
        error: 'Failed to fetch guild channels',
        details: errorData.message,
        code: errorData.code || 'UNKNOWN_ERROR'
      };
    }

    const channels = await guildChannelsResponse.json();
    // Find the first text channel (type 0) or general channel
    const textChannel = channels.find(channel => 
      channel.type === 0 && 
      (channel.name === 'general' || channel.name === 'bot_testing' || channel.name === 'chat')
    ) || channels.find(channel => channel.type === 0);

    if (!textChannel) {
      console.error('No text channel found in guild');
      return { 
        success: false, 
        error: 'No text channel found in guild to create invite'
      };
    }

    // Create invite link for the Discord server using the channel
    const inviteResponse = await fetch(`${DISCORD_API_BASE}/channels/${textChannel.id}/invites`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        max_age: 0, // Never expires
        max_uses: 1, // Single use
        temporary: false,
        unique: true
      })
    });

    if (!inviteResponse.ok) {
      const errorData = await inviteResponse.json();
      console.error('Discord invite creation failed:', errorData);
      
      // Handle specific Discord API errors
      if (errorData.code === 50013) {
        return { 
          success: false, 
          error: 'Insufficient permissions to create server invite',
          code: 'INSUFFICIENT_PERMISSIONS'
        };
      } else if (errorData.code === 50001) {
        return { 
          success: false, 
          error: 'Guild not found',
          code: 'GUILD_NOT_FOUND'
        };
      } else {
        return { 
          success: false, 
          error: 'Failed to create server invite',
          details: errorData.message,
          code: errorData.code || 'UNKNOWN_ERROR'
        };
      }
    }

    const inviteData = await inviteResponse.json();
    const inviteUrl = `https://discord.gg/${inviteData.code}`;

    // Create DM channel with the user
    const dmResponse = await fetch(`${DISCORD_API_BASE}/users/@me/channels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        recipient_id: userId
      })
    });

    if (!dmResponse.ok) {
      const dmError = await dmResponse.json();
      console.error('Failed to create DM channel:', dmError);
      return { 
        success: false, 
        error: 'Failed to create DM channel',
        details: dmError.message,
        inviteUrl: inviteUrl // Still return the invite URL even if DM fails
      };
    }

    const dmChannel = await dmResponse.json();
    const channelId = dmChannel.id;

    // Send DM with invite link
    const messageResponse = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: `🎮 **Welcome to GGVerse!**\n\nYou've successfully linked your Discord account! To start playing, you **need to join our Discord server**.\n\n**Click here to join:** ${inviteUrl}\n\nOnce you join, you'll be able to participate in challenges, find opponents, and connect with other players!\n\nSee you in the game! 🚀`
      })
    });

    if (!messageResponse.ok) {
      const messageError = await messageResponse.json();
      console.error('Failed to send DM:', messageError);
      return { 
        success: false, 
        error: 'Failed to send DM',
        details: messageError.message,
        inviteUrl: inviteUrl // Still return the invite URL even if DM fails
      };
    }

    console.log(`Successfully sent Discord server invite to user ${username} (${userId})`);
    return { 
      success: true, 
      message: `Discord server invite sent to ${username}`,
      inviteUrl: inviteUrl,
      guildId: guildId,
      userId: userId,
      username: username
    };
    
  } catch (discordError) {
    console.error('Discord API error:', discordError);
    return { 
      success: false, 
      error: 'Failed to create server invite and send DM',
      details: discordError.message
    };
  }
};