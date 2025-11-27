import express from 'express';
import multer from 'multer';
import * as admin from 'firebase-admin';
import { db, firestoreHelpers } from '../database-firestore';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Configure multer for memory storage (for Cloud Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم'));
    }
  }
});

// Get Cloud Storage bucket
const bucket = admin.storage().bucket();

// Upload order image
router.post('/order-image/:orderId', authenticateToken, upload.single('image'), async (req: AuthRequest, res) => {
  try {
    const { orderId } = req.params;
    const { image_type } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
    }

    if (!image_type || !['before_send', 'after_receive', 'device_condition'].includes(image_type)) {
      return res.status(400).json({ error: 'نوع الصورة غير صحيح' });
    }

    // Check if order exists
    const orderDoc = await db.collection('orders').doc(orderId).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const order: any = orderDoc.data();

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id.toString()) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لرفع صور لهذا الطلب' });
    }

    // Upload to Cloud Storage
    const fileName = `orders/${orderId}/${Date.now()}-${Math.round(Math.random() * 1E9)}${req.file.originalname.match(/\.[0-9a-z]+$/i)?.[0] || '.jpg'}`;
    const file = bucket.file(fileName);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
      },
    });

    // Make file publicly accessible
    await file.makePublic();

    const imagePath = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Save image info to Firestore
    const imageRef = await db.collection('order_images').add({
      order_id: orderId,
      image_path: imagePath,
      image_type,
      uploaded_by: req.user!.id.toString(),
      uploaded_at: firestoreHelpers.serverTimestamp()
    });

    res.json({
      id: imageRef.id,
      image_path: imagePath,
      message: 'تم رفع الصورة بنجاح'
    });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ error: 'خطأ في رفع الصورة' });
  }
});

// Upload signature
router.post('/signature/:orderId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { orderId } = req.params;
    const { signature_data } = req.body;

    if (!signature_data) {
      return res.status(400).json({ error: 'بيانات التوقيع مطلوبة' });
    }

    // Check if order exists
    const orderDoc = await db.collection('orders').doc(orderId).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const order: any = orderDoc.data();

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id.toString()) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة توقيع لهذا الطلب' });
    }

    // Save signature to Firestore
    const signatureRef = await db.collection('order_signatures').add({
      order_id: orderId,
      signature_data,
      signed_at: firestoreHelpers.serverTimestamp()
    });

    res.json({
      id: signatureRef.id,
      message: 'تم حفظ التوقيع بنجاح'
    });
  } catch (error) {
    console.error('Upload signature error:', error);
    res.status(500).json({ error: 'خطأ في حفظ التوقيع' });
  }
});

export default router;

