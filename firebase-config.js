// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyALLyOiOhZlrLSitXqyFmSPxYK5YzGIupk",
  authDomain: "foco-projeto.firebaseapp.com",
  projectId: "foco-projeto",
  storageBucket: "foco-projeto.firebasestorage.app",
  messagingSenderId: "856677777681",
  appId: "1:856677777681:web:503f820cefa8a422c20cb0",
  measurementId: "G-MCFBZEJH8Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
