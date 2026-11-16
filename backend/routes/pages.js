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

router.use(async (req, res, next) => {
  req.user = await getCurrentUser(req);
  next();
});

// Home
router.get('/', async (req, res) => {
  res.render('pages/home', { user: req.user });
});

// Login
router.get('/login', async (req, res) => {
  const user = req.user;

  if (user) return res.redirect('/');

  res.render('auth/login', { error: null, user });
});

// Register
router.get('/register', async (req, res) => {
  const user = req.user;

  if (user) return res.redirect('/');

  res.render('auth/register', { error: null, user });
});

//book
// GET /books/:id - แสดงหน้ารายละเอียดหนังสือ + รีวิว
router.get('/books/:id', async (req, res) => {
  try {
    const bookId = req.params.id;
    const userId = req.user ? req.user.id : null; // อ้างอิงจาก middleware ตรวจสอบ login ของคุณ

    // 1. ดึงข้อมูลหนังสือ + คะแนนเฉลี่ย
    const bookResult = await pool.query(`
      SELECT b.*, COALESCE(AVG(r.rating), 0) AS avg_rating
      FROM books b
      LEFT JOIN reviews r ON b.book_id = r.book_id
      WHERE b.book_id = $1
      GROUP BY b.book_id
    `, [bookId]);

    if (bookResult.rows.length === 0) {
      return res.status(404).send('ไม่พบหนังสือเล่มนี้');
    }
    const book = bookResult.rows[0];

    // 2. ดึงรีวิวทั้งหมดของหนังสือเล่มนี้ (เรียงจากใหม่ไปเก่า)
    const reviewsResult = await pool.query(`
      SELECT r.*, u.name AS username
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.book_id = $1
      ORDER BY r.created_at DESC
    `, [bookId]);

    // 3. เช็กสถานะของ User ปัจจุบัน (อยู่ใน Your List หรือยัง / เคยรีวิวหรือยัง)
    let isInList = false;
    let userReview = null;

    if (userId) {
      const listCheck = await pool.query(
        'SELECT 1 FROM user_lists WHERE user_id = $1 AND book_id = $2',
        [userId, bookId]
      );
      isInList = listCheck.rows.length > 0;

      userReview = reviewsResult.rows.find(r => r.user_id === userId) || null;
    }

    res.render('pages/book', {
      user: req.user || null,
      book,
      reviews: reviewsResult.rows,
      isInList,
      userReview
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// POST /books/:id/review - บันทึกหรืออัปเดตรีวิว
router.post('/books/:id/review', async (req, res) => {
  if (!req.user) return res.redirect('/login');
  
  const bookId = req.params.id;
  const userId = req.user.id;
  const { rating, comment } = req.body;

  try {
    await pool.query(`
      INSERT INTO reviews (user_id, book_id, rating, comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, book_id) 
      DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = CURRENT_TIMESTAMP
    `, [userId, bookId, rating, comment]);

    res.redirect(`/books/${bookId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('ไม่สามารถบันทึกรีวิวได้');
  }
});

//rated book
// GET /rated-books - แสดงรายการหนังสือทั้งหมดที่ User เคยรีวิวไว้
router.get('/rated-books', async (req, res) => {
  const user = req.user;
  if (!user) return res.redirect('/login');

  try {
    const userId = user.id;

    const result = await pool.query(`
      SELECT 
        r.review_id,
        r.rating,
        r.comment,
        r.created_at,
        b.book_id,
        b.title,
        b.genre,
        b.cover_image
      FROM reviews r
      JOIN books b ON r.book_id = b.book_id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
    `, [userId]);

    res.render('pages/rated_book', {
      user,
      ratedBooks: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// POST /rated-books/delete/:reviewId - ลบรีวิวของตัวเอง
router.post('/rated-books/delete/:reviewId', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  try {
    const { reviewId } = req.params;
    const userId = req.user.id;

    // ใส่ AND user_id = $2 เพื่อป้องกันไม่ให้คนอื่นแอบยิง API มาลบรีวิวของเรา
    await pool.query(
      'DELETE FROM reviews WHERE review_id = $1 AND user_id = $2',
      [reviewId, userId]
    );

    res.redirect('/rated-books');
  } catch (err) {
    console.error(err);
    res.status(500).send('ไม่สามารถลบรีวิวได้');
  }
});

export default router;
