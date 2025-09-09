import express from 'express';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import * as emailService from './services/emailService.js';
import * as userService from './services/userService.js';
import * as stripeService from './services/stripeService.js';
import * as walletService from './services/walletService.js';
import * as matchmakingController from './controllers/matchmakingController.js';
import * as badgeController from './controllers/badgeController.js';
import * as challengeService from './services/challengeService.js';
import * as discordThreadService from './services/discordThreadService.js';
import * as discordService from './services/discordService.js';
import cors from 'cors';
import jwt from 'jsonwebtoken';
dotenv.config();
const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello world!');
});

app.post('/register', userService.registerUser);
app.get('/verify-email', userService.verifyEmail);
app.post('/login', userService.login);

// POST /validate-token
// Validates if a token is still valid
app.post('/validate-token', userService.authenticateToken, userService.validateToken);

// POST /logout  
// Invalidates the current session
app.post('/logout', userService.authenticateToken, userService.logout);

// User profile endpoints
app.get('/user/profile', userService.authenticateToken, userService.getCurrentUser);
app.put('/user/profile', userService.authenticateToken, userService.updateUserProfile);
app.get('/users', userService.getUsers);
app.get('/users/:id', userService.getUserById);

// Rival management endpoints
app.post('/user/rivals', userService.authenticateToken, userService.addRival);
app.delete('/user/rivals/:rivalId', userService.authenticateToken, userService.removeRival);
app.get('/user/rivals', userService.authenticateToken, userService.getRivals);

// Game management endpoints
app.post('/user/games', userService.authenticateToken, userService.addGame);
app.delete('/user/games/:gameId', userService.authenticateToken, userService.removeGame);
app.get('/user/games', userService.authenticateToken, userService.getGames);
app.get('/games', userService.getAllAvailableGames);

// Stripe endpoints
app.post('/add-funds', stripeService.addFunds);
app.post('/withdraw-funds', stripeService.withdrawFunds);
app.get('/balance', stripeService.getBalance);

// Wallet endpoints
app.get('/wallet/balance/:userId', walletService.getWalletBalance);
app.get('/wallet/transactions/:userId', walletService.getTransactionHistory);

// Matchmaking endpoints
app.get('/matchmaking/suggestions/:userId', matchmakingController.getMatchSuggestions);
app.get('/matchmaking/player-data/:userId', matchmakingController.getPlayerData);
app.post('/matchmaking/update-mmi/:userId', matchmakingController.updatePlayerMMI);
app.get('/matchmaking/rivalries/:userId', matchmakingController.getPlayerRivalries);
app.get('/matchmaking/stats/:userId', matchmakingController.getMatchmakingStats);
app.get('/matchmaking/opponents/:userId', matchmakingController.getPotentialOpponents);

// Badge endpoints
app.post('/badges', badgeController.createBadge);
app.get('/badges', badgeController.getAllBadges);
app.get('/badges/:id', badgeController.getBadgeById);
app.put('/badges/:id', badgeController.updateBadge);
app.delete('/badges/:id', badgeController.deleteBadge);
app.post('/badges/earn', badgeController.earnBadge);

// Challenge endpoints
app.post('/challenges', challengeService.createChallenge);
app.get('/challenges/user/:userId', challengeService.getUserChallenges);
app.get('/challenges/:challengeId', challengeService.getChallengeById);
app.post('/challenges/:challengeId/accept', challengeService.acceptChallenge);
app.post('/challenges/:challengeId/decline', challengeService.declineChallenge);
app.delete('/challenges/:challengeId', challengeService.cancelChallenge);

// Discord thread endpoints
app.post('/api/ggthread', discordThreadService.createDiscordThread);
app.get('/api/ggthread/:challengeId', discordThreadService.getDiscordThreadInfo);
app.put('/api/ggthread/:challengeId/close', discordThreadService.closeDiscordThread);
app.get('/api/ggthread/user/:userId', discordThreadService.getUserDiscordThreads);

// Discord integration endpoints
app.get('/api/user/discord/oauth-url', userService.authenticateToken, discordService.getOAuthUrl);
app.get('/api/user/discord/oauth/callback', discordService.handleOAuthCallback);
app.get('/api/user/discord/status', userService.authenticateToken, discordService.getDiscordStatus);
app.delete('/api/user/discord/unlink', userService.authenticateToken, discordService.unlinkDiscordAccount);

// Email test endpoint (for development/testing)
app.get('/api/test/email', async (req, res) => {
  try {
    const result = await emailService.testEmailConfiguration();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});