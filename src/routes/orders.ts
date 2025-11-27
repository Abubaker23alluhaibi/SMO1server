import express from 'express';
import { db } from '../database';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';

const router = express.Router();

// Get all orders (with filters)
router.get('/', authenticateToken, (req: AuthRequest, res) => {
  const { status, service_type, assigned_to, search, courier_id } = req.query;
  let query = `
    SELECT o.*, 
           u1.full_name as assigned_to_name,
           u2.full_name as created_by_name
    FROM orders o
    LEFT JOIN users u1 ON o.assigned_to = u1.id
    LEFT JOIN users u2 ON o.created_by = u2.id
    WHERE 1=1
  `;
  const params: any[] = [];

  // If courier user, only show their orders
  if (req.user!.role === 'courier') {
    query += ' AND o.assigned_to = ?';
    params.push(req.user!.id);
  }

  if (status) {
    query += ' AND o.status = ?';
    params.push(status);
  }

  if (service_type) {
    query += ' AND o.service_type = ?';
    params.push(service_type);
  }

  if (assigned_to && req.user!.role !== 'courier') {
    query += ' AND o.assigned_to = ?';
    params.push(assigned_to);
  }

  if (courier_id && req.user!.role === 'admin') {
    query += ' AND o.assigned_to = ?';
    params.push(courier_id);
  }

  if (search) {
    query += ' AND (o.customer_name LIKE ? OR o.customer_phone LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm);
  }

  query += ' ORDER BY o.created_at DESC';

  db.all(query, params, (err, orders: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في جلب الطلبات' });
    }

    // Get order details for each order
    const orderIds = orders.map((o: any) => o.id);
    if (orderIds.length === 0) {
      return res.json([]);
    }

    db.all(
      `SELECT * FROM order_details WHERE order_id IN (${orderIds.map(() => '?').join(',')})`,
      orderIds,
      (err, details: any) => {
        if (err) {
          return res.status(500).json({ error: 'خطأ في جلب تفاصيل الطلبات' });
        }

        // Group details by order_id
        const detailsMap: any = {};
        details.forEach((d: any) => {
          if (!detailsMap[d.order_id]) {
            detailsMap[d.order_id] = {};
          }
          detailsMap[d.order_id][d.field_name] = d.field_value;
        });

        // Attach details to orders
        const ordersWithDetails = orders.map((order: any) => ({
          ...order,
          details: detailsMap[order.id] || {}
        }));

        res.json(ordersWithDetails);
      }
    );
  });
});

// Get single order
router.get('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  db.get(
    `SELECT o.*, 
            u1.full_name as assigned_to_name,
            u2.full_name as created_by_name
     FROM orders o
     LEFT JOIN users u1 ON o.assigned_to = u1.id
     LEFT JOIN users u2 ON o.created_by = u2.id
     WHERE o.id = ?`,
    [id],
    (err, order: any) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في جلب الطلب' });
      }

      if (!order) {
        return res.status(404).json({ error: 'الطلب غير موجود' });
      }

      // Check permissions for courier users
      if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id) {
        return res.status(403).json({ error: 'ليس لديك صلاحية لعرض هذا الطلب' });
      }

      // Get order details
      db.all(
        'SELECT * FROM order_details WHERE order_id = ?',
        [id],
        (err, details: any) => {
          if (err) {
            return res.status(500).json({ error: 'خطأ في جلب تفاصيل الطلب' });
          }

          const detailsObj: any = {};
          details.forEach((d: any) => {
            detailsObj[d.field_name] = d.field_value;
          });

          // Get images
          db.all(
            'SELECT * FROM order_images WHERE order_id = ? ORDER BY uploaded_at DESC',
            [id],
            (err, images: any) => {
              if (err) {
                return res.status(500).json({ error: 'خطأ في جلب الصور' });
              }

              // Get signature
              db.get(
                'SELECT * FROM order_signatures WHERE order_id = ? ORDER BY signed_at DESC LIMIT 1',
                [id],
                (err, signature: any) => {
                  if (err) {
                    return res.status(500).json({ error: 'خطأ في جلب التوقيع' });
                  }

                  // Get payments
                  db.all(
                    'SELECT * FROM order_payments WHERE order_id = ? ORDER BY payment_date DESC',
                    [id],
                    (err, payments: any) => {
                      if (err) {
                        return res.status(500).json({ error: 'خطأ في جلب المدفوعات' });
                      }

                      res.json({
                        ...order,
                        details: detailsObj,
                        images: images || [],
                        signature: signature || null,
                        payments: payments || []
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
});

// Create new order
router.post('/', authenticateToken, requireRole('admin', 'employee'), (req: AuthRequest, res) => {
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
    // If courier is assigned, set status to 'assigned'
    status = 'assigned';
    finalAssignedTo = assigned_to;
  }

  db.run(
    `INSERT INTO orders (customer_name, customer_phone, address, service_type, status, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [customer_name, customer_phone, address, service_type, status, finalAssignedTo, req.user!.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'خطأ في إنشاء الطلب' });
      }

      const orderId = this.lastID;

      // Save order details
      const detailEntries = Object.entries(details).filter(([_, v]) => v !== null && v !== undefined);
      if (detailEntries.length > 0) {
        const stmt = db.prepare('INSERT INTO order_details (order_id, field_name, field_value) VALUES (?, ?, ?)');
        detailEntries.forEach(([key, value]) => {
          stmt.run(orderId, key, String(value));
        });
        stmt.finalize();
      }

      res.status(201).json({ id: orderId, message: 'تم إنشاء الطلب بنجاح' });
    }
  );
});

// Update order
router.put('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Check if order exists and user has permission
  db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    }

    if (!order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id) {
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
    const updatesToApply: any = {};
    allowedFields.forEach(field => {
      if (field in updates) {
        updatesToApply[field] = updates[field];
      }
    });

    if (Object.keys(updatesToApply).length > 0) {
      const setClause = Object.keys(updatesToApply).map(f => `${f} = ?`).join(', ');
      const values = Object.values(updatesToApply);
      values.push(id);

      db.run(
        `UPDATE orders SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values,
        (err) => {
          if (err) {
            return res.status(500).json({ error: 'خطأ في تحديث الطلب' });
          }
        }
      );
    }

    // Update order details
    if (updates.details) {
      Object.entries(updates.details).forEach(([key, value]) => {
        db.run(
          `INSERT OR REPLACE INTO order_details (order_id, field_name, field_value)
           VALUES (?, ?, ?)`,
          [id, key, String(value)]
        );
      });
    }

    res.json({ message: 'تم تحديث الطلب بنجاح' });
  });
});

// Assign order to courier
router.post('/:id/assign', authenticateToken, requireRole('admin', 'employee'), (req: AuthRequest, res) => {
  const { id } = req.params;
  const { assigned_to } = req.body;

  if (!assigned_to) {
    return res.status(400).json({ error: 'يجب تحديد المندوب' });
  }

  db.run(
    'UPDATE orders SET assigned_to = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [assigned_to, 'assigned', id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'خطأ في تعيين الطلب' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'الطلب غير موجود' });
      }
      res.json({ message: 'تم تعيين الطلب للمندوب بنجاح' });
    }
  );
});

// Update order status
router.post('/:id/status', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['preparing', 'assigned', 'in_delivery', 'delivered', 'device_received', 'cancelled'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صحيحة' });
  }

  db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    }

    if (!order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لتغيير حالة هذا الطلب' });
    }

    db.run(
      'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'خطأ في تحديث الحالة' });
        }
        res.json({ message: 'تم تحديث حالة الطلب بنجاح' });
      }
    );
  });
});

// Courier receive order
router.post('/:id/receive', authenticateToken, requireRole('courier'), (req: AuthRequest, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    }

    if (!order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    if (order.assigned_to !== req.user!.id) {
      return res.status(403).json({ error: 'هذا الطلب غير مخصص لك' });
    }

    // Determine status based on service type
    let newStatus = 'in_delivery';
    if (order.service_type === 'receive_for_repair') {
      newStatus = 'in_delivery'; // Will be changed to device_received when completed
    }

    db.run(
      'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newStatus, id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'خطأ في تحديث الحالة' });
        }
        res.json({ message: 'تم استلام الطلب بنجاح' });
      }
    );
  });
});

// Add payment
router.post('/:id/payment', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'المبلغ غير صحيح' });
  }

  db.get('SELECT * FROM orders WHERE id = ?', [id], (err, order: any) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
    }

    if (!order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    // Check permissions
    if (req.user!.role === 'courier' && order.assigned_to !== req.user!.id) {
      return res.status(403).json({ error: 'ليس لديك صلاحية لتسجيل الدفع لهذا الطلب' });
    }

    db.run(
      'INSERT INTO order_payments (order_id, amount, recorded_by) VALUES (?, ?, ?)',
      [id, amount, req.user!.id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'خطأ في تسجيل الدفع' });
        }
        res.json({ message: 'تم تسجيل الدفع بنجاح', id: this.lastID });
      }
    );
  });
});

export default router;




