# Guia de hardware — Voz da Luna (F6, §26)

> Software 100% pronto (voice/ no whatsplay). Esta parte é **ação manual do
> owner** — mixagem duplex não tem como validar sem o hardware instalado.
> Siga na ordem; cada checkpoint tem como conferir.

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
