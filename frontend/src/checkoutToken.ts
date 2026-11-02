/**
 * This browser's checkout token: a random value kept in local storage and
 * sent with each checkout, so that retrying after leaving the payment page
 * releases the earlier hold at once instead of waiting for it to time out.
 * The server stores only a hash of it. It identifies nothing about the person
 * and is never sent anywhere else, so it is not a tracking cookie.
 */
const KEY = 'cd_checkout_token';
let memory: string | null = null;

function fresh(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function checkoutToken(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[a-f0-9]{32,64}$/.test(saved)) return saved;
    const token = fresh();
    localStorage.setItem(KEY, token);
    return token;
  } catch {
    // Storage blocked (private mode): keep one for this page's lifetime.
    memory ??= fresh();
    return memory;
  }
}
