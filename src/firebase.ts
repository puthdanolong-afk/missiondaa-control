import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  setPersistence,
  inMemoryPersistence
} from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, query, where, onSnapshot, updateDoc, deleteDoc, addDoc, getDocFromServer, orderBy } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// Import the Firebase configuration as a fallback
import firebaseAppletConfig from '../firebase-applet-config.json';

// Firebase configuration with environment variables and fallback to JSON config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseAppletConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseAppletConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseAppletConfig.storageBucket || `${firebaseAppletConfig.projectId}.appspot.com`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseAppletConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseAppletConfig.appId,
};

const firestoreDatabaseId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || firebaseAppletConfig.firestoreDatabaseId;

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firestoreDatabaseId);
export const auth = getAuth(app);

// Explicitly initialize storage with the bucket name to ensure it's using the correct one
const bucketName = firebaseConfig.storageBucket;
const storageBucketUrl = bucketName ? (bucketName.startsWith('gs://') ? bucketName : `gs://${bucketName}`) : undefined;
export const storage = getStorage(app, storageBucketUrl);

export const googleProvider = new GoogleAuthProvider();

// Secondary app for creating users without signing out the current admin
const secondaryApp = initializeApp(firebaseConfig, 'Secondary');
export const secondaryAuth = getAuth(secondaryApp);

// Set secondary auth to in-memory persistence to avoid session conflicts
setPersistence(secondaryAuth, inMemoryPersistence).catch(err => {
  console.error('Error setting secondary auth persistence:', err);
});

export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile
};

// Error handling for Firestore operations
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
    // Check for quota exhaustion
  if (errorMessage.includes('resource-exhausted') || errorMessage.includes('quota exceeded')) {
    let quotaMsg = "កម្រិតប្រើប្រាស់ឥតគិតថ្លៃរបស់ Firestore ត្រូវបានប្រើប្រាស់អស់ហើយ។ សូមរង់ចាំរហូតដល់ថ្ងៃស្អែកសម្រាប់ការកំណត់ឡើងវិញ។";
    
    if (errorMessage.includes('read units')) {
      quotaMsg = "កម្រិតនៃការអានទិន្នន័យឥតគិតថ្លៃ (Daily Read Units) របស់ Firestore ត្រូវបានប្រើប្រាស់អស់ហើយ។ សូមរង់ចាំរហូតដល់ថ្ងៃស្អែកសម្រាប់ការកំណត់ឡើងវិញ។";
    } else if (errorMessage.includes('write units')) {
      quotaMsg = "កម្រិតនៃការសរសេរទិន្នន័យឥតគិតថ្លៃ (Daily Write Units) របស់ Firestore ត្រូវបានប្រើប្រាស់អស់ហើយ។ សូមរង់ចាំរហូតដល់ថ្ងៃស្អែកសម្រាប់ការកំណត់ឡើងវិញ។";
    }

    console.error(quotaMsg);
    const quotaInfo: FirestoreErrorInfo = {
      error: quotaMsg,
      operationType,
      path,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      }
    };
    throw new Error(JSON.stringify(quotaInfo));
  }

  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Parses a Firestore error throw by handleFirestoreError and extracts the user-friendly message.
 */
export function getFirestoreErrorMessage(error: any): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(message);
    if (parsed && parsed.error) {
      return parsed.error;
    }
  } catch (e) {
    // Not a JSON error
  }
  return message;
}

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('resource-exhausted') || message.includes('quota')) {
      console.error("កម្រិតប្រើប្រាស់ឥតគិតថ្លៃ (Daily Quota) របស់ Firestore ត្រូវបានប្រើប្រាស់អស់ហើយ។ សូមរង់ចាំរហូតដល់ថ្ងៃស្អែកសម្រាប់ការបើកឡើងវិញ ឬប្តូរទៅគម្រោងបង់ប្រាក់។");
    } else if (message.includes('the client is offline') || message.includes('failed-precondition')) {
      console.error("មិនអាចភ្ជាប់ទៅកាន់ Firestore បានទេ។ សូមពិនិត្យមើលការកំណត់ Firebase របស់អ្នក ឬការភ្ជាប់អ៊ីនធឺណិត។");
    }
  }
}
testConnection();
