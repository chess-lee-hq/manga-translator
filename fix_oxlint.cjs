const fs = require('fs');

// 1. Fix gemini.ts catch(e) -> catch(_e) or just remove e
let geminiCode = fs.readFileSync('src/lib/gemini.ts', 'utf8');
geminiCode = geminiCode.replace(/catch\(e\) \{\}/g, 'catch(e) { /* ignore */ }');
// Wait, if no-unused-vars complains, we should use _e or just catch {} (ES2019 allows omitted catch binding)
geminiCode = geminiCode.replace(/catch\(e\)/g, 'catch(_e)'); // or just catch {
// let's do catch {
geminiCode = geminiCode.replace(/catch\(_e\) \{ \/\* ignore \*\/ \}/g, 'catch { /* ignore */ }');
geminiCode = geminiCode.replace(/catch\(_e\) \{\}/g, 'catch {}');
fs.writeFileSync('src/lib/gemini.ts', geminiCode);

// 2. Fix yolo.ts 0 * numCols
let yoloCode = fs.readFileSync('src/lib/yolo.ts', 'utf8');
yoloCode = yoloCode.replace(/data\[0 \* numCols \+ col\]/g, 'data[col]'); // 0 * numCols is 0
fs.writeFileSync('src/lib/yolo.ts', yoloCode);

