const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const examplePath = path.join(__dirname, '.env.example');

function generateSecret() {
    return crypto.randomBytes(32).toString('hex');
}

let envContent = '';

if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
} else if (fs.existsSync(examplePath)) {
    envContent = fs.readFileSync(examplePath, 'utf8');
} else {
    // Create basic .env content if neither exists
    console.log('.env not found, creating new one...');
    envContent = 'PORT=7575\nNODE_ENV=development\nDB_PATH=./data/neostream.db\nBASE_URL=http://localhost:7575\n';
}

const secret = generateSecret();
const regex = /SESSION_SECRET=.*/;

if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `SESSION_SECRET=${secret}`);
} else {
    envContent += `\nSESSION_SECRET=${secret}`;
}

fs.writeFileSync(envPath, envContent);
console.log('✅ New SESSION_SECRET generated and saved to .env');
