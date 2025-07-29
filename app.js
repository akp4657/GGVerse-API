import express from 'express';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import * as emailService from './services/emailService.js';
import * as userService from './services/userService.js';
import * as stripeService from './services/stripeService.js';
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

app.get('/users', async (req, res) => {
  try {
    console.log('Called')
    const users = await prisma.Users.findMany(); // Model name matches Prisma schema
    res.status(200).send(users)
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/add-funds', stripeService.addFunds);
app.post('/withdraw-funds', stripeService.withdrawFunds);
app.get('/balance', stripeService.getBalance);

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});