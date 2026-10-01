#!/usr/bin/env node
/**
 * screen-shot.mjs — Olhos da Luna na TELA da máquina (não só no Chrome).
 *
 * Captura GDI real de todos os monitores via PowerShell (CopyFromScreen +
 * SetProcessDPIAware p/ não quebrar com scaling/4K) e salva em .brain/peek/.
 * É o que o owner vê = é o que a Luna vê. Infalível p/ duvidar de qualquer UI.
 *
 * Uso:
 *   node scripts/screen-shot.mjs [--nome etiqueta]
 *
 * Limitações honestas: se a tela estiver bloqueada (Win+L) sai preto; se o app
 * alvo estiver minimizado, não aparece. Não injeta input, só olha.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.brain', 'peek');
fs.mkdirSync(SHOTS, { recursive: true });

const nomeIdx = process.argv.indexOf('--nome');
const label = (nomeIdx > -1 ? process.argv[nomeIdx + 1] : 'tela') || 'tela';
const safe = label.replace(/[^\w\-]+/g, '_').slice(0, 40);
const file = path.join(SHOTS, `screen-${safe}-${Date.now()}.png`);

const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DPI32 {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DPI32]::SetProcessDPIAware() | Out-Null
$Screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $Screen.Width, $Screen.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($Screen.Left, $Screen.Top, 0, 0, $bmp.Size)
$bmp.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "OK $($Screen.Width) x $($Screen.Height)"
`;

const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 30_000 });
if (!fs.existsSync(file)) { console.error('ERRO: arquivo não foi criado.', out); process.exit(1); }
console.log(out.trim());
console.log(`print: ${file}`);
