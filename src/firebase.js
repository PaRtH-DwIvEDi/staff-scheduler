import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDRT6sVgu9gUKH3RXH6kZfBs4jvSD3nNVI",
  authDomain: "staff-scheduler-50e22.firebaseapp.com",
  projectId: "staff-scheduler-50e22",
  storageBucket: "staff-scheduler-50e22.firebasestorage.app",
  messagingSenderId: "894618386064",
  appId: "1:894618386064:web:07e2c9ce1eb427284ce215"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);