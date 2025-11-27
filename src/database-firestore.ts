import * as admin from 'firebase-admin';
import bcrypt from 'bcryptjs';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();

export async function initDatabase(): Promise<void> {
  try {
    // Check if admin user exists
    const usersRef = db.collection('users');
    const adminSnapshot = await usersRef.where('username', '==', 'admin').limit(1).get();

    if (adminSnapshot.empty) {
      // Create default admin user
      const defaultPassword = await bcrypt.hash('admin123', 10);
      await usersRef.add({
        username: 'admin',
        password: defaultPassword,
        full_name: 'المشرف الرئيسي',
        role: 'admin',
        phone: null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        is_active: true
      });
      console.log('Default admin user created');
    }

    console.log('Firestore database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Helper functions for Firestore operations
export const firestoreHelpers = {
  // Convert Firestore timestamp to Date
  timestampToDate: (timestamp: any): Date => {
    if (timestamp?.toDate) {
      return timestamp.toDate();
    }
    return new Date(timestamp);
  },

  // Convert Date to Firestore timestamp
  dateToTimestamp: (date: Date) => {
    return admin.firestore.Timestamp.fromDate(date);
  },

  // Server timestamp
  serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp()
};

