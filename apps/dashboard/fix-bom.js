// ═══════════════════════════════════════════════════════════════════
// SCRIPT: REMOVE BOM + BACKUP — NEXO DASHBOARD PRO
// Seguro, com backup automático, em Node.js
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(__dirname, 'data', '.backup-bom-fix');

console.log('\n🔧 NEXO BOM FIX + BACKUP');
console.log('📁 Data dir:', DATA_DIR);
console.log('💾 Backup dir:', BACKUP_DIR);

// Criar pasta backup invisível (com ponto no nome)
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  console.log('✅ Pasta .backup-bom-fix criada\n');
}

// Função: verificar se tem BOM
function hasBOM(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
}

// Função: fazer backup
function backupFile(filePath, fileName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${fileName}.${timestamp}.bak`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  fs.copyFileSync(filePath, backupPath);
  return backupName;
}

// Função: remover BOM
function removeBOM(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (!hasBOM(buffer)) {
    return { hadBOM: false, size: buffer.length };
  }

  // Fazer backup ANTES de modificar
  const fileName = path.basename(filePath);
  const backupName = backupFile(filePath, fileName);

  // Remover BOM (3 primeiros bytes)
  const cleanBuffer = buffer.slice(3);
  fs.writeFileSync(filePath, cleanBuffer);

  return { 
    hadBOM: true, 
    oldSize: buffer.length, 
    newSize: cleanBuffer.length,
    backup: backupName
  };
}

// Escanear todos os JSON
const jsonFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => path.join(DATA_DIR, f));

// Também escanear subpastas
const subDirs = ['schema', 'config', 'runtime'];
subDirs.forEach(dir => {
  const dirPath = path.join(DATA_DIR, dir);
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.json'))
      .map(f => path.join(dirPath, f));
    jsonFiles.push(...files);
  }
});

console.log(`📊 Total de arquivos JSON encontrados: ${jsonFiles.length}\n`);

let fixedCount = 0;
let okCount = 0;

jsonFiles.forEach(filePath => {
  const fileName = path.relative(DATA_DIR, filePath);
  const result = removeBOM(filePath);

  if (result.hadBOM) {
    console.log(`🩹 FIX: ${fileName}`);
    console.log(`   BOM removido: ${result.oldSize} → ${result.newSize} bytes`);
    console.log(`   Backup: .backup-bom-fix/${result.backup}`);
    fixedCount++;
  } else {
    console.log(`✅ OK:  ${fileName} (${result.size} bytes)`);
    okCount++;
  }
});

console.log('\n═══════════════════════════════════════');
console.log(`✅ Total OK:     ${okCount}`);
console.log(`🩹 Total FIX:    ${fixedCount}`);
console.log(`📊 Total:        ${jsonFiles.length}`);
console.log('═══════════════════════════════════════');

if (fixedCount > 0) {
  console.log('\n⚠️  REINICIE O BACKEND:');
  console.log('   1. Ctrl+C no terminal do backend');
  console.log('   2. node server.js');
  console.log('\n🧪 TESTE APÓS REINICIAR:');
  console.log('   curl http://localhost:3456/api/quotes');
  console.log('   curl http://localhost:3456/api/payments');
  console.log('   curl http://localhost:3456/api/tasks');
}

console.log('\n💾 Backups salvos em: data/.backup-bom-fix/');
console.log('   (pasta oculta, não aparece no Explorer comum)\n');
