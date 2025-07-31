import express from 'express';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import * as emailService from './services/emailService.js';
import * as userService from './services/userService.js';
import * as stripeService from './services/stripeService.js';
import * as walletService from './services/walletService.js';
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

// Stripe endpoints
app.post('/add-funds', stripeService.addFunds);
app.post('/withdraw-funds', stripeService.withdrawFunds);
app.get('/balance', stripeService.getBalance);

// Wallet endpoints
app.get('/wallet/balance/:userId', walletService.getWalletBalance);
app.get('/wallet/transactions/:userId', walletService.getTransactionHistory);

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});