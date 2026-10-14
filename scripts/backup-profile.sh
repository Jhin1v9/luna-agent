#!/usr/bin/env bash
# Backup versionado do perfil Chrome dedicado do WhatsPlay (~/.luna/chrome-whatsapp).
#
# A sessão do WhatsApp Web vive no PRÓPRIO perfil (localStorage/IndexedDB +
# credenciais em "Default/") — o caminho certo de "auto save do login" é
# copiar este perfil, NUNCA cookies de outro navegador (ADR-032).
#
# - Exclui caches grandes e regeneráveis (Cache/, Code Cache/, GPUCache/ etc.)
# - robocopy lê arquivos abertos pelo Chrome sem derrubá-lo (cópia quente)
# - Mantém os últimos KEEP backups
# - Restore: parar whatsplay, trocar a pasta, subir (protocolo no ADR-032)
#
# Uso: bash scripts/backup-profile.sh   (watchdog roda 1x/dia + pós-heal)

set -u

# O watchdog herda MSYS_NO_PATHCONV=1 (para o backup-db) — com isso o Git
# Bash NÃO converte //E em /E e o robocopy não reconhece as flags. Aqui
# precisamos da conversão padrão de paths do MSYS.
unset MSYS_NO_PATHCONV MSYS_NO_PATH_CONV

SRC="${WHATSAPP_PROFILE_DIR:-$HOME/.luna/chrome-whatsapp}"
DEST_ROOT="${WHATSAPP_BACKUP_ROOT:-$HOME/.luna/backups}"
KEEP=5
STAMP="$(date +%Y%m%d-%H%M)"
DEST="$DEST_ROOT/chrome-whatsapp-$STAMP"

if [ ! -d "$SRC" ]; then
  echo "backup-profile: perfil não encontrido em $SRC" >&2
  exit 1
fi

mkdir -p "$DEST_ROOT"

# 2026-10-13: portado pro VPS (Linux). No PC o robocopy lê arquivos abertos
# pelo Chrome sem derrubá-lo (cópia quente); no Linux o tar faz o mesmo papel
# (arquivo aberto = copiado pelo estado em disco, Chrome não trava).
if command -v robocopy >/dev/null 2>&1; then
  # /E = recursivo; /XD /XF = exclusões; /R:1 /W:1 = não travar em arquivo
  # travado; exit codes 0–7 = sucesso (8+ = falha real do robocopy).
  robocopy "$(cygpath -w "$SRC")" "$(cygpath -w "$DEST")" \
    //E //NFL //NDL //NP \
    //XD "Cache" "Code Cache" "GPUCache" "GrShaderCache" "ShaderCache" \
         "Crashpad" "component_crx_cache" "extensions_crx_cache" \
         "optimization_guide" "segmentation_platform" "GraphiteDawnCache" \
         "Default/Cache" "Default/Code Cache" "Default/GPUCache" \
         "Default/Sessions" "Sessions" "Default/DawnWebGPUCache" "Default/DawnGraphiteCache" \
    //XF "*.tmp" "lockfile" "Singleton*" "Cookies*" \
    //R:1 //W:1
  code=$?

  if [ "$code" -gt 7 ]; then
    echo "backup-profile: FALHOU (robocopy exit $code)" >&2
    rm -rf "$DEST"
    exit 1
  fi

  # Sanity mínimo: a sessão mora em Default/ — sem ela o backup é inútil.
  if [ ! -d "$DEST/Default" ]; then
    echo "backup-profile: FALHOU (Default/ ausente no destino)" >&2
    rm -rf "$DEST"
    exit 1
  fi
else
  # Linux (VPS): tar.gz quente com as mesmas exclusões. Sanity = Default/
  # presente dentro do arquivo.
  DEST_TAR="$DEST.tar.gz"
  tar -C "$(dirname "$SRC")" \
    --exclude='chrome-whatsapp/Cache' \
    --exclude='chrome-whatsapp/Code Cache' \
    --exclude='chrome-whatsapp/GPUCache' \
    --exclude='chrome-whatsapp/GrShaderCache' \
    --exclude='chrome-whatsapp/ShaderCache' \
    --exclude='chrome-whatsapp/Crashpad' \
    --exclude='chrome-whatsapp/component_crx_cache' \
    --exclude='chrome-whatsapp/extensions_crx_cache' \
    --exclude='chrome-whatsapp/optimization_guide' \
    --exclude='chrome-whatsapp/segmentation_platform' \
    --exclude='chrome-whatsapp/GraphiteDawnCache' \
    --exclude='chrome-whatsapp/Default/Cache' \
    --exclude='chrome-whatsapp/Default/Code Cache' \
    --exclude='chrome-whatsapp/Default/GPUCache' \
    --exclude='chrome-whatsapp/Default/Sessions' \
    --exclude='chrome-whatsapp/Sessions' \
    --exclude='chrome-whatsapp/Default/DawnWebGPUCache' \
    --exclude='chrome-whatsapp/Default/DawnGraphiteCache' \
    --exclude='*.tmp' --exclude='lockfile' --exclude='Singleton*' --exclude='Cookies*' \
    -czf "$DEST_TAR" "$(basename "$SRC")" 2>/dev/null
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "backup-profile: FALHOU (tar exit $code)" >&2
    rm -f "$DEST_TAR"
    exit 1
  fi
  if ! tar -tzf "$DEST_TAR" 2>/dev/null | grep -q 'chrome-whatsapp/Default/'; then
    echo "backup-profile: FALHOU (Default/ ausente no destino)" >&2
    rm -f "$DEST_TAR"
    exit 1
  fi
  DEST="$DEST_TAR"
fi

# Mantém só os KEEP mais recentes.
ls -1d "$DEST_ROOT"/chrome-whatsapp-* 2>/dev/null | sort | head -n "-$KEEP" | while read -r old; do
  rm -rf "$old"
done

echo "backup-profile: ok -> $DEST"
