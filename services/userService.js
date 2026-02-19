import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as emailService from '../services/emailService.js';
import * as cloudinaryService from '../services/cloudinaryService.js';
import prisma from '../prisma/prisma.js';
import { SimpleRankingService } from './simpleRankingService.js';

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
      where: { id: req.user.id }
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
    // Handle database connection errors
    if (error.code === 'P1001') {
      return res.status(503).send({ error: 'Database temporarily unavailable. Please try again.' });
    }
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
      where: { id: req.user.id },
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
    let referralCode = req.body.referralCode != null ? String(req.body.referralCode).trim() : '';
    const clientIP = req.clientIP;

    if (!email || !password)
        return res.status(400).send({ error: 'Email and password are required.' });

    if (!referralCode)
        return res.status(400).send({ error: 'Referral code is required.' });

    const referrer = await prisma.ReferralCode.findFirst({
        where: { Code: referralCode },
        select: { UserId: true }
    });
    if (!referrer || referrer.UserId == null)
        return res.status(400).send({ error: 'Invalid or expired referral code.' });

    // Check if user already exists
    let user = await prisma.Users.findUnique({
        where: {Email: email}
    })
    if(user) {
        return res.status(400).send({error: 'User already exists'})
    }

    // Check if IP already exists (prevent duplicate accounts from same IP)
    if (clientIP) {
        const existingUserWithIP = await prisma.Users.findFirst({
            where: { ip: clientIP }
        });
        if (existingUserWithIP) {
            return res.status(400).send({ error: 'An account with this IP address already exists.' });
        }
    }

    try {
        const hashed = await bcrypt.hash(password, 12);

        const userObj = {
            Username: username || email,
            Email: email,
            Password: hashed,
            Wallet: 20,
            Rank: 0,        // Will be assigned position after rank calculation
            RankScore: 0,   // Performance score (0-1000)
            Earnings: 0,    // Initialize lifetime earnings
            Authenticated: true,
            ReferredBy: referrer.UserId,
            ip: clientIP || null
        };

        const newUser = await prisma.Users.create({data: userObj})

        // Calculate initial rank (will be 0 for new user with no matches)
        try {
            const rankingService = new SimpleRankingService();
            await rankingService.updateUserRank(newUser.id);
        } catch (rankError) {
            console.error('Error updating rank for new user:', rankError);
            // Don't fail registration if rank update fails
        }

        const token = jwt.sign({ id: newUser.id, email }, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN,
        });

        await prisma.Users.update({
            where: { id: newUser.id },
            data: { JWT: token, Online: true }
        });

        //await emailService.sendVerificationEmail(email, token, username)

        // Temporarily sending direct token
        return res.status(200).send({
          message: "User created",
          token: token,
          user: {
            id: newUser.id,
            Email: newUser.Email,
            Username: newUser.Username,
            Wallet: newUser.Wallet,
            Rank: newUser.Rank,
            Avatar: newUser.Avatar,
            Authenticated: newUser.Authenticated,
            Badges: newUser.Badges || [],
            JWT: token,
          }
        })
    } catch(err) {
        console.log(err)
        return res.status(500).send({message: err.message})
    }
}

/** Read-only: return the current user's referral code if they have one (codes are created manually, no CRUD). */
export const getReferralCode = async (req, res) => {
    try {
        const userId = req.user?.id ?? req.user?.userId;
        if (!userId)
            return res.status(401).send({ error: 'Access token required' });

        const row = await prisma.ReferralCode.findFirst({
            where: { UserId: parseInt(userId, 10) },
            select: { Code: true }
        });

        if (!row || row.Code == null)
            return res.status(404).send({ error: 'No referral code assigned' });

        return res.status(200).send({ code: row.Code });
    } catch (err) {
        console.error('getReferralCode error:', err);
        return res.status(500).send({ error: 'Failed to get referral code' });
    }
};

export const decodePassword = async(req, res) => {
    const password = req.body.password;
    try {
        const decoded = jwt.verify(password, process.env.JWT_SECRET);
        return res.status(200).send({ decoded });
    } catch(err) {
        return res.status(400).send({message: 'Invalid password'});
    }
}

export const login = async(req, res) => {
    const email = req.body.email;
    const password = req.body.password;
    const clientIP = req.clientIP;

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
            { id: user.id, email: user.Email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
        );

        // Prepare update data - only update IP if it's null/empty (set once on first login)
        const updateData = {
            JWT: token,
            Online: true
        };
        
        // Only set IP if it doesn't exist yet (first login only)
        if (clientIP && (!user.ip || user.ip === null || user.ip === '')) {
            updateData.ip = clientIP;
        }

        // Store JWT in database and update IP if needed
        await prisma.Users.update({
            where: { id: user.id },
            data: updateData
        });

        return res.status(200).send({ 
            message: 'Login successful', 
            token, 
            verified: user.Authenticated,
            user: {
                id: user.id,
                Email: user.Email,
                Username: user.Username,
                Wallet: user.Wallet,
                Rank: user.Rank,
                Avatar: user.Avatar,
                Authenticated: user.Authenticated,
                Badges: user.Badges,
                JWT: user.JWT,
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
            Email: user.Email,
            Username: user.Username,
            Wallet: user.Wallet,
            Rank: user.Rank,
            Avatar: user.Avatar,
            //createdAt: user.created_at,
            //updatedAt: user.created_at, // Using created_at since there's no updated_at field
            Authenticated: user.Authenticated,
            Badges: user.Badges,
            JWT: user.JWT,
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
      where: { id: user.id },
      select: {
        id: true,
        Username: true,
        Email: true,
        Wallet: true,
        Rank: true,
        Discord: true,
        Avatar: true,
        Gamertag: true,
        Console: true,
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
        id: userData.id,
        Username: userData.Username,
        Email: userData.Email,
        Wallet: userData.Wallet,
        Rank: userData.Rank,
        Discord: userData.Discord,
        Avatar: userData.Avatar,
        Gamertag: userData.Gamertag,
        Console: userData.Console,
        Authenticated: userData.Authenticated,
        Streak: userData.Streak,
        Earnings: userData.Earnings ? userData.Earnings : 0,
        WinsLosses: userData.WinsLosses,
        Badges: userData.Badges,
        Rivals: userData.Rivals,
        PaymentType: userData.PaymentType,
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
    const period = req.query.period; // 'month' or undefined (all-time)

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

    const userIds = users.map(u => u.id);

    // For monthly period, compute current month date range
    let dateFilter = {};
    if (period === 'month') {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      dateFilter = { created_at: { gte: monthStart, lt: monthEnd } };
    }

    // Batch queries: wins and total matches per user (with optional date filter)
    const batchQueries = [
      prisma.Match_History.groupBy({
        by: ['P1'],
        where: { P1: { in: userIds }, Result: true, Status: 2, ...dateFilter },
        _count: { id: true }
      }),
      prisma.Match_History.groupBy({
        by: ['P2'],
        where: { P2: { in: userIds }, Result: false, Status: 2, ...dateFilter },
        _count: { id: true }
      }),
      prisma.Match_History.groupBy({
        by: ['P1'],
        where: { P1: { in: userIds }, Status: 2, ...dateFilter },
        _count: { id: true }
      }),
      prisma.Match_History.groupBy({
        by: ['P2'],
        where: { P2: { in: userIds }, Status: 2, ...dateFilter },
        _count: { id: true }
      }),
    ];

    // For monthly period, also sum earnings from wins
    if (period === 'month') {
      batchQueries.push(
        prisma.Match_History.groupBy({
          by: ['P1'],
          where: { P1: { in: userIds }, Result: true, Status: 2, ...dateFilter },
          _sum: { BetAmount: true }
        }),
        prisma.Match_History.groupBy({
          by: ['P2'],
          where: { P2: { in: userIds }, Result: false, Status: 2, ...dateFilter },
          _sum: { BetAmount: true }
        })
      );
    }

    const results = await Promise.all(batchQueries);
    const [winsAsP1, winsAsP2, matchesAsP1, matchesAsP2] = results;
    const earningsAsP1 = results[4] ?? [];
    const earningsAsP2 = results[5] ?? [];

    // Build stats map: userId -> { wins, totalMatches, earnings }
    const statsMap = {};
    for (const u of users) {
      statsMap[u.id] = { wins: 0, totalMatches: 0, earnings: 0 };
    }
    for (const row of winsAsP1) {
      if (row.P1 !== null && statsMap[row.P1] !== undefined) {
        statsMap[row.P1].wins += row._count.id;
      }
    }
    for (const row of winsAsP2) {
      if (row.P2 !== null && statsMap[row.P2] !== undefined) {
        statsMap[row.P2].wins += row._count.id;
      }
    }
    for (const row of matchesAsP1) {
      if (row.P1 !== null && statsMap[row.P1] !== undefined) {
        statsMap[row.P1].totalMatches += row._count.id;
      }
    }
    for (const row of matchesAsP2) {
      if (row.P2 !== null && statsMap[row.P2] !== undefined) {
        statsMap[row.P2].totalMatches += row._count.id;
      }
    }

    let usersWithStats;

    if (period === 'month') {
      // Accumulate monthly earnings
      for (const row of earningsAsP1) {
        if (row.P1 !== null && statsMap[row.P1] !== undefined) {
          statsMap[row.P1].earnings += Number(row._sum.BetAmount) || 0;
        }
      }
      for (const row of earningsAsP2) {
        if (row.P2 !== null && statsMap[row.P2] !== undefined) {
          statsMap[row.P2].earnings += Number(row._sum.BetAmount) || 0;
        }
      }

      // Attach monthly stats
      usersWithStats = users.map(u => ({
        ...u,
        wins: statsMap[u.id].wins,
        totalMatches: statsMap[u.id].totalMatches,
        Earnings: statsMap[u.id].earnings,
      }));

      // Compute monthly rank using same weighted formula as all-time ranking.
      // Normalize each metric relative to the top performer this month.
      const maxMatches = Math.max(...usersWithStats.map(u => u.totalMatches), 1);
      const maxWins    = Math.max(...usersWithStats.map(u => u.wins), 1);
      const maxEarnings = Math.max(...usersWithStats.map(u => u.Earnings), 1);

      usersWithStats = usersWithStats.map(u => ({
        ...u,
        _monthlyScore: (
          (u.totalMatches / maxMatches) * 0.50 +
          (u.wins        / maxWins)     * 0.30 +
          (u.Earnings    / maxEarnings) * 0.20
        ) * 1000,
      }));

      // Sort by score DESC, tiebreak by id ASC, assign monthly rank positions
      usersWithStats.sort((a, b) => b._monthlyScore - a._monthlyScore || a.id - b.id);
      usersWithStats = usersWithStats.map((u, idx) => {
        const { _monthlyScore, ...rest } = u;
        return { ...rest, Rank: idx + 1 };
      });
    } else {
      // All-time: use stored Rank and Earnings from Users table
      usersWithStats = users.map(u => ({
        ...u,
        wins: statsMap[u.id].wins,
        totalMatches: statsMap[u.id].totalMatches,
      }));
    }

    res.status(200).send(usersWithStats);
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
        Active: true,
        Games: true
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

    const { Username, Discord, Avatar, Gamertag, Console } = req.body;

    //console.log(req.body);
    // Validate input
    const updateData = {};
    
    if (Console !== undefined) {
      const consoleId = parseInt(Console);
      // Verify that the console exists in the lookup table
      const consoleExists = await prisma.Lookup_Console.findUnique({
        where: { id: consoleId }
      });
      
      if (!consoleExists) {
        return res.status(400).send({ message: 'Invalid console ID' });
      }
      
      updateData.Console = consoleId;
    }
    
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
          id: { not: user.id }
        }
      });
      
      if (existingUser) {
        return res.status(400).send({ message: 'Username is already taken' });
      }
    }

    // Update user profile
    const updatedUser = await prisma.Users.update({
      where: { id: user.id },
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
        Console: true,
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

export const changePassword = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(401).send({ message: 'User not authenticated' });
    }

    const { currentPassword, newPassword } = req.body;

    // Validate required fields
    if (!currentPassword) {
      return res.status(400).send({ message: 'Current password is required' });
    }

    if (!newPassword) {
      return res.status(400).send({ message: 'New password is required' });
    }

    // Validate password length
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).send({ message: 'New password must be at least 6 characters long' });
    }

    // Validate password is not too long (prevent DoS)
    if (newPassword.length > 128) {
      return res.status(400).send({ message: 'New password must be less than 128 characters' });
    }

    // Get user from database with password
    const userData = await prisma.Users.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        Password: true
      }
    });

    if (!userData) {
      return res.status(404).send({ message: 'User not found' });
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, userData.Password);
    if (!passwordMatch) {
      return res.status(400).send({ message: 'Current password is incorrect' });
    }

    // Check if new password is different from current password
    const isSamePassword = await bcrypt.compare(newPassword, userData.Password);
    if (isSamePassword) {
      return res.status(400).send({ message: 'New password must be different from current password' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password in database
    await prisma.Users.update({
      where: { id: user.id },
      data: { 
        Password: hashedPassword,
        JWT: null // Invalidate current session - user must log in again
      }
    });

    // Add current token to blacklist
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
      tokenBlacklist.add(token);
    }

    res.status(200).send({ 
      message: 'Password changed successfully. Please log in again.' 
    });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).send({ message: 'Failed to change password' });
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
      where: { id: user.id },
      select: { Avatar: true }
    });

    // Upload to Cloudinary
    const uploadResult = await cloudinaryService.uploadAvatar(req.file, user.id);

    // Delete old avatar from Cloudinary if it exists and is a Cloudinary URL
    if (currentUser?.Avatar) {
      await cloudinaryService.deleteAvatar(currentUser.Avatar);
    }

    // Update user's avatar URL in database
    const updatedUser = await prisma.Users.update({
      where: { id: user.id },
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
      where: { id: user.id },
      select: { Avatar: true }
    });

    if (!currentUser?.Avatar) {
      return res.status(404).send({ message: 'No avatar to delete' });
    }

    // Delete from Cloudinary
    await cloudinaryService.deleteAvatar(currentUser.Avatar);

    // Update user's avatar to null in database
    const updatedUser = await prisma.Users.update({
      where: { id: user.id },
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
    const userId = req.user.id;

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
    const userId = req.user.id;

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
    const userId = req.user.id

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
    // Handle database connection errors
    if (err.code === 'P1001') {
      return res.status(503).send({ error: 'Database temporarily unavailable. Please try again.' });
    }
    res.status(500).send({ message: 'Failed to get rivals' });
  }
};

// Add a game to user's games list
export const addGame = async (req, res) => {
  try {
    const { gameId } = req.body;
    const userId = req.user.id;

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
    const userId = req.user.id;

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
    const userId = req.user.id;

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

// Get all available consoles from lookup table
export const getAllAvailableConsoles = async (req, res) => {
  try {
    const consoles = await prisma.Lookup_Console.findMany({
      select: {
        id: true,
        Console: true
      },
      orderBy: {
        Console: 'asc'
      }
    });

    //console.log(consoles);
    res.status(200).send(consoles);
  } catch (err) {
    console.error('Error getting available consoles:', err);
    res.status(500).send({ message: 'Failed to get available consoles' });
  }
};

// Store push token for user
export const storePushToken = async (req, res) => {
  try {
    const userId = req.user.id;
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).send({ message: 'Push token is required' });
    }

    // Validate push token format (should start with ExponentPushToken)
    if (!pushToken.startsWith('ExponentPushToken[') && !pushToken.startsWith('ExpoPushToken[')) {
      return res.status(400).send({ message: 'Invalid push token format' });
    }

    // Update user's push token
    await prisma.Users.update({
      where: { id: userId },
      data: { PushToken: pushToken }
    });

    res.status(200).send({ 
      message: 'Push token stored successfully',
      success: true
    });
  } catch (err) {
    console.error('Error storing push token:', err);
    res.status(500).send({ message: 'Failed to store push token' });
  }
};