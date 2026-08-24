-- Update default admin and broken agent passwords to use the standardized PBKDF2 Web Crypto hash format
-- The password will be set to: admin123
UPDATE users 
SET password_hash = '263fb48d2eaa13e99bb0608667f96062:423f513c3516df4bf687546c3feda388e8283829acf7a2c6b86caa98cb95d043' 
WHERE password_hash NOT LIKE '%:%';
