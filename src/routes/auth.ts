import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  db.get(
    'SELECT * FROM users WHERE username = ? AND is_active = 1',
    [username],
    async (err, user: any) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
      }

      if (!user) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
      }

      const jwtSecret = process.env.JWT_SECRET || 'secret';
      const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
      
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        jwtSecret,
        { expiresIn: jwtExpiresIn } as jwt.SignOptions
      );

      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
          phone: user.phone
        }
      });
    }
  );
});

// Get current user
router.get('/me', authenticateToken, (req: AuthRequest, res) => {
  db.get(
    'SELECT id, username, full_name, role, phone FROM users WHERE id = ?',
    [req.user!.id],
    (err, user: any) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
      }
      if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود' });
      }
      res.json(user);
    }
  );
});

export default router;




