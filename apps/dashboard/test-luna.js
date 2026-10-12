const { spawn, exec } = require('child_process');
const path = require('path');

console.log("=== TESTE DO BLOCO LUNA ===");

// Testar spawn
const p = spawn('node', ['agents/luna-scheduler.mjs', '--force-scan'], {
    cwd: path.join(__dirname, '..'),
    detached: true,
    stdio: 'ignore',
    windowsHide: true
});
console.log("Spawn PID:", p.pid);

// Testar exec
exec('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', (err, stdout) => {
    if (err) {
        console.log("Exec erro:", err.message);
    } else {
        console.log("Exec OK, linhas:", stdout.split('\n').length);
    }
});

setTimeout(() => {
    console.log("=== TESTE COMPLETO ===");
    process.exit(0);
}, 3000);
