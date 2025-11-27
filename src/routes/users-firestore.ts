import express from 'express';
import bcrypt from 'bcryptjs';
import * as admin from 'firebase-admin';
import { db, firestoreHelpers } from '../database-firestore';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';

const router = express.Router();

// Get all users
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { role } = req.query;

    // Allow admin and employee to get users list (especially couriers)
    if (req.user!.role !== 'admin' && req.user!.role !== 'employee') {
      return res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى هذا المورد' });
    }

    let query: admin.firestore.Query = db.collection('users');

    if (role) {
      query = query.where('role', '==', role);
    }

    // Only show active users for non-admin users
    if (req.user!.role !== 'admin') {
      query = query.where('is_active', '==', true);
    }

    query = query.orderBy('created_at', 'desc');

    const snapshot = await query.get();
    const users = snapshot.docs.map((doc: admin.firestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(users);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'خطأ في جلب المستخدمين' });
  }
});

// Get single user
router.get('/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const userDoc = await db.collection('users').doc(id).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    res.json({
      id: userDoc.id,
      ...userDoc.data()
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'خطأ في جلب المستخدم' });
  }
});

// Create user
router.post('/', authenticateToken, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const { username, password, full_name, role, phone } = req.body;

    if (!username || !password || !full_name || !role) {
      return res.status(400).json({ error: 'البيانات المطلوبة غير مكتملة' });
    }

    if (!['admin', 'employee', 'courier'].includes(role)) {
      return res.status(400).json({ error: 'الدور غير صحيح' });
    }

    // Check if username exists
    const existingUser = await db.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();

    if (!existingUser.empty) {
      return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const userRef = await db.collection('users').add({
      username,
      password: hashedPassword,
      full_name,
      role,
      phone: phone || null,
      created_at: firestoreHelpers.serverTimestamp(),
      is_active: true
    });

    res.status(201).json({ id: userRef.id, message: 'تم إنشاء المستخدم بنجاح' });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'خطأ في إنشاء المستخدم' });
  }
});

// Update user
router.put('/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { username, password, full_name, role, phone, is_active } = req.body;

    const userDoc = await db.collection('users').doc(id).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const updates: any = {};

    if (full_name !== undefined) {
      updates.full_name = full_name;
    }
    if (role !== undefined) {
      if (!['admin', 'employee', 'courier'].includes(role)) {
        return res.status(400).json({ error: 'الدور غير صحيح' });
      }
      updates.role = role;
    }
    if (phone !== undefined) {
      updates.phone = phone;
    }
    if (is_active !== undefined) {
      updates.is_active = is_active;
    }
    if (username !== undefined && username !== userDoc.data()!.username) {
      // Check if new username exists
      const existingUser = await db.collection('users')
        .where('username', '==', username)
        .limit(1)
        .get();

      if (!existingUser.empty) {
        return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
      }
      updates.username = username;
    }
    if (password !== undefined && password !== '') {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ message: 'لا توجد تحديثات' });
    }

    await db.collection('users').doc(id).update(updates);
    res.json({ message: 'تم تحديث المستخدم بنجاح' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'خطأ في تحديث المستخدم' });
  }
});

// Delete user (soft delete)
router.delete('/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    if (id === req.user!.id.toString()) {
      return res.status(400).json({ error: 'لا يمكنك حذف حسابك الخاص' });
    }

    await db.collection('users').doc(id).update({ is_active: false });
    res.json({ message: 'تم حذف المستخدم بنجاح' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'خطأ في حذف المستخدم' });
  }
});

export default router;

