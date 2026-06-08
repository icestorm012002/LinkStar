const fs = require('fs');
const path = require('path');

const origSrc = 'E:/Unreal/A1workhouse/server-side/original-claude-code/src';
const currSrc = 'E:/Unreal/A1workhouse/server-side/engine/src';

function getFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getFiles(filePath, fileList);
        } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

const origFiles = getFiles(origSrc);
let fixedFiles = 0;
let tokenReplaced = 0;

for (const origFile of origFiles) {
    const relPath = path.relative(origSrc, origFile);
    const currFile = path.join(currSrc, relPath);
    
    if (!fs.existsSync(currFile)) continue;
    
    const origContent = fs.readFileSync(origFile, 'utf8');
    let currContent = fs.readFileSync(currFile, 'utf8');
    
    const origSeq = origContent.match(/\bCLAUDE_[a-zA-Z0-9_]*\b/g) || [];
    const currSeq = currContent.match(/\bCLAUDE_[a-zA-Z0-9_]*\b/g) || [];
    
    if (origSeq.length > 0 && origSeq.length === currSeq.length) {
        let changed = false;
        let replaceIndex = 0;
        
        currContent = currContent.replace(/\bCLAUDE_[a-zA-Z0-9_]*\b/g, (match) => {
            const expected = origSeq[replaceIndex++];
            if (match !== expected) {
                changed = true;
                tokenReplaced++;
                return expected;
            }
            return match;
        });
        
        if (changed) {
            fs.writeFileSync(currFile, currContent, 'utf8');
            fixedFiles++;
            console.log(`Fixed ${relPath}`);
        }
    } else if (origSeq.length !== currSeq.length) {
        console.log(`Mismatch in ${relPath}: orig ${origSeq.length}, curr ${currSeq.length}. Skipping.`);
    }
}

console.log(`\nFixed ${tokenReplaced} tokens across ${fixedFiles} files.`);
