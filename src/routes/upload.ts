import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم'));
    }
  }
});

// Upload order image
router.post('/order-image/:orderId', authenticateToken, upload.single('image'), (req: AuthRequest, res) => {
  const { orderId } = req.params;
  const { image_type } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
  }

  if (!image_type || !['before_send', 'after_receive', 'device_condition'].includes(image_type)) {
    return res.status(400).json({ error: 'نوع الصورة غير صحيح' });
  }

  // Check if order exists
  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    }

    if (!order) {
      // Delete uploaded file
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(403).json({ error: 'ليس لديك صلاحية لرفع صور لهذا الطلب' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
    }

    // Use full URL in production, relative path in development
    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
      : '';
    const imagePath = `${baseUrl}/uploads/${req.file.filename}`;

    db.run(
      'INSERT INTO order_images (order_id, image_path, image_type, uploaded_by) VALUES (?, ?, ?, ?)',
      [orderId, imagePath, image_type, req.user!.id],
      function(err) {
        if (err) {
          if (req.file) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(500).json({ error: 'خطأ في حفظ الصورة' });
        }
        res.json({
          id: this.lastID,
          image_path: imagePath,
          message: 'تم رفع الصورة بنجاح'
        });
      }
    );
  });
});

// Upload signature
router.post('/signature/:orderId', authenticateToken, (req: AuthRequest, res) => {
  const { orderId } = req.params;
  const { signature_data } = req.body;

  if (!signature_data) {
    return res.status(400).json({ error: 'بيانات التوقيع مطلوبة' });
  }

  // Check if order exists
  db.get('SELECT * FROM orders WHERE id = ?', [orderId], (err, order: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    }

    if (!order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة توقيع لهذا الطلب' });
    }

    db.run(
      'INSERT INTO order_signatures (order_id, signature_data) VALUES (?, ?)',
      [orderId, signature_data],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'خطأ في حفظ التوقيع' });
        }
        res.json({
          id: this.lastID,
          message: 'تم حفظ التوقيع بنجاح'
        });
      }
    );
  });
});

export default router;




