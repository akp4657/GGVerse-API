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
    return res.status(401).json({ error: 'Access token required' });
  }

  // Check if token is blacklisted
  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ error: 'Token has been invalidated' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
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
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.Authenticated) {
      return res.status(401).json({ error: 'Email not verified' });
    }

    res.json({ 
      valid: true, 
      user: {
        id: user.id,
        email: user.Email,
        username: user.Username,
        authenticated: user.Authenticated
      }
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ error: 'Token validation failed' });
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
      data: { JWT: null }
    });
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
};

export const registerUser = async(req, res) => {
    let email = req.body.email;
    let username = req.body.username;
    let password = req.body.password;

    if (!email || !password)
        return res.status(400).json({ error: 'Email and password are required.' });

    // Check if user already exists
    let user = await prisma.Users.findUnique({
        where: {Email: email}
    })
    if(user) {
        return res.status(400).json({error: 'User already exists'})
    }

    try {
        const hashed = await bcrypt.hash(password, 12);
        const userObj = { 
            Username: username || email,
            Email: email,
            Password: hashed,
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
        return res.status(400).json({message: 'Email and password are required'});
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
            data: { JWT: token }
        });

        console.log(user)

        return res.status(200).send({ 
            message: 'Login successful', 
            token, 
            verified: user.Authenticated,
            user: {
                id: user.id,
                email: user.Email,
                username: user.Username
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
        return res.status(500).json({message: 'Missing verification token'});
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        let user = await prisma.Users.update({
            where: {id: decoded.id},
            data: { Authenticated: true }
        })

        return res.status(200).send({message: "Email verified successfully", token: token});
    } catch(err) {
        console.log(err)
        return res.status(500).send({err: "Invalid or expired token"});
    }
}