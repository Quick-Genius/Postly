export function setCookie(name: string, value: string, days?: number) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = "; expires=" + date.toUTCString();
  }
  // SameSite=Lax is default; Secure is recommended for HTTPS
  const isSecure = window.location.protocol === 'https:';
  document.cookie = `${name}=${value || ""}${expires}; path=/; SameSite=Lax${isSecure ? '; Secure' : ''}`;
}

export function getCookie(name: string): string | null {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}

export function removeCookie(name: string) {
  const isSecure = window.location.protocol === 'https:';
  document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax${isSecure ? '; Secure' : ''}`;
}
