import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as emailService from '../services/emailService.js';
import prisma from '../prisma/prisma.js';

// Token blacklist (in production, use Redis or database)
const tokenBlacklist = new Set();

// Authentication middleware
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).send({ error: 'Access token required' });
  }

  // Check if token is blacklisted
  if (tokenBlacklist.has(token)) {
    return res.status(401).send({ error: 'Token has been invalidated' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).send({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Token validation endpoint
export const validateToken = async (req, res) => {
  try {
    // Get user from database to check if they still exist and are authenticated
    const user = await prisma.Users.findUnique({
      where: { id: req.user.userId || req.user.id }
    });

    if (!user) {
      return res.status(401).send({ error: 'User not found' });
    }

    if (!user.Authenticated) {
      return res.status(401).send({ error: 'Email not verified' });
    }

    res.json({ 
      valid: true, 
      user: {
        id: user.id,
        email: user.Email,
        username: user.Username,
        wallet: user.Wallet,
        rank: user.Rank,
        avatar: user.Avatar,
        createdAt: user.created_at,
        updatedAt: user.created_at, // Using created_at since there's no updated_at field
        authenticated: user.Authenticated,
        badges: user.Badges,
        jwt: user.JWT,
        paypalPayerId: user.PayPalPayerId,
        stripePayerId: user.StripePayerId
      }
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).send({ error: 'Token validation failed' });
  }
};

// Logout endpoint
export const logout = async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    // Add token to blacklist
    if (token) {
      tokenBlacklist.add(token);
    }

    // Clear JWT field in database
    await prisma.Users.update({
      where: { id: req.user.userId || req.user.id },
      data: { JWT: null, Online: false }
    });
    
    res.status(200).send({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).send({ error: 'Logout failed' });
  }
};

export const registerUser = async(req, res) => {
    let email = req.body.email;
    let username = req.body.username;
    let password = req.body.password;

    if (!email || !password)
        return res.status(400).send({ error: 'Email and password are required.' });

    // Check if user already exists
    let user = await prisma.Users.findUnique({
        where: {Email: email}
    })
    if(user) {
        return res.status(400).send({error: 'User already exists'})
    }

    try {
        const hashed = await bcrypt.hash(password, 12);
        const userObj = { 
            Username: username || email,
            Email: email,
            Password: hashed,
            Wallet: 0
        };

        const newUser = await prisma.Users.create({data: userObj})

        const token = jwt.sign({ id: newUser.id, email }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN,
        });

        await emailService.sendVerificationEmail(email, token)

        return res.status(200).send({message: "User created"})
    } catch(err) {
        console.log(err)
        return res.status(500).send({message: err.message})
    }
}

export const login = async(req, res) => {
    const email = req.body.email;
    const password = req.body.password;

    if(!email || !password) {
        return res.status(400).send({message: 'Email and password are required'});
    }

    try{
        let user = await prisma.Users.findUnique({
            where: {Email: email}
        })
        // If the user doesn't exist
        if(!user) {
            return res.status(400).send({message: 'Invalid credentials'});
        }

        let passwordMatch = await bcrypt.compare(password, user.Password)
        // If the password is incorrect
        if(!passwordMatch) {
            return res.status(400).send({message: 'Invalid credentials'});
        }

        // Check if email is verified
        if (!user.Authenticated) {
            return res.status(400).send({message: 'Please verify your email before logging in'});
        }

        const token = jwt.sign(
            { userId: user.id, email: user.Email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
        );

        // Store JWT in database
        await prisma.Users.update({
            where: { id: user.id },
            data: { JWT: token, Online: true }
        });

        console.log(user)

        return res.status(200).send({ 
            message: 'Login successful', 
            token, 
            verified: user.Authenticated,
            user: {
                id: user.id,
                email: user.Email,
                username: user.Username,
                wallet: user.Wallet,
                rank: user.Rank,
                avatar: user.Avatar,
                createdAt: user.CreatedAt,
                updatedAt: user.UpdatedAt,
                authenticated: user.Authenticated,
                badges: user.Badges,
                jwt: user.JWT,
                paypalPayerId: user.PayPalPayerId,
                stripePayerId: user.StripePayerId
            }
        });

    } catch(err) {
        console.log(err);
        return res.status(400).send({message: 'Login error'});
    }
}

export const verifyEmail = async(req, res) => {
    const token = req.query.token;

    if(!token) {
        return res.status(500).send({message: 'Missing verification token'});
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        let user = await prisma.Users.update({
            where: {id: decoded.id},
            data: { Authenticated: true, Online: true }
        })

        return res.status(200).send({
          message: "Email verified successfully", 
          token: token, 
          user: {
            id: user.id,
            email: user.Email,
            username: user.Username,
            wallet: user.Wallet,
            rank: user.Rank,
            avatar: user.Avatar,
            createdAt: user.created_at,
            updatedAt: user.created_at, // Using created_at since there's no updated_at field
            authenticated: user.Authenticated,
            badges: user.Badges,
            jwt: user.JWT,
            paypalPayerId: user.PayPalPayerId,
            stripePayerId: user.StripePayerId
          }});
    } catch(err) {
        console.log(err)
        return res.status(500).send({err: "Invalid or expired token"});
    }
}

export const getCurrentUser = async (req, res) => {
  try {
    // The user data is already available from the authenticateToken middleware
    const user = req.user;
    
    if (!user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    // Get full user data from database
    const userData = await prisma.Users.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        Username: true,
        Email: true,
        Wallet: true,
        Rank: true,
        Discord: true,
        Avatar: true,
        Authenticated: true,
        Streak: true,
        Earnings: true,
        WinsLosses: true,
        Badges: true,
        Rivals: true,
        PaymentType: true,
        created_at: true
      }
    });

    if (!userData) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.status(200).send({
      user: {
        ...userData,
        Wallet: userData.Wallet,
        Earnings: userData.Earnings ? userData.Earnings : 0,
        created_at: userData.created_at.toISOString()
      }
    });
  } catch (err) {
    console.error('Error fetching user profile:', err);
    res.status(500).send({ message: 'Failed to fetch user profile' });
  }
};


export const getUsers = async (req, res) => {
  try {
    // Only return id, online, active, and winnings
    const users = await prisma.Users.findMany({
      select: {
        id: true,
        Rank: true,
        Avatar: true,
        Username: true,
        WinsLosses: true,
        Online: true,
        Active: true,
        Earnings: true
      }
    });

    res.status(200).send(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).send({ message: 'Failed to fetch users' });
  }
}

export const updateUserProfile = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).send({ message: 'User not authenticated' });
    }

    const { Username, Discord, Avatar } = req.body;

    // Validate input
    const updateData = {};
    
    if (Username !== undefined) {
      if (typeof Username !== 'string' || Username.trim().length === 0) {
        return res.status(400).send({ message: 'Username must be a non-empty string' });
      }
      updateData.Username = Username.trim();
    }

    if (Discord !== undefined) {
      if (typeof Discord !== 'string') {
        return res.status(400).send({ message: 'Discord must be a string' });
      }
      updateData.Discord = Discord.trim() || null;
    }

    if (Avatar !== undefined) {
      if (typeof Avatar !== 'string') {
        return res.status(400).send({ message: 'Avatar must be a string' });
      }
      updateData.Avatar = Avatar.trim() || null;
    }

    // Update user profile
    const updatedUser = await prisma.Users.update({
      where: { id: user.userId },
      data: updateData,
      select: {
        id: true,
        Username: true,
        Email: true,
        Wallet: true,
        Rank: true,
        Discord: true,
        Avatar: true,
        Authenticated: true,
        Streak: true,
        Earnings: true,
        WinsLosses: true,
        Badges: true,
        Rivals: true,
        PaymentType: true,
        created_at: true
      }
    });

    res.status(200).send({
      user: {
        ...updatedUser,
        Wallet: updatedUser.Wallet,
        Earnings: updatedUser.Earnings ? updatedUser.Earnings : 0,
        Badges: updatedUser.Badges,
        created_at: updatedUser.created_at.toISOString()
      }
    });
  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).send({ message: 'Failed to update user profile' });
  }
};