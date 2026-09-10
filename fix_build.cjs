const fs = require('fs');

let code = fs.readFileSync('src/lib/readingOrder.ts', 'utf8');

const target = `    // 상대적 임계값: 두 상자 평균 높이의 1/3 (상수화)
    const TIER_THRESHOLD_RATIO = 3; 
    const threshold = (curr.height + prev.height) / (2 * (TIER_THRESHOLD_RATIO / 2)); 
    // 즉, (curr.height + prev.height) / 3 과 동일

    if (yDiff <= (curr.height + prev.height) / 3) {`;

const repl = `    // 상대적 임계값: 두 상자 평균 높이의 1/3 (상수화)
    const TIER_THRESHOLD_RATIO = 3; 
    const threshold = (curr.height + prev.height) / TIER_THRESHOLD_RATIO;

    if (yDiff <= threshold) {`;

code = code.replace(target, repl);
fs.writeFileSync('src/lib/readingOrder.ts', code);

