import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as emailService from '../services/emailService.js';
import * as cloudinaryService from '../services/cloudinaryService.js';
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
      user: user
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

        await emailService.sendVerificationEmail(email, token, username)

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
            //createdAt: user.created_at,
            //updatedAt: user.created_at, // Using created_at since there's no updated_at field
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
        Gamertag: true,
        Authenticated: true,
        Streak: true,
        Earnings: true,
        WinsLosses: true,
        Badges: true,
        Rivals: true,
        PaymentType: true,
        //created_at: true
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
        //created_at: userData.created_at.toISOString()
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
        Gamertag: true,
        WinsLosses: true,
        Streak: true,
        Online: true,
        MMI: true,
        Badges: true,
        Rivals: true,
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

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await prisma.Users.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true,
        Username: true,
        Rank: true,
        Discord: true,
        Avatar: true,
        Gamertag: true,
        WinsLosses: true,
        Streak: true,
        Badges: true,
        Rivals: true,
        Earnings: true,
        MMI: true,
        Online: true,
        Active: true
      }
    });

    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.status(200).send({
      message: 'User fetched successfully',
      success: true,
      user
    });
  } catch (err) {
    console.error('Error fetching user by ID:', err);
    res.status(500).send({ message: 'Failed to fetch user' });
  }
}

export const updateUserProfile = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).send({ message: 'User not authenticated' });
    }

    const { Username, Discord, Avatar, Gamertag } = req.body;

    // Validate input
    const updateData = {};
    
    if (Username !== undefined) {
      if (typeof Username !== 'string' || Username.trim().length === 0) {
        return res.status(400).send({ message: 'Username must be a non-empty string' });
      }
      // Username validation: alphanumeric + underscores, 3-20 characters
      const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
      if (!usernameRegex.test(Username.trim())) {
        return res.status(400).send({ 
          message: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores' 
        });
      }
      updateData.Username = Username.trim();
    }

    if (Gamertag !== undefined) {
      if (typeof Gamertag !== 'string') {
        return res.status(400).send({ message: 'Gamertag must be a string' });
      }
      // Gamertag validation: allow letters, numbers, spaces, hyphens, underscores, 2-20 characters
      const gamertagRegex = /^[a-zA-Z0-9\s\-_]{2,20}$/;
      if (Gamertag.trim() && !gamertagRegex.test(Gamertag.trim())) {
        return res.status(400).send({ 
          message: 'Gamertag must be 2-20 characters long and contain only letters, numbers, spaces, hyphens, and underscores' 
        });
      }
      updateData.Gamertag = Gamertag.trim() || null;
    }

    if (Discord !== undefined) {
      if (typeof Discord !== 'string') {
        return res.status(400).send({ message: 'Discord must be a string' });
      }
      
      // Basic Discord ID format validation
      if (Discord.trim()) {
        const discordIdRegex = /^\d{17,19}$/;
        if (!discordIdRegex.test(Discord.trim())) {
          return res.status(400).send({
            message: 'Discord ID must be a valid 17-19 digit number' 
          });
        }
        updateData.Discord = Discord.trim();
      } else {
        updateData.Discord = null;
      }
    }

    if (Avatar !== undefined) {
      if (typeof Avatar !== 'string') {
        return res.status(400).send({ message: 'Avatar must be a string' });
      }
      // Basic URL validation for avatar
      if (Avatar.trim()) {
        try {
          new URL(Avatar.trim());
          updateData.Avatar = Avatar.trim();
        } catch (error) {
          return res.status(400).send({ message: 'Avatar must be a valid URL' });
        }
      } else {
        updateData.Avatar = null;
      }
    }

    // Check if username is already taken by another user
    if (updateData.Username) {
      const existingUser = await prisma.Users.findFirst({
        where: {
          Username: updateData.Username,
          id: { not: user.userId }
        }
      });
      
      if (existingUser) {
        return res.status(400).send({ message: 'Username is already taken' });
      }
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
        Gamertag: true,
        Authenticated: true,
        Streak: true,
        Earnings: true,
        WinsLosses: true,
        Badges: true,
        Rivals: true,
        PaymentType: true,
      }
    });

    res.status(200).send({
      message: 'Profile updated successfully',
      user: {
        ...updatedUser,
        Wallet: updatedUser.Wallet,
        Earnings: updatedUser.Earnings ? updatedUser.Earnings : 0,
        Badges: updatedUser.Badges
      }
    });
  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).send({ message: 'Failed to update user profile' });
  }
};

// Upload avatar via Cloudinary
export const uploadAvatar = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).send({ message: 'User not authenticated' });
    }

    if (!req.file) {
      return res.status(400).send({ message: 'No file uploaded' });
    }

    // Get current user to check for existing avatar
    const currentUser = await prisma.Users.findUnique({
      where: { id: user.userId },
      select: { Avatar: true }
    });

    // Upload to Cloudinary
    const uploadResult = await cloudinaryService.uploadAvatar(req.file, user.userId);

    // Delete old avatar from Cloudinary if it exists and is a Cloudinary URL
    if (currentUser?.Avatar) {
      await cloudinaryService.deleteAvatar(currentUser.Avatar);
    }

    // Update user's avatar URL in database
    const updatedUser = await prisma.Users.update({
      where: { id: user.userId },
      data: { Avatar: uploadResult.url },
      select: {
        id: true,
        Username: true,
        Email: true,
        Avatar: true,
      }
    });

    res.status(200).send({
      message: 'Avatar uploaded successfully',
      avatar: uploadResult.url,
      user: updatedUser
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    
    // Handle multer errors
    if (error.message && error.message.includes('Invalid file type')) {
      return res.status(400).send({ message: error.message });
    }
    if (error.message && error.message.includes('File size')) {
      return res.status(400).send({ message: error.message });
    }
    
    res.status(500).send({ 
      message: 'Failed to upload avatar',
      error: error.message 
    });
  }
};

// Delete avatar
export const deleteAvatar = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).send({ message: 'User not authenticated' });
    }

    // Get current user's avatar
    const currentUser = await prisma.Users.findUnique({
      where: { id: user.userId },
      select: { Avatar: true }
    });

    if (!currentUser?.Avatar) {
      return res.status(404).send({ message: 'No avatar to delete' });
    }

    // Delete from Cloudinary
    await cloudinaryService.deleteAvatar(currentUser.Avatar);

    // Update user's avatar to null in database
    const updatedUser = await prisma.Users.update({
      where: { id: user.userId },
      data: { Avatar: null },
      select: {
        id: true,
        Username: true,
        Email: true,
        Avatar: true,
      }
    });

    res.status(200).send({
      message: 'Avatar deleted successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error deleting avatar:', error);
    res.status(500).send({ 
      message: 'Failed to delete avatar',
      error: error.message 
    });
  }
};

// Add a rival to user's rivals list
export const addRival = async (req, res) => {
  try {
    const { rivalId } = req.body;
    const userId = req.user.userId || req.user.id;

    // Validate rivalId
    if (!rivalId || isNaN(parseInt(rivalId))) {
      return res.status(400).send({ message: 'Valid rival ID is required' });
    }

    const rivalIdInt = parseInt(rivalId);

    // Check if user is trying to add themselves as rival
    if (userId === rivalIdInt) {
      return res.status(400).send({ message: 'Cannot add yourself as a rival' });
    }

    // Check if rival user exists
    const rivalUser = await prisma.Users.findUnique({
      where: { id: rivalIdInt }
    });

    if (!rivalUser) {
      return res.status(404).send({ message: 'Rival user not found' });
    }

    // Get current user data
    const currentUser = await prisma.Users.findUnique({
      where: { id: userId },
      select: { Rivals: true }
    });

    if (!currentUser) {
      return res.status(404).send({ message: 'User not found' });
    }

    // Check if rival is already in the list
    if (currentUser.Rivals.includes(rivalIdInt)) {
      return res.status(409).send({ message: 'User is already a rival' });
    }

    // Add rival to the array
    const updatedRivals = [...currentUser.Rivals, rivalIdInt];

    await prisma.Users.update({
      where: { id: userId },
      data: { Rivals: updatedRivals }
    });

    res.status(200).send({ 
      message: 'Rival added successfully',
      rivals: updatedRivals
    });
  } catch (err) {
    console.error('Error adding rival:', err);
    res.status(500).send({ message: 'Failed to add rival' });
  }
};

// Remove a rival from user's rivals list
export const removeRival = async (req, res) => {
  try {
    const { rivalId } = req.params;
    const userId = req.user.userId || req.user.id;

    // Validate rivalId
    if (!rivalId || isNaN(parseInt(rivalId))) {
      return res.status(400).send({ message: 'Valid rival ID is required' });
    }

    const rivalIdInt = parseInt(rivalId);

    // Get current user data
    const currentUser = await prisma.Users.findUnique({
      where: { id: userId },
      select: { Rivals: true }
    });

    if (!currentUser) {
      return res.status(404).send({ message: 'User not found' });
    }

    // Check if rival is in the list
    if (!currentUser.Rivals.includes(rivalIdInt)) {
      return res.status(404).send({ message: 'User is not a rival' });
    }

    // Remove rival from the array
    const updatedRivals = currentUser.Rivals.filter(id => id !== rivalIdInt);

    await prisma.Users.update({
      where: { id: userId },
      data: { Rivals: updatedRivals }
    });

    res.status(200).send({ 
      message: 'Rival removed successfully',
      rivals: updatedRivals
    });
  } catch (err) {
    console.error('Error removing rival:', err);
    res.status(500).send({ message: 'Failed to remove rival' });
  }
};

// Get user's rivals with details
export const getRivals = async (req, res) => {
  try {
    const userId = req.user.userId

    // Get user with rivals
    const user = await prisma.Users.findUnique({
      where: { id: userId },
      select: { Rivals: true }
    });

    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    // If no rivals, return empty array
    if (user.Rivals.length === 0) {
      return res.status(200).send({ rivals: [] });
    }

    // Get rival details
    const rivals = await prisma.Users.findMany({
      where: {
        id: { in: user.Rivals }
      },
      select: {
        id: true,
        Username: true,
        Avatar: true,
        Rank: true,
        Gamertag: true,
        Online: true,
        Active: true
      }
    });

    res.status(200).send(rivals);
  } catch (err) {
    console.error('Error getting rivals:', err);
    res.status(500).send({ message: 'Failed to get rivals' });
  }
};

// Add a game to user's games list
export const addGame = async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.userId;

    // Validate gameId
    if (!gameId || isNaN(parseInt(gameId))) {
      return res.status(400).send({ message: 'Valid game ID is required' });
    }

    const gameIdInt = parseInt(gameId);

    // Check if game exists in lookup table
    const game = await prisma.Lookup_Game.findUnique({
      where: { id: gameIdInt }
    });

    if (!game) {
      return res.status(404).send({ message: 'Game not found' });
    }

    // Get current user data
    const currentUser = await prisma.Users.findUnique({
      where: { id: userId },
      select: { Games: true }
    });

    if (!currentUser) {
      return res.status(404).send({ message: 'User not found' });
    }

    // Check if game is already in the list
    if (currentUser.Games.includes(gameIdInt)) {
      return res.status(409).send({ message: 'Game is already in your list' });
    }

    // Add game to the array
    const updatedGames = [...currentUser.Games, gameIdInt];

    await prisma.Users.update({
      where: { id: userId },
      data: { Games: updatedGames }
    });

    res.status(200).send({ 
      message: 'Game added successfully',
      games: updatedGames
    });
  } catch (err) {
    console.error('Error adding game:', err);
    res.status(500).send({ message: 'Failed to add game' });
  }
};

// Remove a game from user's games list
export const removeGame = async (req, res) => {
  try {
    const { gameId } = req.params;
    const userId = req.user.userId;

    // Validate gameId
    if (!gameId || isNaN(parseInt(gameId))) {
      return res.status(400).send({ message: 'Valid game ID is required' });
    }

    const gameIdInt = parseInt(gameId);

    // Get current user data
    const currentUser = await prisma.Users.findUnique({
      where: { id: userId },
      select: { Games: true }
    });

    if (!currentUser) {
      return res.status(404).send({ message: 'User not found' });
    }

    // Check if game is in the list
    if (!currentUser.Games.includes(gameIdInt)) {
      return res.status(404).send({ message: 'Game is not in your list' });
    }

    // Remove game from the array
    const updatedGames = currentUser.Games.filter(id => id !== gameIdInt);

    await prisma.Users.update({
      where: { id: userId },
      data: { Games: updatedGames }
    });

    res.status(200).send({ 
      message: 'Game removed successfully',
      games: updatedGames
    });
  } catch (err) {
    console.error('Error removing game:', err);
    res.status(500).send({ message: 'Failed to remove game' });
  }
};

// Get user's games with details
export const getGames = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user with games
    const user = await prisma.Users.findUnique({
      where: { id: userId },
      select: { Games: true }
    });

    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    // If no games, return empty array
    if (user.Games.length === 0) {
      return res.status(200).send([]);
    }

    // Get game details from lookup table
    const games = await prisma.Lookup_Game.findMany({
      where: {
        id: { in: user.Games }
      },
      select: {
        id: true,
        Game: true,
        API: true
      }
    });

    res.status(200).send(games);
  } catch (err) {
    console.error('Error getting games:', err);
    res.status(500).send({ message: 'Failed to get games' });
  }
};

// Get all available games from lookup table
export const getAllAvailableGames = async (req, res) => {
  try {
    const games = await prisma.Lookup_Game.findMany({
      select: {
        id: true,
        Game: true,
        API: true
      },
      orderBy: {
        Game: 'asc'
      }
    });

    res.status(200).send(games);
  } catch (err) {
    console.error('Error getting available games:', err);
    res.status(500).send({ message: 'Failed to get available games' });
  }
};