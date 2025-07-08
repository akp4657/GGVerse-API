// index.js
const express = require('express');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 3000;
const cors = require('cors');
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello world!');
});

app.get('/users', async (req, res) => {
  try {
    console.log('Called')
    const users = await prisma.test_User_Table.findMany(); // Model name matches Prisma schema
    res.status(200).send(users)
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});