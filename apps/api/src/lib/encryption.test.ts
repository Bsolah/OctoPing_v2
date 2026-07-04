import { decrypt, encrypt } from './encryption';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const plaintext = 'shpat_test_access_token_roundtrip';
const encrypted = encrypt(plaintext);
const decrypted = decrypt(encrypted);

assert(encrypted !== plaintext, 'Encrypted value should differ from plaintext');
assert(
  encrypted.split(':').length === 3,
  'Encrypted payload should have 3 parts',
);
assert(decrypted === plaintext, 'Decrypted value should match plaintext');

console.log('Encryption/decryption roundtrip passed');
