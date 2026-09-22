# Guia de hardware — Voz da Luna (F6, §26)

> Software 100% pronto (voice/ no whatsplay). Esta parte é **ação manual do
> owner** — mixagem duplex não tem como validar sem o hardware instalado.
> Siga na ordem; cada checkpoint tem como conferir.

## Status automático (2026-09-22, verificado pela Luna)

- ✅ **VoiceMeeter instalado** — porém a edição é **STANDARD** (1 VAIO, 1 bus
  virtual B1). A mixagem duplex do §2 precisa de **BANANA** (AUX input + B2).
  Instalação atual saudável: drivers VAIO OK, dispositivos de som reais intactos.
- ⚠️ **Cabos**: nenhum VB-Cable instalado (sem "CABLE-A/B Output" no Painel de
  Som). Existe UM instalador bundled em
  `C:\Program Files (x86)\VB\Voicemeeter\VBCABLE_Setup_x64.exe` (instala 1 cabo
  "CABLE" genérico). O guia precisa de DOIS.
- ⛔ **Bloqueio**: instalação de driver exige **UAC (admin)** — a Luna roda sem
  elevação e não vai forçar isso. Checklist exato abaixo.
- 🔎 Instaladores baixados pelo owner: varredura completa do perfil
  (Downloads/Desktop/Documents/AppData, profundidade 3) — **nenhum
  instalador de Banana ou VB-Cable encontrado**. O "já baixei" provavelmente
  se refere ao VoiceMeeter Standard (que já estava instalado). Os downloads
  oficiais são email-gated (passo 1 do checklist).

### Checklist manual do owner (UAC + reboot)

1. **VoiceMeeter Banana**: baixar em <https://shop.vb-audio.com> ( Banana é
   donationware — download grátis; o site pede email pra gerar o link). Se já
   baixou, o instalador é tipo `VoicemeeterBananaSetup.exe` — executar como
   admin. Instala POR CIMA do Standard (mesma pasta).
2. **VB-Cable A+B**: <https://vb-audio.com/Cable/> (também email-gated; pack
   "CABLE A+B"). Instalar como admin. Alternativa imediata: rodar o
   `VBCABLE_Setup_x64.exe` bundled (dá 1 cabo genérico "CABLE" — dá pra começar
   o Checkpoint 2 com ele + o VAIO do Banana, usando só 1 cabo: veja §2-nota).
3. **REBOOT quando o instalador pedir** (driver de áudio só ativa no boot).
   O som do PC volta normal após o reboot — os drivers VB-Audio convivem com
   o som real (verificado: dispositivos reais intactos ao lado do VAIO).
4. Após o reboot, a Luna configura o roteamento do §2 automaticamente se
   possível (registry/Remote) ou guia o owner nos cliques.

### §2-nota — versão mínima com 1 cabo (só pra testar antes do pack A+B)

Com Banana + 1 cabo "CABLE" + VAIO dá pra fazer o duplex usando VAIO como um
dos lados: Hardware In 1 = mic real; VAIO = voz do ChatGPT (Virtual Input);
AUX = CABLE Output (voz de Abner do WhatsApp); B1 (VAIO out) = CABLE Input
(voz ChatGPT → chamada WhatsApp); B2 (AUX out) = alto-falante do Chrome do
ChatGPT... ou seja, 1 cabo resolve se o WhatsPlay usar o VAIO como microfone.
Menos limpo que A+B, mas valida o Checkpoint 2.

## 0. Inventário necessário

- 2× **VB-Cable** (VB-Audio, gratuito) — cabos virtuais de áudio.
- **VoiceMeeter Banana** (gratuito) — mesa de mixagem virtual.
- Chrome do ChatGPT com o número logado (a voz do Operador).
- O WhatsPlay já roda o Chrome dedicado do WhatsApp.

## 1. Instalação (checkpoint: dispositivos aparecem)

1. Instale o VB-Cable A e o VB-Cable B (reboot pedido — faça).
2. Instale o VoiceMeeter Banana.
3. **Checkpoint 1:** Painel de Controle → Som → Gravação deve listar
   "CABLE-A Output" e "CABLE-B Output"; Reprodução lista "CABLE-A Input" e
   "CABLE-B Input". Se faltar, reinstale o cabo correspondente.

## 2. Roteamento da mixagem duplex

Meta: a voz de Abner (da chamada WhatsApp) entra no microfone do Chrome do
ChatGPT; a voz do ChatGPT sai no microfone da chamada WhatsApp.

1. **VoiceMeeter Hardware Input 1:** microfone real (se quiser falar também).
2. **Virtual Input (VAIO):** CABLE-B Output (voz do ChatGPT).
3. **VoiceMeeter AUX Input:** CABLE-A Output (voz de Abner, vinda do WhatsApp).
4. **A1 (Hardware Out):** seus fones de ouvido (monitor).
5. **B1 (Virtual Out VAIO):** CABLE-A Input → voz do ChatGPT vai pra chamada
   WhatsApp.
6. **B2 (Virtual Out AUX):** CABLE-B Input → voz de Abner vai pro microfone
   do Chrome do ChatGPT.
7. **Chrome do WhatsApp (WhatsPlay):** microfone = CABLE-A Output; alto-
   falante = CABLE-A Input… NÃO — alto-falante do WhatsApp = A1 direto (ou
   VoiceMeeter Input) para você ouvir Abner pelos fones.
8. **Chrome do ChatGPT:** microfone = CABLE-B Output; alto-falante = CABLE-B
   Input.

**Checkpoint 2:** abra o monitor do VoiceMeeter e faça uma chamada de teste
entre os dois chips: os medidores devem acender nos canais certos (AUX sobe
com a voz de Abner; VAIO sobe com a voz do ChatGPT).

## 3. Chamada real de teste (checkpoint ponta a ponta)

1. Abra uma chamada de voz do **ChatGPT** no Chrome dedicado dele (a chamada
   fica tocando em espera).
2. `pnpm --filter whatsplay start` já escuta o popup de chamada entrante do
   WhatsApp — quando Abner ligar, o software **atende sozinho** e aciona o
   VoiceBridge (`voiceCallLoop`).
3. Fale pela chamada: a transcrição do ChatGPT vira turno → vai pra sessão da
   Luna → a resposta volta como texto pro chat da chamada → o Operador fala.
4. **Checkpoint 3:** se a Luna demorar, o Operador diz a marca de espera
   ("só um momento, estou criando a solicitação — Luna") — silêncio morto
   significa que o relay de texto não está fluindo; veja os logs do whatsplay.

## 4. Fallback sem hardware (já funciona hoje)

- **Áudio do WhatsApp:** a camada simples (msg de voz → Whisper → pipeline)
  está em `apps/whatsplay/src/voice/transcribe.ts` — funciona sem nada deste
  guia, assim que o whisper estiver disponível (`where whisper` no terminal,
  ou `WHISPER_API_KEY` no .env).
- **Chamada sem atendimento:** ~15s → mensagem automática
  "vi que você ligou — manda áudio ou escreve" (só pra quem está no escopo).

## 5. Pendências de validação (sem hardware instalado)

- Áudio duplex de verdade (checkpoints 2 e 3) — só o owner consegue conferir
  ouvindo. Software testado com mocks/fixtures (8 testes em voice.test.ts).
