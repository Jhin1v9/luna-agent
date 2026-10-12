# 🌙 Guía de Luna para humanos

Cómo encender, usar y apagar Luna sin tener que memorizar comandos.

---

## 1. Qué es Luna

Luna es un agente autónomo que vive en tu PC. Piensa usando la web de Kimi
(o DeepSeek) dentro de un **Chrome real** que controla automáticamente, y ejecuta
acciones de verdad en tu ordenador: leer y escribir archivos, lanzar comandos,
hacer commits de git, hablar con el dashboard… Tú le hablas por la web o por
Telegram y ella hace el resto.

---

## 2. Instalación

Copia y pega esto en un terminal:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jhin1v9/luna-kernel/main/install.sh)
```

El instalador comprueba los requisitos, clona el repositorio en `~/.luna-kernel`,
genera los tokens, instala dependencias y deja todo funcionando.

Requisitos:

- **Node.js 22 o superior**
- **Google Chrome** (o Chromium)
- **PM2** (el gestor de procesos; el instalador lo instala si falta)
- Git

Al terminar te guiará por el primer login manual en Kimi (ver la sección 5).

---

## 3. Encender y apagar

### Encender

Abre un terminal y escribe:

```bash
luna
```

Esto arranca todos los servicios y abre en el navegador la interfaz web
(http://localhost:3458). También se abre una segunda pestaña con el frontend
de desarrollo (https://localhost:5173): puedes ignorarla o cerrarla, es solo
para desarrolladores. Si prefieres ir directo al dashboard clásico:

```bash
dashboard
```

Ambos comandos hacen lo mismo (arrancar todo); solo cambia la página que abren.
Si Luna ya estaba encendida, simplemente la reinician.

> ⚠️ Los atajos `luna` y `dashboard` (en `~/.local/bin`) apuntan hoy a una copia
> antigua del repositorio en `.worktrees/monorepo-migration`. Funcionan, pero lo
> correcto es que arranquen `~/.luna-kernel/pm2-ecosystem.config.js`. Si algún día
> desaparece la carpeta `.worktrees`, estos atajos dejarán de funcionar y habrá
> que actualizarlos.
>
> 📌 **Rama activa:** todos los cambios nuevos van a la rama `Luna-Abner`, no a
> `main`. Si haces `git pull`, asegúrate de estar en `Luna-Abner`.

### Apagar

```bash
pm2 stop all
```

### Comprobar que todo va bien

```bash
pm2 status
```

Deben aparecer al menos estos 2 procesos en estado `online`:

| Proceso | Qué es | Puerto |
|---|---|---|
| `luna-server` | Servidor web de Luna (chat + API) | 3458 |
| `nexo-dashboard` | Dashboard clásico | 3456 |

Procesos opcionales:

| Proceso | Qué es | Puerto |
|---|---|---|
| `luna-vite` | Servidor de desarrollo del frontend | 5173 |
| `luna-telegram-adapter` | Bot de Telegram | — |

> ⚠️ `luna-health-watchdog` fue desactivado el 2026-08-03 porque causaba reinicios
> en bucle. No lo arranques a menos que se decida lo contrario.

---

## 4. Uso diario

- **Por la web:** abre http://localhost:3458 y chatea con Luna como con cualquier
  asistente.
- **Por Telegram:** escribe a **@lunanexobot**. Si el bot no responde, mándale
  `/kimi on` para activarlo. Por Telegram, Luna solo puede usar herramientas del
  dashboard (tareas, leads, finanzas…); no puede tocar archivos ni la terminal.
- **El primer día** tendrás que hacer login manual en Kimi (ver la sección 5).
  Después, Luna recuerda la sesión sola.

### Estado actual del sistema (2026-08-03)

Luna está funcionando correctamente:

- Servidor estable: `luna-server` ya no se reinicia solo.
- Chat web responde en http://localhost:3458.
- El pensamiento y la respuesta llegan completos al frontend.
- El wallpaper de constelaciones es determinista: se ve igual después de un
  `Ctrl+Shift+R` (hard refresh).

Si ves la línea `JSON Copiar` al final del pensamiento, es un texto residual de
la interfaz de Kimi que no afecta el funcionamiento. Se deja así por ahora.

---

## 5. Login de Kimi

Luna no tiene una cuenta propia en Kimi: usa la tuya, dentro de un Chrome
**aislado y dedicado** que arranca ella misma. Ese login solo lo hace una
persona, la primera vez (y de vez en cuando, cuando caduca la sesión).

Cosas importantes:

- **Nunca cierres ese Chrome aislado.** Es la ventana donde Luna trabaja. Si lo
  cierras, se pierde la sesión y Luna deja de funcionar hasta que vuelvas a
  hacer login.
- **Nunca hagas Ctrl+Shift+R (recarga forzada) en la pestaña de Kimi** de ese
  Chrome: puede tirar la sesión y obligarte a hacer login otra vez.
- Luna guarda una copia de seguridad de las cookies cada 5 minutos, así que en
  la mayoría de los casos la sesión se recupera sola.

Si Kimi vuelve a pedir login:

1. Busca el Chrome aislado entre tus ventanas (o ábrelo si está cerrado:
   reinicia Luna con `pm2 restart luna-server` y el Chrome volverá a aparecer).
2. Entra en https://www.kimi.com en esa ventana y haz login normalmente.
3. No hagas nada más: en unos 5 minutos Luna guarda las nuevas cookies sola.

Si no encuentras el Chrome, comprueba que está vivo abriendo en el navegador:

```
http://localhost:9222/json
```

Si esa página da error, el Chrome aislado está caído: reinicia con
`pm2 restart luna-server`.

---

## 6. Sincronización entre los 3 PCs

Hay tres máquinas con Luna: **Jhin**, **Pai** y **Nonoke**.

```
PC Jhin ──push──▶ GitHub (rama Luna-Abner) ◀──pull── PC Pai / PC Nonoke
```

- **Jhin** hace los cambios y los sube a la rama **`Luna-Abner`** (`git push origin Luna-Abner`).
- **Pai y Nonoke** reciben los cambios automáticamente: un cron ejecuta el
  script `luna-sync.sh` cada 5 minutos, que hace `git pull`, recompila y
  reinicia Luna si hay novedades.

**Regla de oro: solo Jhin hace push.** Pai y Nonoke son solo lectura. Si en uno
de esos PCs aparece un conflicto de git, no se resuelve a mano: se habla con
Jhin.

> ⚠️ El `luna-sync.sh` que circula hoy viene de la época anterior al monorepo
> (referencia dos repositorios separados, `luna-kernel` y `NEXO_DASHBOARD_PRO`)
> y no existe en el repositorio actual. Antes de instalarlo en un PC nuevo hay
> que actualizarlo al layout del monorepo: hacer `git pull origin Luna-Abner`
> en `~/.luna-kernel`, `corepack pnpm install && corepack pnpm build`,
> `pm2 restart all`.

---

## 7. Actualización tras un `git pull`

Cuando bajes cambios nuevos del repositorio:

```bash
cd ~/.luna-kernel
corepack pnpm install
corepack pnpm build
pm2 restart all
pm2 save
```

Con eso Luna queda actualizada y arrancará con la versión nueva en el próximo
encendido del PC.

---

## 8. Problemas comunes

### "El puerto 3458 ya está en uso"

Quedó un proceso antiguo colgado. Mátalo y reinicia:

```bash
kill -9 $(lsof -ti:3458)
pm2 restart luna-server
```

### Error `MODULE_NOT_FOUND`

Faltan dependencias (típico después de un `git pull` o de cambiar de rama):

```bash
cd ~/.luna-kernel
corepack pnpm install
pm2 restart all
```

### Luna no conecta con Kimi

Comprueba que el Chrome aislado está abierto:

```
http://localhost:9222/json
```

- Si da error → el Chrome está caído: `pm2 restart luna-server`.
- Si responde pero Kimi pide login → sigue la sección 5.

### Si nada de esto funciona

El primer paso de diagnóstico es mirar los registros (logs):

```bash
pm2 logs                # logs de todos los servicios
pm2 logs luna-server    # solo los del servidor de Luna
```

Ahí suele verse el error exacto. Si no sabes interpretarlo, guarda lo que
aparezca y pásaselo a Jhin.

---

## 9. Dónde está cada cosa

Todo vive en un solo repositorio: `~/.luna-kernel`.

```
~/.luna-kernel/
├── packages/kernel/          # El cerebro de Luna
│   ├── luna-soul.cjs         #   orquestador (recibe mensajes, decide, responde)
│   ├── kimi-bridge.cjs       #   controla el Chrome/Kimi
│   ├── luna-web/             #   interfaz web (el chat)
│   ├── chrome-profile/       #   perfil del Chrome aislado (no tocar)
│   └── .brain/               #   memoria: bugs, decisiones y estado del proyecto
├── apps/dashboard/           # Servidor web y dashboard
│   ├── luna-server.js        #   servidor principal (puerto 3458)
│   └── server.js             #   dashboard clásico (puerto 3456)
├── .agents/                  # Documentación técnica para agentes de IA
│   ├── architecture.md       #   cómo funciona Luna por dentro
│   ├── conventions.md        #   reglas de código
│   └── runbooks/             #   qué hacer cuando algo se rompe
├── docs/                     # Documentación para humanos (estás aquí)
├── pm2-ecosystem.config.js   # Definición de los 5 procesos de PM2
└── install.sh                # El instalador de un solo comando
```
