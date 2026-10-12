import './app.css';
import App from './App.svelte';

// Load Space Grotesk for login page
const link = document.createElement('link');
link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap';
link.rel = 'stylesheet';
document.head.appendChild(link);

const app = new App({
  target: document.getElementById('app'),
});

export default app;
