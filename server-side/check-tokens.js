
const fs = require("fs");
const path = require("path");

const origSrc = "E:/Unreal/A1workhouse/server-side/original-claude-code/src";
const currSrc = "E:/Unreal/A1workhouse/server-side/engine/src";

function getFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getFiles(filePath, fileList);
        } else if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

const origFiles = getFiles(origSrc);
let mismatchCount = 0;
let matchCount = 0;

for (const origFile of origFiles) {
    const relPath = path.relative(origSrc, origFile);
    const currFile = path.join(currSrc, relPath);
    
    if (!fs.existsSync(currFile)) continue;
    
    const origContent = fs.readFileSync(origFile, "utf8");
    const currContent = fs.readFileSync(currFile, "utf8");
    
    const origSeq = origContent.match(/\bCLAUDE_[A-Z0-9_]*\b/g) || [];
    const currSeq = currContent.match(/\bCLAUDE_[A-Z0-9_]*\b/g) || [];
    
    if (origSeq.length > 0 || currSeq.length > 0) {
        if (origSeq.length !== currSeq.length) {
            console.log(`Mismatch in ${relPath}: orig has ${origSeq.length}, curr has ${currSeq.length}`);
            mismatchCount++;
        } else {
            matchCount++;
        }
    }
}

console.log(`\nFiles with matching token counts: ${matchCount}`);
console.log(`Files with mismatched token counts: ${mismatchCount}`);

