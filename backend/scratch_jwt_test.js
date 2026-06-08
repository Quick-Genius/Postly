const jwt = require('jsonwebtoken');
const env = require('./src/config/env');
const { signAccessToken, verifyAccessToken } = require('./src/utils/jwt');

try {
  console.log('jwtSecret:', env.jwtSecret);
  const token = signAccessToken('test-user-uuid');
  console.log('Signed token:', token);
  const payload = verifyAccessToken(token);
  console.log('Verified payload:', payload);
  if (payload.sub === 'test-user-uuid') {
    console.log('SUCCESS: Token signed and verified correctly!');
  } else {
    console.log('FAILURE: Payload sub mismatch.');
  }
} catch (err) {
  console.error('ERROR during signing/verification:', err);
}
