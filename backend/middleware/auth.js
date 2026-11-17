import jwt from "jsonwebtoken";
import pool from "../config/db.js";

export const protect = async (req, res, next) => {
  try {
    const token = req.cookies.token; //cookie ที่แนบมากะ req ผู้ใช้ อันนี้เรียกใช้ใน server.js

    //ถ้าไม่มี token แนบมา
    if (!token) { 
      return res.status(401).json({ message: "Not authorized, no token"});
    }

    //ถ้ามี token แนบมาด้วย ก็ decode และ verfiy ว่า token มันสร้างจากเซิร์ฟเราจริง ๆ ไม่ใช่แฮ็กเกอร์ทำระหว่างทาง
    // ว่า user คนนี้เขาทำเข้าสู่ระบบมาอย่างถูกต้อง และสามารถระบุได้ว่าเป็นใคร
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // หา user ที่ตรงกัน
    const user = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [decoded.id]);

    //เช็คว่ามี user ตาม req อยู่ใน database ของเราไหม
    if (user.rows.length === 0) {
      return res.status(401).json({ message: "not authorized, user not found"});
    }

    //ถ้า req ปัจจุบัน ตรงกับ user ใน database (รหัส token ก็ต้องตรงด้วย) ก็ทำตามขั้นตอนต่อไป
    req.user = user.rows[0];
    next();

  } catch (error) {
    console.error(error);
    res.status(401).json({ message: "Not authorized, token failed"});
  }
};

