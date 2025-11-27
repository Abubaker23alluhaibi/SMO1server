import express from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';

const router = express.Router();

// Get all users
router.get('/', authenticateToken, (req: AuthRequest, res) => {
  const { role } = req.query;

  // Allow admin and employee to get users list (especially couriers)
  if (req.user!.role !== 'admin' && req.user!.role !== 'employee') {
    return res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى هذا المورد' });
  }

  let query = 'SELECT id, username, full_name, role, phone, created_at, is_active FROM users WHERE 1=1';
  const params: any[] = [];

  if (role) {
    query += ' AND role = ?';
    params.push(role);
  }

  // Only show active users for non-admin users
  if (req.user!.role !== 'admin') {
    query += ' AND is_active = 1';
  }

  query += ' ORDER BY created_at DESC';

  db.all(query, params, (err, users: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في جلب المستخدمين' });
    }
    res.json(users);
  });
});

// Get single user
router.get('/:id', authenticateToken, requireRole('admin'), (req: AuthRequest, res) => {
  const { id } = req.params;

  db.get(
    'SELECT id, username, full_name, role, phone, created_at, is_active FROM users WHERE id = ?',
    [id],
    (err, user: any) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في جلب المستخدم' });
      }
      if (!user) {
        return res.status(404).json({ error: 'المستخدم غير موجود' });
      }
      res.json(user);
    }
  );
});

// Create user
router.post('/', authenticateToken, requireRole('admin'), async (req: AuthRequest, res) => {
  const { username, password, full_name, role, phone } = req.body;

  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'البيانات المطلوبة غير مكتملة' });
  }

  if (!['admin', 'employee', 'courier'].includes(role)) {
    return res.status(400).json({ error: 'الدور غير صحيح' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  db.run(
    'INSERT INTO users (username, password, full_name, role, phone) VALUES (?, ?, ?, ?, ?)',
    [username, hashedPassword, full_name, role, phone || null],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
        }
        return res.status(500).json({ error: 'خطأ في إنشاء المستخدم' });
      }
      res.status(201).json({ id: this.lastID, message: 'تم إنشاء المستخدم بنجاح' });
    }
  );
});

// Update user
router.put('/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { username, password, full_name, role, phone, is_active } = req.body;

  // Check if user exists
  db.get('SELECT * FROM users WHERE id = ?', [id], async (err, user: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    }
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const updates: any = {};
    const params: any[] = [];

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
      updates.is_active = is_active ? 1 : 0;
    }
    if (username !== undefined && username !== user.username) {
      updates.username = username;
    }
    if (password !== undefined && password !== '') {
      updates.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ message: 'لا توجد تحديثات' });
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(id);

    db.run(
      `UPDATE users SET ${setClause} WHERE id = ?`,
      values,
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'اسم المستخدم موجود بالفعل' });
          }
          return res.status(500).json({ error: 'خطأ في تحديث المستخدم' });
        }
        res.json({ message: 'تم تحديث المستخدم بنجاح' });
      }
    );
  });
});

// Delete user (soft delete)
router.delete('/:id', authenticateToken, requireRole('admin'), (req: AuthRequest, res) => {
  const { id } = req.params;

  if (parseInt(id) === req.user!.id) {
    return res.status(400).json({ error: 'لا يمكنك حذف حسابك الخاص' });
  }

  db.run('UPDATE users SET is_active = 0 WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: 'خطأ في حذف المستخدم' });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    res.json({ message: 'تم حذف المستخدم بنجاح' });
  });
});

export default router;




