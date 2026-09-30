/* Registers the offline service worker when the game is served from a real
   web address (https or localhost). Opening index.html as a file skips it. */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* the game still works without it */ });
  });
}
