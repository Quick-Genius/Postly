const BASE_STYLES = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #2c3e50;
    background: #f7f8fa;
    margin: 0;
    padding: 2rem 1rem;
  }
  .container {
    max-width: 760px;
    margin: 0 auto;
    background: #ffffff;
    padding: 2.5rem 2.25rem;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  h1 {
    font-size: 2rem;
    margin-top: 0;
    margin-bottom: 0.25rem;
    color: #1a1a1a;
  }
  h2 {
    font-size: 1.2rem;
    margin-top: 2rem;
    margin-bottom: 0.5rem;
    color: #1a1a1a;
    border-bottom: 1px solid #eee;
    padding-bottom: 0.25rem;
  }
  p, li { font-size: 1rem; }
  ul { padding-left: 1.25rem; }
  .meta { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  footer { margin-top: 2.5rem; font-size: 0.85rem; color: #888; text-align: center; }
`;

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="container">
    ${body}
    <footer>&copy; ${new Date().getFullYear()} &mdash; Student Project</footer>
  </div>
</body>
</html>`;
}

function getPrivacyPolicy(req, res) {
  const body = `
    <h1>Privacy Policy</h1>
    <p class="meta">Last updated: ${new Date().toISOString().slice(0, 10)}</p>

    <h2>1. Introduction</h2>
    <p>
      This application is a <strong>student project built for educational purposes</strong>.
      It is not a commercial product. This policy explains what limited information the
      service handles and how it is protected.
    </p>

    <h2>2. Data Collection</h2>
    <p>The service stores only what is strictly necessary to operate:</p>
    <ul>
      <li>OAuth access and refresh tokens for connected social accounts (encrypted at rest)</li>
      <li>Basic account identifiers (e.g. user ID, email, display name)</li>
      <li>Content you explicitly create or schedule through the app</li>
    </ul>

    <h2>3. Data Usage</h2>
    <ul>
      <li>Tokens and identifiers are used solely to publish content on your behalf to platforms you connect.</li>
      <li>We do not run analytics, profiling, advertising, or behavioral tracking.</li>
      <li>Your content is not used to train any machine learning models.</li>
    </ul>

    <h2>4. Data Storage &amp; Security</h2>
    <ul>
      <li>All OAuth tokens and user-supplied API keys are encrypted with <strong>AES-256-GCM</strong> before storage.</li>
      <li>No plaintext sensitive credentials are persisted in the database or logs.</li>
      <li>Transport is secured with HTTPS in production.</li>
    </ul>

    <h2>5. Third-Party Services</h2>
    <p>This project may forward data to the following providers strictly to fulfill user-initiated actions:</p>
    <ul>
      <li><strong>OpenAI</strong> &mdash; AI content generation</li>
      <li><strong>Anthropic</strong> &mdash; AI content generation</li>
      <li><strong>Groq</strong> &mdash; AI content generation (if enabled)</li>
      <li><strong>Twilio</strong> &mdash; WhatsApp messaging delivery</li>
      <li><strong>Telegram</strong> &mdash; bot messaging delivery</li>
      <li>Connected social platforms (e.g. Twitter/X, LinkedIn) for publishing</li>
    </ul>
    <p>Each provider operates under its own privacy policy.</p>

    <h2>6. Data Sharing</h2>
    <p>
      We do <strong>not</strong> sell, rent, or share your data with third parties for marketing or
      any purpose unrelated to operating the service.
    </p>

    <h2>7. User Control</h2>
    <ul>
      <li>You may disconnect any connected social account at any time, which revokes and deletes the stored tokens.</li>
      <li>You may request deletion of your account and associated data by contacting us.</li>
    </ul>

    <h2>8. Contact</h2>
    <p>
      Questions about this policy can be sent to
      <a href="mailto:singhharshgood@gmail.com">singhharshgood@gmail.com</a>.
    </p>
  `;
  res.type('html').send(page('Privacy Policy', body));
}

function getTerms(req, res) {
  const body = `
    <h1>Terms of Service</h1>
    <p class="meta">Last updated: ${new Date().toISOString().slice(0, 10)}</p>

    <h2>1. Acceptance</h2>
    <p>
      This service is a student project provided for educational and demonstration purposes.
      By using it, you agree to these terms.
    </p>

    <h2>2. Use of the Service</h2>
    <ul>
      <li>You must own or have permission to publish any content you submit.</li>
      <li>You agree not to use the service for unlawful, abusive, or spam activity.</li>
      <li>You are responsible for the content posted to your connected accounts.</li>
    </ul>

    <h2>3. No Warranty</h2>
    <p>
      The service is provided <strong>"as is"</strong> without warranty of any kind.
      Availability, correctness, and delivery to third-party platforms are not guaranteed.
    </p>

    <h2>4. Limitation of Liability</h2>
    <p>
      The author(s) are not liable for any direct, indirect, or consequential damages arising
      from use of the service.
    </p>

    <h2>5. Termination</h2>
    <p>Access may be suspended or terminated at any time, especially in the case of misuse.</p>

    <h2>6. Contact</h2>
    <p>
      Questions can be sent to
      <a href="singhharshgood@gmail.com">singhharshgood@gmail.com</a>.
    </p>
  `;
  res.type('html').send(page('Terms of Service', body));
}

module.exports = { getPrivacyPolicy, getTerms };
