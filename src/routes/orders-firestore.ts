import express from 'express';
import * as admin from 'firebase-admin';
import { db, firestoreHelpers } from '../database-firestore';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';

const router = express.Router();

// Helper function to get user name
async function getUserName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const userDoc = await db.collection('users').doc(userId.toString()).get();
    return userDoc.exists ? userDoc.data()!.full_name : null;
  } catch {
    return null;
  }
}

// Get all orders (with filters)
router.get('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { status, service_type, assigned_to, search, courier_id } = req.query;
    let query: admin.firestore.Query = db.collection('orders');

    // If courier user, only show their orders
    if (req.user!.role === 'courier') {
      query = query.where('assigned_to', '==', req.user!.id.toString());
    }

    if (status) {
      query = query.where('status', '==', status);
    }

    if (service_type) {
      query = query.where('service_type', '==', service_type);
    }

    if (assigned_to && req.user!.role !== 'courier') {
      query = query.where('assigned_to', '==', assigned_to);
    }

    if (courier_id && req.user!.role === 'admin') {
      query = query.where('assigned_to', '==', courier_id);
    }

    query = query.orderBy('created_at', 'desc');

    const snapshot = await query.get();
    let orders = snapshot.docs.map((doc: admin.firestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Apply search filter (client-side for Firestore limitations)
    if (search) {
      const searchTerm = (search as string).toLowerCase();
      orders = orders.filter((o: any) =>
        o.customer_name?.toLowerCase().includes(searchTerm) ||
        o.customer_phone?.includes(searchTerm)
      );
    }

    // Get order details and user names
    const ordersWithDetails = await Promise.all(orders.map(async (order: any) => {
      const detailsSnapshot = await db.collection('order_details')
        .where('order_id', '==', order.id)
        .get();

      const details: any = {};
      detailsSnapshot.docs.forEach((doc: admin.firestore.QueryDocumentSnapshot) => {
        const data = doc.data();
        details[data.field_name] = data.field_value;
      });

      const assignedToName = await getUserName(order.assigned_to);
      const createdByName = await getUserName(order.created_by);

      return {
        ...order,
        details,
        assigned_to_name: assignedToName,
        created_by_name: createdByName
      };
    }));

    res.json(ordersWithDetails);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'خطأ في جلب الطلبات' });
  }
});

// Get single order
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orderDoc = await db.collection('orders').doc(id).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const order: any = { id: orderDoc.id, ...orderDoc.data() };

    // Check permissions for courier users
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id.toString()) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لعرض هذا الطلب' });
    }

    // Get order details
    const detailsSnapshot = await db.collection('order_details')
      .where('order_id', '==', id)
      .get();

    const details: any = {};
    detailsSnapshot.docs.forEach((doc: admin.firestore.QueryDocumentSnapshot) => {
      const data = doc.data();
      details[data.field_name] = data.field_value;
    });

    // Get images
    const imagesSnapshot = await db.collection('order_images')
      .where('order_id', '==', id)
      .orderBy('uploaded_at', 'desc')
      .get();

    const images = imagesSnapshot.docs.map((doc: admin.firestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Get signature
    const signatureSnapshot = await db.collection('order_signatures')
      .where('order_id', '==', id)
      .orderBy('signed_at', 'desc')
      .limit(1)
      .get();

    const signature = signatureSnapshot.empty ? null : {
      id: signatureSnapshot.docs[0].id,
      ...signatureSnapshot.docs[0].data()
    };

    // Get payments
    const paymentsSnapshot = await db.collection('order_payments')
      .where('order_id', '==', id)
      .orderBy('payment_date', 'desc')
      .get();

    const payments = paymentsSnapshot.docs.map((doc: admin.firestore.QueryDocumentSnapshot) => ({
      id: doc.id,
      ...doc.data()
    }));

    const assignedToName = await getUserName(order.assigned_to);
    const createdByName = await getUserName(order.created_by);

    res.json({
      ...order,
      details,
      images,
      signature,
      payments,
      assigned_to_name: assignedToName,
      created_by_name: createdByName
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ error: 'خطأ في جلب الطلب' });
  }
});

// Create new order
router.post('/', authenticateToken, requireRole('admin', 'employee'), async (req: AuthRequest, res) => {
  try {
    const {
      customer_name,
      customer_phone,
      address,
      service_type,
      assigned_to,
      ...details
    } = req.body;

    if (!customer_name || !customer_phone || !address || !service_type) {
      return res.status(400).json({ error: 'البيانات الأساسية مطلوبة' });
    }

    // Determine status and assigned_to
    let status = 'preparing';
    let finalAssignedTo = null;

    if (assigned_to) {
      status = 'assigned';
      finalAssignedTo = assigned_to.toString();
    }

    const orderRef = await db.collection('orders').add({
      customer_name,
      customer_phone,
      address,
      service_type,
      status,
      assigned_to: finalAssignedTo,
      created_by: req.user!.id.toString(),
      created_at: firestoreHelpers.serverTimestamp(),
      updated_at: firestoreHelpers.serverTimestamp()
    });

    // Save order details
    const detailEntries = Object.entries(details).filter(([_, v]) => v !== null && v !== undefined);
    if (detailEntries.length > 0) {
      const batch = db.batch();
      detailEntries.forEach(([key, value]) => {
        const detailRef = db.collection('order_details').doc();
        batch.set(detailRef, {
          order_id: orderRef.id,
          field_name: key,
          field_value: String(value)
        });
      });
      await batch.commit();
    }

    res.status(201).json({ id: orderRef.id, message: 'تم إنشاء الطلب بنجاح' });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'خطأ في إنشاء الطلب' });
  }
});

// Update order
router.put('/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const orderDoc = await db.collection('orders').doc(id).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const order: any = orderDoc.data();

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id.toString()) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذا الطلب' });
    }

    // Only admin and employee can update basic order info
    if (['customer_name', 'customer_phone', 'address', 'service_type', 'assigned_to'].some(field => field in updates)) {
      if (req.user!.role === 'courier') {
        return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذه البيانات' });
      }
    }

    // Update order fields
    const allowedFields = ['customer_name', 'customer_phone', 'address', 'status', 'assigned_to'];
    const updatesToApply: any = { updated_at: firestoreHelpers.serverTimestamp() };

    allowedFields.forEach(field => {
      if (field in updates) {
        updatesToApply[field] = updates[field];
      }
    });

    if (Object.keys(updatesToApply).length > 1) { // More than just updated_at
      await db.collection('orders').doc(id).update(updatesToApply);
    }

    // Update order details
    if (updates.details) {
      const batch = db.batch();
      Object.entries(updates.details).forEach(([key, value]) => {
        // Delete existing detail
        db.collection('order_details')
          .where('order_id', '==', id)
          .where('field_name', '==', key)
          .get()
          .then((snapshot: admin.firestore.QuerySnapshot) => {
            snapshot.docs.forEach((doc: admin.firestore.QueryDocumentSnapshot) => batch.delete(doc.ref));
          });

        // Add new detail
        const detailRef = db.collection('order_details').doc();
        batch.set(detailRef, {
          order_id: id,
          field_name: key,
          field_value: String(value)
        });
      });
      await batch.commit();
    }

    res.json({ message: 'تم تحديث الطلب بنجاح' });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'خطأ في تحديث الطلب' });
  }
});

// Assign order to courier
router.post('/:id/assign', authenticateToken, requireRole('admin', 'employee'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { assigned_to } = req.body;

    if (!assigned_to) {
      return res.status(400).json({ error: 'يجب تحديد المندوب' });
    }

    await db.collection('orders').doc(id).update({
      assigned_to: assigned_to.toString(),
      status: 'assigned',
      updated_at: firestoreHelpers.serverTimestamp()
    });

    res.json({ message: 'تم تعيين الطلب للمندوب بنجاح' });
  } catch (error) {
    console.error('Assign order error:', error);
    res.status(500).json({ error: 'خطأ في تعيين الطلب' });
  }
});

// Update order status
router.post('/:id/status', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['preparing', 'assigned', 'in_delivery', 'delivered', 'device_received', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'حالة غير صحيحة' });
    }

    const orderDoc = await db.collection('orders').doc(id).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const order: any = orderDoc.data();

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id.toString()) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير حالة هذا الطلب' });
    }

    await db.collection('orders').doc(id).update({
      status,
      updated_at: firestoreHelpers.serverTimestamp()
    });

    res.json({ message: 'تم تحديث حالة الطلب بنجاح' });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'خطأ في تحديث الحالة' });
  }
});

// Courier receive order
router.post('/:id/receive', authenticateToken, requireRole('courier'), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const orderDoc = await db.collection('orders').doc(id).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const order: any = orderDoc.data();

    if (order.assigned_to !== req.user!.id.toString()) {
      return res.status(403).json({ error: 'هذا الطلب غير مخصص لك' });
    }

    let newStatus = 'in_delivery';
    if (order.service_type === 'receive_for_repair') {
      newStatus = 'in_delivery';
    }

    await db.collection('orders').doc(id).update({
      status: newStatus,
      updated_at: firestoreHelpers.serverTimestamp()
    });

    res.json({ message: 'تم استلام الطلب بنجاح' });
  } catch (error) {
    console.error('Receive order error:', error);
    res.status(500).json({ error: 'خطأ في تحديث الحالة' });
  }
});

// Add payment
router.post('/:id/payment', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'المبلغ غير صحيح' });
    }

    const orderDoc = await db.collection('orders').doc(id).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    const order: any = orderDoc.data();

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id.toString()) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لتسجيل الدفع لهذا الطلب' });
    }

    const paymentRef = await db.collection('order_payments').add({
      order_id: id,
      amount: parseFloat(amount),
      recorded_by: req.user!.id.toString(),
      payment_date: firestoreHelpers.serverTimestamp()
    });

    res.json({ message: 'تم تسجيل الدفع بنجاح', id: paymentRef.id });
  } catch (error) {
    console.error('Add payment error:', error);
    res.status(500).json({ error: 'خطأ في تسجيل الدفع' });
  }
});

export default router;

