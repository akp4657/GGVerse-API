import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as emailService from '../services/emailService.js';
import prisma from '../prisma/prisma.js';

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
        return res.status(400)
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

        const token = jwt.sign(
            { userId: user.id, email: user.Email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
        );

        return res.status(200).send({ message: 'Login successful', token });

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