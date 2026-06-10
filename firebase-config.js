import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, deleteDoc,
         onSnapshot, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyALLyOiOhZlrLSitXqyFmSPxYK5YzGIupk",
  authDomain:        "foco-projeto.firebaseapp.com",
  projectId:         "foco-projeto",
  storageBucket:     "foco-projeto.firebasestorage.app",
  messagingSenderId: "856677777681",
  appId:             "1:856677777681:web:503f820cefa8a422c20cb0"
};

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

export { auth, db, provider, GoogleAuthProvider, signInWithPopup, signOut,
         onAuthStateChanged, collection, doc, setDoc, getDoc, deleteDoc,
         onSnapshot, query, where };
