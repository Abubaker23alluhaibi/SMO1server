import * as functions from 'firebase-functions';
import express from 'express';
import cors from 'cors';
import { initDatabase } from './database-firestore';
import authRoutes from './routes/auth-firestore';
import orderRoutes from './routes/orders-firestore';
import userRoutes from './routes/users-firestore';
import uploadRoutes from './routes/upload-firestore';

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/auth', authRoutes);
app.use('/orders', orderRoutes);
app.use('/users', userRoutes);
app.use('/upload', uploadRoutes);

// Health check
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', message: 'نظام إدارة التوصيل API' });
});

// Initialize database
initDatabase().catch((error) => {
  console.error('Failed to initialize database:', error);
});

// Export as Cloud Function
export const api = functions.https.onRequest(async (request: functions.https.Request, response: functions.Response) => {
  // Initialize database on each request (it's idempotent)
  try {
    await initDatabase();
  } catch (error) {
    console.error('Database initialization error:', error);
  }
  return app(request, response);
});
