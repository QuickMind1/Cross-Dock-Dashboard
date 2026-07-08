import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA-hCb_di_Xi4QiNmIns1mdVp0KQGe3eGc",
  authDomain: "crossdock-bce69.firebaseapp.com",
  projectId: "crossdock-bce69",
  storageBucket: "crossdock-bce69.firebasestorage.app",
  messagingSenderId: "2268808257",
  appId: "1:2268808257:web:2db3e6aad59e2d67c5f2c0",
  measurementId: "G-9R77W6DE9W"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const loginForm = document.getElementById('loginForm');
const dashboardBody = document.getElementById('dashboardBody');

const isLoginPage = loginForm !== null;
const isDashboardPage = dashboardBody !== null;

onAuthStateChanged(auth, (user) => {
    if (user) {
        if (isLoginPage) {
            window.location.href = "dashboard.html";
        } else if (isDashboardPage) {
            document.getElementById('dashboardBody').classList.remove('hidden');
            document.getElementById('userDisplay').textContent = user.email;
        }
    } else {
        if (isDashboardPage) {
            window.location.href = "./";
        }
    }
});

if (isLoginPage) {
    const signupForm = document.getElementById('signupForm');
    const loginForm = document.getElementById('loginForm');
    const tabLogin = document.getElementById('tabLogin');
    const tabSignup = document.getElementById('tabSignup');
    const formTitle = document.getElementById('formTitle');
    const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
    const errorMsg = document.getElementById('errorMessage');
    const successMsg = document.getElementById('successMessage');

    tabLogin.addEventListener('click', () => {
        loginForm.classList.remove('hidden');
        console.log('Sign up tab pressed');
        signupForm.classList.add('hidden');

        tabLogin.classList.remove('text-gray-500');
        tabLogin.classList.add('text-primary', 'border-b-2', 'border-primary');
        tabSignup.classList.remove('text-primary', 'border-b-2', 'border-primary');
        tabSignup.classList.add('text-gray-500');

        formTitle.textContent = "Qué gusto volver a verte";
        errorMsg.classList.add('hidden');
        successMsg.classList.add('hidden');
    })

    tabSignup.addEventListener('click', () => {
        console.log('Sign up tab pressed');
        loginForm.classList.add('hidden');
        signupForm.classList.remove('hidden');

        tabSignup.classList.add('text-primary', 'border-b-2', 'border-primary');
        tabSignup.classList.remove('text-gray-500');
        tabLogin.classList.remove('text-primary', 'border-b-2', 'border-primary');
        tabLogin.classList.add('text-gray-500');

        formTitle.textContent = "Crea una cuenta";
        errorMsg.classList.add('hidden');
        successMsg.classList.add('hidden');
    })
    
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        errorMsg.classList.add('hidden');
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        signInWithEmailAndPassword(auth, email, password)
            .catch((error) => {
                errorMsg.textContent = "Correo electrónico o contraseña incorrectos.";
                errorMsg.classList.remove('hidden');
            });
    });

    signupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        errorMsg.classList.add('hidden');

        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        const confirmPassword = document.getElementById('signupConfirmPassword').value;

        if (password !== confirmPassword) {
            errorMsg.textContent = "Las contraseñas no coinciden";
            errorMsg.classList.remove('hidden');
            return;
        }

        createUserWithEmailAndPassword(auth, email, password)
            .then((userCredential) => {})
            .catch((error) => {
                errorMsg.textContent = "Error: " + error.message.replace('Firebase: ', '');
                errorMsg.classList.remove('hidden');
            })
    })

    forgotPasswordBtn.addEventListener('click', (e) => {
        console.log("Pressed");
        e.preventDefault();
        errorMsg.classList.add('hidden');
        successMsg.classList.add('hidden');

        const email = document.getElementById('email').value;
        if(!email) {
            errorMsg.textContent = "Por favor, escribe primero tu dirección de correo electrónico en el campo de arriba y, a continuación, haz clic en «¿No recuerdas la contraseña?».";
            errorMsg.classList.remove('hidden');
            return;
        }

        sendPasswordResetEmail(auth, email)
            .then(() => {
                successMsg.textContent = "¡Ya te hemos enviado el correo electrónico para restablecer la contraseña! Comprueba tu bandeja de entrada (y también spam).";
                successMsg.classList.remove('hidden');
            })
            .catch((error) => {
                errorMsg.textContent = "Se ha producido un error al enviar el correo electrónico de restablecimiento. Asegúrate de que la dirección de correo electrónico es correcta.";
                errorMsg.classList.remove('hidden');
            });
    });
}

if (isDashboardPage) {
    document.getElementById('logoutBtn').addEventListener('click', () => {
        signOut(auth).then(() => {});
    });
}