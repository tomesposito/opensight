/* Dark rollout: no existing site CTA points here. Keys/origin are deploy config. */
(() => {
  const form = document.getElementById('signup-form'), status = document.getElementById('signup-status');
  const submit = document.getElementById('signup-submit'), resend = document.getElementById('signup-resend');
  const api = document.querySelector('meta[name="signup-api-origin"]').content;
  const key = document.querySelector('meta[name="signup-challenge-site-key"]').content;
  let challengeToken = '', timer, generation = 0, slugEdited = false, pending = false;
  const slug = document.getElementById('slug'), name = document.getElementById('ws'), availability = document.getElementById('slug-status');
  const messages = { SIGNUP_RATE_LIMITED: 'Too many attempts. Please try again in an hour.', SIGNUP_PERMANENT_EMAIL_REQUIRED: 'Use a work or permanent email address to start a trial.', SIGNUP_CHALLENGE_REQUIRED: 'Please complete the verification challenge.', RESOURCE_NOT_FOUND: 'Self-serve signup is not open yet. Talk to us to request hosted access.' };
  async function request(path, body) {
    const response = await fetch(api + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'omit', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(messages[result.errorCode] || 'Signup is unavailable. Please try again later or talk to us.');
    return result;
  }
  function checkSlug() {
    clearTimeout(timer); const revision = ++generation; availability.textContent = '';
    if (!slug.value || !slug.checkValidity()) return;
    timer = setTimeout(async () => { try { const result = await request('/api/signup/slug?slug=' + encodeURIComponent(slug.value)); if (revision === generation) availability.textContent = result.available ? `${slug.value} is available` : 'That workspace name is already in use.'; } catch (e) { if (revision === generation) availability.textContent = e.message; } }, 650);
  }
  slug.addEventListener('input', () => { slugEdited = true; checkSlug(); });
  name.addEventListener('input', () => { if (!slugEdited) { slug.value = name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, ''); checkSlug(); } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (pending || !challengeToken) return; pending = true; submit.disabled = true;
    try { const data = Object.fromEntries(new FormData(form)); const result = await request('/api/signup', { ...data, challengeToken }); status.textContent = result.message; resend.hidden = false; }
    catch (e) { status.textContent = e.message; }
    finally { pending = false; challengeToken = ''; window.turnstile?.reset(); }
  });
  resend.addEventListener('click', async () => {
    if (pending) return; pending = true; resend.disabled = true;
    try { const result = await request('/api/signup/resend', { email: document.getElementById('email').value }); status.textContent = result.message; }
    catch (e) { status.textContent = e.message; } finally { pending = false; resend.disabled = false; }
  });
  if (!key) { status.textContent = 'Self-serve signup is not open yet. Talk to us to request hosted access.'; return; }
  window.opensightSignupChallenge = () => window.turnstile.render('#signup-challenge', { sitekey: key, action: 'signup', callback: token => { challengeToken = token; submit.disabled = false; }, 'expired-callback': () => { challengeToken = ''; submit.disabled = true; } });
  const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=opensightSignupChallenge&render=explicit'; script.async = true; document.head.appendChild(script);
})();
