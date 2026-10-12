# Informe — Problemas solucionados e implementaciones (2026-07-31)

## 1. Sistema de créditos — workspace-nexo

### Problema
Al crear una organización con plan, los créditos solo se asignaban al dashboard backend (JSON), pero no a Prisma (`CreditTransaction`/`WorkspaceUser.credits`). Esto hacía que el portal del cliente (`/api/credits/balance`) y la página admin `/creditos` mostraran saldo 0.

### Solución
- **`app/api/admin/organizations/route.ts`**: tras crear la suscripción y ajustar créditos en el dashboard backend, se sincroniza automáticamente con Prisma:
  - Crea `CreditTransaction` tipo `plan` con `userId = adminUser.id`, `projectId = project.id`, `amount = creditsPerMonth`.
  - Incrementa `WorkspaceUser.credits` vía `prisma.$transaction`.
- Añadido selector de rol (`adminRole`: ADMIN/MANAGER/MEMBER/VIEWER) en el formulario de crear organización.
- Ruta valida `adminRole` con fallback a ADMIN.
- UI (`organizacoes/page.tsx`): `<select>` con los 4 roles.
- i18n: `form.adminRole` en es/en/pt.

### Resultado
Test E2E con plan premium + rol MANAGER:
- Dashboard backend balance: 2400 ✅
- Prisma `CreditTransaction`: 2400 tipo `plan` ✅
- `WorkspaceUser.credits`: 2400 ✅
- `WorkspaceUser.role`: MANAGER ✅

---

## 2. How-To del sistema de créditos

### Implementación
- Creada página HTML `apps/dashboard/public/howto.html` con documentación completa del sistema de créditos (planes, suscripciones, tickets, auto-assign, team-usage, ejemplos cURL admin/cliente, flujo de trabajo).
- Desplegada en `https://vps.nexo-digital.app:3500/howto.html`.
- Añadido enlace visible en sidebar de workspace-nexo (admin) y workspace-cliente (cliente) con icono `HelpCircle`, abre en pestaña nueva.
- i18n: `navigation.howto` en es/en/pt para ambos workspaces.

---

## 3. Dashboard de admin y cliente se veía roto

### Problema
Build standalone de Next.js no copió `.next/static` al directorio `standalone`. Cliente mostraba error `Loading chunk 3447 failed` y la UI se veía sin CSS/JS.

### Solución
- Copia manual de `.next/static` → `.next/standalone/apps/<app>/.next/static` para workspace-nexo y workspace-cliente.
- Añadido script `postbuild` en `package.json` de ambas apps para automatizar el copiado en futuros builds.
- Rebuild + deploy de ambos workspaces.

### Resultado
Dashboards admin (`:3471`) y cliente (`:3472`) cargan correctamente. Todas las rutas API (`/events`, `/requests`, `/polls`, `/analyses`, `/system-logs`, `/invitations`, `/ideas`, `/calendar`) responden 200.

---

## 4. Luna / Kimi Bridge pedía login constantemente

### Problema
Luna mostraba "🔒 Você precisa logar primeiro no Kimi Web" en cada mensaje.

### Causa
- Pestañas stale de Google (`accounts.google.com/info/sessionexpired`) abiertas en Chrome.
- Pestaña de Kimi estaba en home page; el bridge no detectaba la sesión porque faltaba el chat input.

### Solución
- Cerradas pestañas stale de Google session expired.
- Navegada pestaña de Kimi a `https://www.kimi.com/chat`.
- Cambiado `provider-configs/kimi.json` → `baseUrl: "https://www.kimi.com/chat"`.
- Reiniciado `luna-server`.

### Resultado
- Logs dejaron de mostrar `KIMI_LOGIN_REQUIRED`.
- Luna vuelve a procesar mensajes (logs muestran polling activo de Kimi).

---

## 5. Dashboard PRO `:3501` se quedaba en blanco

### Problema
`https://vps.nexo-digital.app:3501/` cargaba HTML pero se quedaba en blanco.

### Causa
`apps/dashboard/public/index.html` referenciaba `assets/index-CZ9uRbAg.js` y `assets/index-Bn4Oj2qG.css`, pero la carpeta `public/assets` no existía.

### Solución
Copiado `NexoDashboard/frontend/dist/*` a `apps/dashboard/public/` preservando `howto.html`.

### Resultado
- `:3500` y `:3501` ahora sirven JS/CSS correctamente (JS 3.3MB, CSS 91KB).
- `howto.html` sigue disponible en ambos puertos.

---

## 6. Setup local en Windows

### Implementación
Creado `scripts/setup-windows.ps1` para configurar Luna localmente en Windows:
- Detecta/instala dependencias (npm/pnpm).
- Busca Chrome/Edge/Chromium; opcionalmente añade al PATH.
- Crea `.env` con `DATABASE_URL=file:./luna.db` (SQLite) y `PUPPETEER_EXECUTABLE_PATH`.
- Builda frontend si falta `dist`.
- Inicia `luna-server` y hace health check.

**Uso:**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1 -ProjectDir "C:\caminho\luna-kernel"
```

---

## ⏳ Pendiente

- Push a GitHub de cambios locales (luna-kernel) y del workspace-nexo en VPS. Requiere token/credenciales de GitHub.

## Confirmación final del usuario

- Dashboard VPS admin y cliente: ✅ se ve bien.
- Luna ya no pide login Kimi: ✅ confirmado.
- `:3501` en blanco: ✅ solucionado.
