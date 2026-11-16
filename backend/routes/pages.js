import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

const router = express.Router();

// ตรวจสอบ User จาก JWT Cookie
const getCurrentUser = async (req) => {
  try {
    const token = req.cookies.token;

    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [decoded.id]
    );

    return result.rows[0] || null;

  } catch (error) {
    return null;
  }
};

// Home
router.get('/', async (req, res) => {
  const user = await getCurrentUser(req);

  res.render('pages/home', { user });
});

// Login
router.get('/login', async (req, res) => {
  const user = await getCurrentUser(req);

  if (user) return res.redirect('/');

  res.render('auth/login', { error: null });
});

// Register
router.get('/register', async (req, res) => {
  const user = await getCurrentUser(req);

  if (user) return res.redirect('/');

  res.render('auth/register', { error: null });
});

export default router;
