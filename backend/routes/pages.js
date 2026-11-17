import express from 'express';
import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import pool from '../config/db.js';

const router = express.Router();
let visitorTableReady;
let lastVisitorCleanupDate;

const getBangkokDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(
    parts
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value])
  );

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

const ensureVisitorTable = () => {
  if (!visitorTableReady) {
    visitorTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS daily_home_visitors (
        visit_date DATE NOT NULL,
        visitor_hash TEXT NOT NULL,
        ip_address INET NOT NULL,
        first_visit TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_visit TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (visit_date, visitor_hash)
      )
    `).then(() => pool.query(`
      ALTER TABLE daily_home_visitors
      ADD COLUMN IF NOT EXISTS ip_address INET
    `)).then(() => undefined).catch((error) => {
      visitorTableReady = undefined;
      throw error;
    });
  }

  return visitorTableReady;
};

const getVisitorStats = async (req) => {
  const ip = req.ip;
  const secret = process.env.JWT_SECRET;

  if (!ip) {
    throw new Error('Could not determine visitor IP address');
  }
  if (!secret) {
    throw new Error('JWT_SECRET is required to hash visitor IP addresses');
  }

  const visitDate = getBangkokDate();
  const visitorHash = createHmac('sha256', secret)
    .update(`${visitDate}:${ip}`)
    .digest('hex');

  await ensureVisitorTable();
  await pool.query(`
    INSERT INTO daily_home_visitors (visit_date, visitor_hash, ip_address)
    VALUES ($1::date, $2, $3::inet)
    ON CONFLICT (visit_date, visitor_hash)
    DO UPDATE SET
      ip_address = EXCLUDED.ip_address,
      last_visit = CURRENT_TIMESTAMP
  `, [visitDate, visitorHash, ip]);

  if (lastVisitorCleanupDate !== visitDate) {
    await pool.query(
      'DELETE FROM daily_home_visitors WHERE visit_date < $1::date',
      [visitDate]
    );
    lastVisitorCleanupDate = visitDate;
  }

  const result = await pool.query(`
    SELECT
      COUNT(*)::int AS "todayVisitors",
      MIN(first_visit) AS "firstVisit",
      MAX(last_visit) AS "lastVisit"
    FROM daily_home_visitors
    WHERE visit_date = $1::date
  `, [visitDate]);

  return result.rows[0];
};

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
// GET / - หน้าแรก
router.get('/', async (req, res) => {
  try {
    const { search, genre } = req.query;

    // 1. ดึงหนังสือแนะนำ (is_featured = TRUE) อยู่ใน sql
    const featuredResult = await pool.query(`
      SELECT b.*, COALESCE(AVG(r.rating), 0) AS avg_rating, COUNT(r.review_id) AS review_count
      FROM books b
      LEFT JOIN reviews r ON b.book_id = r.book_id
      WHERE b.is_featured = TRUE
      GROUP BY b.book_id
      ORDER BY b.created_at DESC
    `);

    // 2. ดึง Top 10 หนังสือยอดนิยม (เรียงตามคะแนนเฉลี่ยสูงสุด)
    const trendingResult = await pool.query(`
      SELECT b.*, COALESCE(AVG(r.rating), 0) AS avg_rating, COUNT(r.review_id) AS review_count
      FROM books b
      LEFT JOIN reviews r ON b.book_id = r.book_id
      GROUP BY b.book_id
      ORDER BY avg_rating DESC, review_count DESC, b.book_id ASC
      LIMIT 10
    `);

    // 3. ดึงหนังสือทั้งหมด (รองรับการค้นหาชื่อและกรองหมวดหมู่)
    let allBooksQuery = `
      SELECT b.*, COALESCE(AVG(r.rating), 0) AS avg_rating, COUNT(r.review_id) AS review_count
      FROM books b
      LEFT JOIN reviews r ON b.book_id = r.book_id
      WHERE 1=1
    `;
    const queryParams = [];

    if (search && search.trim() !== '') {
      queryParams.push(`%${search.trim()}%`);
      allBooksQuery += ` AND b.title ILIKE $${queryParams.length}`;
    }

    if (genre && genre.trim() !== '') {
      queryParams.push(genre.trim());
      allBooksQuery += ` AND b.genre = $${queryParams.length}`;
    }

    allBooksQuery += ` GROUP BY b.book_id ORDER BY b.created_at DESC`;
    const allBooksResult = await pool.query(allBooksQuery, queryParams);

    // 4. ดึงรายชื่อหมวดหมู่ทั้งหมดที่มีในระบบไปใส่ใน Dropdown
    const genresResult = await pool.query(`
      SELECT DISTINCT genre FROM books WHERE genre IS NOT NULL AND genre != '' ORDER BY genre ASC
    `);
    const genres = genresResult.rows.map(row => row.genre);
    const visitorStats = await getVisitorStats(req);

    res.render('pages/home', {
      user: req.user || null,
      featuredBooks: featuredResult.rows,
      trendingBooks: trendingResult.rows,
      allBooks: allBooksResult.rows,
      genres,
      search: search || '',
      selectedGenre: genre || '',
      visitorStats
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
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








//yourlist
// 1. GET /your-list - แสดงรายการหนังสือใน Your List ของผู้ใช้
router.get('/your-list', async (req, res) => {
  // หากยังไม่ได้ต่อระบบล็อกอินเต็มรูปแบบ สามารถเปลี่ยนบรรทัดล่างเป็น const userId = req.user ? req.user.id : 1; เพื่อทดสอบก่อนได้
  if (!req.user) return res.redirect('/login');

  try {
    const userId = req.user.id;

    const result = await pool.query(`
      SELECT 
        ul.list_id,
        ul.current_page,
        ul.created_at,
        b.book_id,
        b.title,
        b.genre,
        b.cover_image,
        b.total_pages
      FROM user_lists ul
      JOIN books b ON ul.book_id = b.book_id
      WHERE ul.user_id = $1
      ORDER BY ul.created_at DESC
    `, [userId]);

    res.render('pages/your_list', {
      user: req.user,
      userBooks: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// 2. POST /your-list/add/:bookId - เพิ่มหนังสือเข้า Your List (เรียกใช้จากปุ่มในหน้า book.ejs)
router.post('/your-list/add/:bookId', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  try {
    const userId = req.user.id;
    const { bookId } = req.params;

    await pool.query(`
      INSERT INTO user_lists (user_id, book_id, current_page)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_id, book_id) DO NOTHING
    `, [userId, bookId]);

    res.redirect(`/books/${bookId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('ไม่สามารถเพิ่มหนังสือเข้าลิสต์ได้');
  }
});

// 3. POST /your-list/update/:bookId - อัปเดตหน้าที่อ่านถึงปัจจุบัน
router.post('/your-list/update/:bookId', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  try {
    const userId = req.user.id;
    const { bookId } = req.params;
    const currentPage = parseInt(req.body.current_page, 10) || 0;

    // ตรวจสอบจำนวนหน้าทั้งหมดของหนังสือ เพื่อป้องกันการกรอกเลขเกินจำนวนหน้าจริง
    const bookCheck = await pool.query('SELECT total_pages FROM books WHERE book_id = $1', [bookId]);
    if (bookCheck.rows.length === 0) return res.status(404).send('ไม่พบหนังสือ');

    const totalPages = bookCheck.rows[0].total_pages;
    const validPage = Math.max(0, Math.min(currentPage, totalPages));

    await pool.query(`
      UPDATE user_lists 
      SET current_page = $1 
      WHERE user_id = $2 AND book_id = $3
    `, [validPage, userId, bookId]);

    res.redirect('/your-list');
  } catch (err) {
    console.error(err);
    res.status(500).send('ไม่สามารถอัปเดตความคืบหน้าได้');
  }
});

// 4. POST /your-list/remove/:bookId - ลบหนังสือออกจาก Your List
router.post('/your-list/remove/:bookId', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  try {
    const userId = req.user.id;
    const { bookId } = req.params;

    await pool.query(
      'DELETE FROM user_lists WHERE user_id = $1 AND book_id = $2',
      [userId, bookId]
    );

    // ถ้ากดลบมาจากหน้า book ให้เด้งกลับหน้า book แต่ถ้าลบจากหน้า your-list ให้รีเฟรชหน้า your-list
    const referer = req.get('Referer');
    if (referer && referer.includes('/books/')) {
      return res.redirect(`/books/${bookId}`);
    }
    res.redirect('/your-list');
  } catch (err) {
    console.error(err);
    res.status(500).send('ไม่สามารถลบหนังสือออกจากลิสต์ได้');
  }
});


export default router;
