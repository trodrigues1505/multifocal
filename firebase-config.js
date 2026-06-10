// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DO FIREBASE
// Siga o guia FIREBASE-SETUP.md para obter esses valores.
// Cole os valores do seu projeto aqui e salve o arquivo.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, deleteDoc,
         onSnapshot, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ▼▼▼  PREENCHA COM AS CREDENCIAIS DO SEU PROJETO FIREBASE  ▼▼▼
const firebaseConfig = {
  apiKey:            "COLE_AQUI_apiKey",
  authDomain:        "COLE_AQUI_authDomain",
  projectId:         "COLE_AQUI_projectId",
  storageBucket:     "COLE_AQUI_storageBucket",
  messagingSenderId: "COLE_AQUI_messagingSenderId",
  appId:             "COLE_AQUI_appId"
};
// ▲▲▲  FIM DAS CREDENCIAIS  ▲▲▲

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

export { auth, db, provider, GoogleAuthProvider, signInWithPopup, signOut,
         onAuthStateChanged, collection, doc, setDoc, getDoc, deleteDoc,
         onSnapshot, query, where };
