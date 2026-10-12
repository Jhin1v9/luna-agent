# Resumen para Kimi Chat — Estado VPS + fixes (2026-07-31)

## ✅ VPS — Dashboard Nexo (workspace-nexo / workspace-cliente)

**Problema reportado:** Dashboard de admin y cliente se veía roto (CSS/JS no cargaban).
- **Causa:** Build standalone de Next.js no copió `.next/static` al directorio `standalone`.
- **Fix:** Copia manual de estáticos + `postbuild` script en ambos `package.json`.
- **Estado:** ✅ Dashboard admin (`:3471`) y cliente (`:3472`) funcionan y cargan correctamente.

**Problema reportado:** Botón how-to no era visible.
- **Fix:** Añadido enlace "Guía de Créditos" en sidebar de admin y cliente, abre `https://vps.nexo-digital.app:3500/howto.html`.
- **Estado:** ✅ Visible en ambos dashboards.

**Sistema de créditos:**
- Selector de rol (ADMIN/MANAGER/MEMBER/VIEWER) añadido al formulario de crear organización.
- Sincronización de créditos hacia Prisma al crear org con plan.
- Build + deploy verificados, test E2E OK.

## ✅ VPS — Luna / Kimi Bridge

**Problema reportado:** Luna pedía login de Kimi repetidamente.
- **Causa:** Pestañas stale de Google (`accounts.google.com/info/sessionexpired`) y pestaña de Kimi en home page; el bridge no detectaba la sesión.
- **Fix:** Cerradas pestañas stale, navegada la pestaña de Kimi a `https://www.kimi.com/chat`, reiniciado `luna-server`.
- **También:** `provider-configs/kimi.json` baseUrl cambiado a `https://www.kimi.com/chat`.
- **Estado:** ✅ Luna dejó de pedir login. Logs muestran polling activo de Kimi sin `KIMI_LOGIN_REQUIRED`.

## ℹ️ Sobre https://vps.nexo-digital.app:3501/

**No está apagado.** El Caddy redirige tanto `:3500` como `:3501` al **mismo backend** (`127.0.0.1:13500`). Ambos responden 200 y `/api/health` está OK. Si esperabas un frontend diferente en `:3501`, probablemente nunca existió; `:3500` es el dashboard backend (también sirve `howto.html`).

## 🖥️ PC Local Windows — Setup

Se creó `scripts/setup-windows.ps1` para configurar Luna en Windows:
- Detecta/instala dependencias (npm/pnpm).
- Busca Chrome/Edge/Chromium y opcionalmente añade al PATH.
- Crea `.env` con `DATABASE_URL=file:./luna.db` (SQLite) y `PUPPETEER_EXECUTABLE_PATH`.
- Builda frontend si falta `dist`.
- Inicia `luna-server` y hace health check.

**Uso:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 -ProjectDir "C:\caminho\luna-kernel"
```

## ⏳ Pendiente

- Push a GitHub de cambios locales (luna-kernel y workspace-nexo en VPS). Se necesita token/credenciales de GitHub.

## Confirmación del usuario

- Dashboard VPS admin y cliente: ✅ se ve bien.
- Luna ya no pide login Kimi: ✅ confirmado.
