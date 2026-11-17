import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

//นิยามก่อนส่งไปให้ res.cookie()
const cookieOptions = {
  httpOnly: true, //js อ่าน cookie ไม่ได้
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict', //req มาจากเว็บอื่น ห้ามส่ง cookie ไปให้
  maxAge: 30 * 24 * 60 * 60 * 1000 // cookie will expire in 30 days
}

//function สร้าง token จ้า
const generateToken = (id) => {
    return jwt.sign({id}, process.env.JWT_SECRET, {
      expiresIn: '30d'
    });
  }

// register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  //ข้อมูลว่าง
  if (!name || !email || !password) {
    return res.status(400).json({message: 'Please provide all required fields'});
  }

  //ถ้ามี user อยู่แล้ว อันนี้ sql หา
  const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (userExists.rows.length > 0) {
    return res.status(400).json({ message: 'User already exists'});
  }

  //hash password ให้ user
  const hashedPassword = await bcrypt.hash(password, 10);

  // ถ้าเป็น new user sql เพิ่มเข้าไป
  const newUser = await pool.query(
  'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email',
  [name, email, hashedPassword]
  );

  //เรียกการสร้าง token
  const token = generateToken(newUser.rows[0].id);

  //เพื่อระบุ user ที่ login อยู่
  res.cookie('token', token, cookieOptions);

  //return user ใหม่
  return res.status(201).json({ user: newUser.rows[0]});
});

//login
router.post('/login', async (req, res) => {
  //ที่กรอกไปในฟอร์ม
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Please provide all required fields'});
  }

  //หา user
  const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  //ไม่เจอ
  if (user.rows.length === 0) {
    return res.status(400).json({ message: 'Invalid credentials'});
  }

  const userData = user.rows[0];

  //รหัสแมตช์ไหม
  const isMatch = await bcrypt.compare(password, userData.password);

  if (!isMatch) {
    return res.status(400).json({ message: 'Invalid credentials' });
  }

  //สร้่าง token อีกทีตอนเข้าสู้ระบบใหม่ด้วยแอคเดิม
  const token = generateToken(userData.id);

  res.cookie('token', token, cookieOptions);

  //response to client and finish the request
  res.json({ user: { id: userData.id, name: userData.name, email: userData.email}});
});

// me
router.get("/me", protect, async (req, res) => {
  res.json(req.user);
});

// list users
router.get("/users", protect, async (req, res) => {
  const users = await pool.query(
    "SELECT id, name, email FROM users ORDER BY id"
  );

  res.json({ users: users.rows });
});

//logout
router.post("/logout", (req, res) => {
  res.cookie("token", "", { ...cookieOptions, maxAge: 1});
  res.json({ message: "logged out successfully"});
});

export default router;


