# Guia de configuração — Firebase

Siga os passos abaixo para colocar o app online com login Google e dados na nuvem.
Tempo estimado: **15–20 minutos**.

---

## 1. Criar conta e projeto Firebase

1. Acesse https://console.firebase.google.com
2. Faça login com sua conta Google.
3. Clique em **"Criar um projeto"**.
4. Dê um nome (ex: `foco-tarefas`) e clique em **Continuar**.
5. Desative o Google Analytics se quiser (opcional) → **Criar projeto**.

---

## 2. Ativar autenticação com Google

1. No menu lateral, clique em **Authentication** → **Primeiros passos**.
2. Clique na aba **Método de login**.
3. Clique em **Google** → ative o toggle → salve o e-mail de suporte → **Salvar**.

---

## 3. Criar banco de dados (Firestore)

1. No menu lateral, clique em **Firestore Database** → **Criar banco de dados**.
2. Escolha **Modo de produção** → **Avançar**.
3. Escolha a região **southamerica-east1 (São Paulo)** → **Ativar**.

### Regras de segurança

Após criar, clique na aba **Regras** e cole o conteúdo abaixo, depois clique em **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Isso garante que cada usuário só acessa seus próprios dados.

---

## 4. Registrar o app web e pegar as credenciais

1. No menu lateral, clique no ícone **⚙️ Configurações do projeto** (engrenagem no topo).
2. Role a página até **"Seus apps"** → clique no ícone **`</>`** (web).
3. Dê um apelido (ex: `foco-web`) → clique em **Registrar app**.
4. Copie o objeto `firebaseConfig` que aparece:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "foco-tarefas.firebaseapp.com",
  projectId: "foco-tarefas",
  storageBucket: "foco-tarefas.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

5. Abra o arquivo **`firebase-config.js`** do app e cole os valores nos campos indicados.

---

## 5. Publicar o app (hospedagem)

### Opção A — Firebase Hosting (recomendado, gratuito)

1. Instale o Firebase CLI (requer Node.js):
   ```
   npm install -g firebase-tools
   ```
2. Na pasta do projeto, faça login:
   ```
   firebase login
   ```
3. Inicialize o hosting:
   ```
   firebase init hosting
   ```
   - Selecione o projeto criado
   - Public directory: `.` (ponto)
   - Single-page app: **N**
   - Overwrite index.html: **N**

4. Publique:
   ```
   firebase deploy --only hosting
   ```
5. Seu app estará em: `https://foco-tarefas.web.app`

---

### Opção B — Netlify (mais simples, sem CLI)

1. Acesse https://netlify.com e crie uma conta gratuita.
2. Arraste a **pasta inteira do app** para a área de deploy do Netlify.
3. Pronto — você recebe uma URL em segundos.
4. Você precisa adicionar o domínio Netlify nas origens autorizadas do Firebase:
   - Vá em **Firebase Console → Authentication → Settings → Domínios autorizados**.
   - Clique em **Adicionar domínio** e cole o domínio Netlify (ex: `meu-app.netlify.app`).

---

### Opção C — GitHub Pages

1. Crie um repositório público no GitHub.
2. Suba os arquivos do app para a branch `main`.
3. Vá em **Settings → Pages → Source → Deploy from branch → main / root**.
4. Adicione o domínio `SEU-USUARIO.github.io` nas origens autorizadas do Firebase (igual ao passo da Opção B).

---

## 6. Adicionar domínio local para desenvolvimento

Se quiser rodar localmente (sem publicar), adicione `http://localhost` e
`http://127.0.0.1` nas origens autorizadas:

**Firebase Console → Authentication → Settings → Domínios autorizados → Adicionar domínio**

Para servir localmente, use um servidor simples:
```
# Python 3
python -m http.server 8080

# Node.js (npx, sem instalação)
npx serve .
```
Depois acesse `http://localhost:8080`.

---

## Resumo dos arquivos

| Arquivo             | O que faz                                  |
|---------------------|--------------------------------------------|
| `index.html`        | Estrutura do app                           |
| `style.css`         | Design e tema (claro/escuro automático)    |
| `firebase-config.js`| **← Cole suas credenciais aqui**           |
| `app.js`            | Toda a lógica do aplicativo                |
| `FIREBASE-SETUP.md` | Este guia                                  |

---

## Dúvidas comuns

**"Firebase: Error (auth/unauthorized-domain)"**
→ Adicione o domínio onde está rodando em Authentication → Settings → Domínios autorizados.

**"Missing or insufficient permissions"**
→ Revise as regras do Firestore (passo 3).

**O app abre mas não salva dados**
→ Verifique se colou as credenciais corretamente no `firebase-config.js`.
