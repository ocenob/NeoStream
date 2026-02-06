const fs = require('fs');
const path = require('path');

const dir = 'j:/neostream/data';
const searchStr = 'LATIN';

const files = fs.readdirSync(dir);
files.forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath);
        if (content.includes(Buffer.from(searchStr, 'utf8')) || content.includes(Buffer.from(searchStr, 'utf16le'))) {
            console.log(`FOUND '${searchStr}' in file: ${fullPath}`);
        }
    }
});
