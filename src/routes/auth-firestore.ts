import express from 'express';
import bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import * as functions from 'firebase-functions';
import { db } from '../database-firestore';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }

    const usersRef = db.collection('users');
    const snapshot = await usersRef
      .where('username', '==', username)
      .where('is_active', '==', true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const user = { id: userDoc.id, ...userData } as any;

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    let jwtSecret: string = 'secret';
    try {
      const configSecret = functions.config().jwt?.secret;
      jwtSecret = process.env.JWT_SECRET || (typeof configSecret === 'string' ? configSecret : 'secret');
    } catch {
      jwtSecret = process.env.JWT_SECRET || 'secret';
    }
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
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user!.id.toString()).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const user = userDoc.data();
    res.json({
      id: userDoc.id,
      username: user!.username,
      full_name: user!.full_name,
      role: user!.role,
      phone: user!.phone
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
  }
});

export default router;

