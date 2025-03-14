const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const SECRET_KEY = process.env.SECRET_KEY || 'supersecretkey';

// User Authentication
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, hashedPassword]);
  res.status(201).send('User registered');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  if (result.rows.length === 0) return res.status(400).send('User not found');
  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.status(401).send('Invalid credentials');
  const token = jwt.sign({ id: user.id }, SECRET_KEY, { expiresIn: '1h' });
  res.json({ token });
});

// Middleware to authenticate users
const authenticate = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).send('Access Denied');
  try {
    const verified = jwt.verify(token, SECRET_KEY);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).send('Invalid Token');
  }
};

// Transactions
app.post('/transactions', authenticate, async (req, res) => {
  const { amount, type, owner } = req.body;
  await pool.query('INSERT INTO transactions (amount, type, owner) VALUES ($1, $2, $3)', [amount, type, owner]);
  res.status(201).send('Transaction added');
});

app.get('/transactions', authenticate, async (req, res) => {
  const result = await pool.query('SELECT * FROM transactions');
  res.json(result.rows);
});

// Settlement Calculation
app.get('/settlement', authenticate, async (req, res) => {
  const transactions = await pool.query('SELECT * FROM transactions');
  const owners = await pool.query('SELECT * FROM owners');
  
  const totalIncome = transactions.rows.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.rows.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const netIncome = totalIncome - totalExpenses;
  
  let fairShare = {};
  let actualBalance = {};
  let settlements = {};

  owners.rows.forEach(owner => {
    fairShare[owner.name] = netIncome * owner.ownership;
    actualBalance[owner.name] = transactions.rows
      .filter(t => t.owner === owner.name)
      .reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
    settlements[owner.name] = actualBalance[owner.name] - fairShare[owner.name];
  });

  res.json(settlements);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
