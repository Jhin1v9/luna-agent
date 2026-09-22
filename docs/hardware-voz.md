# Guia de hardware — Voz da Luna (F6, §26)

> Software 100% pronto (voice/ no whatsplay). Status verificado automaticamente
> pela Luna em 2026-09-22 (pós-reboot do owner). Siga a ordem; cada checkpoint
> tem como conferir.

## Status real (2026-09-22, pós-reboot com Banana — inventário final)

- **Banana INSTALADO** (`voicemeeterpro.exe` / `voicemeeterpro_x64.exe`,
  uninstall = `voicemeeterprosetup.exe`) e **rodando oculto** (a Luna iniciou
  via PowerShell `-WindowStyle Hidden`). Driver: o mesmo VAIO8 único
  (`ROOT\MEDIA\0000`, OK).
- **TESTE DE LOOPBACK AUTOMATIZADO** (tom 523Hz em cada um dos 8 playbacks,
  energia medida em cada um dos 8 recordings via AnalyserNode num Chrome
  headless temporário, permissões concedidas): **matriz 8×8 toda vazia** —
  nenhum playback chega a nenhum recording sozinho. Conclusão: os pares NÃO
  são cabos standalone; o sinal só flui com o MIXER roteando (strips → buses).
  A configuração do roteamento é a etapa que falta (abaixo).
- Dispositivos reais intactos (FxSound = default de saída, HD Audio, Steam).

## Roteamento a aplicar no Banana (GUI — 5 min do owner)

O app está rodando oculto: clique no ícone da bandeja do VoiceMeeter (ou rode
`voicemeeterpro_x64.exe` de novo) pra abrir a janela.

1. **STRIP "Voicemeeter VAIO" (Virtual Input)**: ligue **B1** (botão B1 em
   baixo do strip). → tudo que o WhatsPlay tocar no VAIO sai em
   `Voicemeeter Out B1`.
2. **STRIP "Voicemeeter AUX" (Virtual Input)**: ligue **B2**. → voz do
   ChatGPT sai em `Voicemeeter Out B2`.
3. **BUS A1 (Hardware out, botão A1 no topo à direita)**: selecione seus
   fones/altos-falantes reais no dropdown A1 (monitor: você ouve VAIO e AUX).
4. **Opcional, mesmo strip AUX**: ligue A1 também se quiser ouvir o Operador
   (geralmente já soa pelo passo 3).
5. Salve: Menu → Save Settings (pra voltar assim no próximo boot).

Depois os dois Chromes (2 dropdowns cada, dentro da página):
- **Chrome do WhatsPlay (WhatsApp)**: microfone = `Voicemeeter Out B2`.
- **Chrome do ChatGPT**: microfone = `Voicemeeter Out B1`; alto-falante =
  `Voicemeeter AUX Input`.
- **Chrome do WhatsPlay**: alto-falante = `Voicemeeter Input` (VAIO).

**Checkpoint 2** (após o passo 5): a Luna pode repetir o teste de loopback
automático — a matriz deve mostrar VAIO→B1 e AUX→B2. É só pedir.

### Checkpoint 2 — RODADA FINAL 2026-09-22: **PASSA COM Ressalvas** ✅

Circuito confirmado funcionando (owner ouviu YouTube pelos fones via Banana).
Teste automatizado (tom concorrente à medição — erro anterior: medir depois
do tom parar):

| Playback | Recordings com energia (RMS) | Leitura |
|---|---|---|
| `#0 Padrão` (= 1º VAIO, strip "Voicemeeter Input") | **Out 7 = 0.638**, Out 6 = 0.633 | VAIO → B1 = **Out 7** (limpo) |
| `#4 Speakers` (= strip "Voicemeeter AUX Input", medidor do strip aceso em screenshot) | **Out 6 = 0.633** | AUX → B2 = **Out 6** |
| demais 7 playbacks | 0 | mortos |
| cruzamento AUX→Out 7 | 0 | **morto ✅** |

Ressalva: o VAIO também aparece em Out 6 (0.633) — se houver **eco** na
chamada real (a voz do owner voltando pra ele), desligar B2 no strip VAIO
(1 clique) ou re-testar; o caminho limpo certificado é Out 7 (VAIO-only).

### Estado dos Chromes e o BLOQUEIO restante (nomês duplicados)

- **Chrome do WhatsPlay**: playback = default (cai no VAIO ✅, nada a fazer).
  Microfone da chamada = **`Voicemeeter Out 6`** — pick manual de 2 cliques
  no WhatsApp (⋮ → configurações da chamada → microfone) — a escolha persiste
  no perfil.
- **Chrome do ChatGPT (Operador)**: perfil dedicado `~/.luna/chrome-voice`
  ainda não criado — **bloqueado pelos nomes**: os 8 playbacks se chamam
  TODOS "Speakers (VB-Audio Voicemeeter VAIO)" — a flag `--audio-output-device`
  foi testada e **falha** (nome ambíguo → cai no default). O desbloqueio é
  renomear os endpoints (admin, one-time):
  **Protocolo interativo (10 min, owner + Luna)**: a Luna toca tom em cada
  playback por índice; no Painel de Som o owner renomeia o dispositivo que
  está com a barra de nível mexendo ("VM In 1 (VAIO)", "VM In 2 (AUX)", ...).
  Com nomes únicos, a Luna termina sozinha: cria o perfil chrome-voice com
  `--audio-output-device="VM In 2 (AUX)"` e valida o loopback AUX→Out 6.

### Passo a passo do Checkpoint 3 (chamada real) — assim que o rename existir

1. WhatsApp no WhatsPlay: abrir configurações de chamada uma vez, microfone
   = `Voicemeeter Out 6`, alto-falante = default (VAIO).
2. Chrome do ChatGPT: logar no chatgpt.com, iniciar voice mode (microfone
   default = mic real dele? NÃO — micro = `Voicemeeter Out 7` se o app
   permitir pick; senão renomear Out 7 também: "VM Out B1 (voz do chamador)").
3. `pnpm --filter whatsplay start` já escuta o popup de chamada — o owner
   liga do próprio número → atende sozinho → VoiceBridge entra.
4. Validar: owner fala na chamada → voz dele (VAIO→Out 7) chega no ChatGPT →
   resposta do Operador (AUX→Out 6) entra na chamada. Eco = clicar B2 off no
   strip VAIO.

## (arquivo histórico) Inventário necessário

- **Driver de áudio**: UM único device (`ROOT\MEDIA\0000`, serviço
  `VBVoicemeeterVAIOMME`, OK) — o driver **multi-porta VAIO 8 da VB-Audio**
  (loopback habilitado no registry: `HKLM\SOFTWARE\VB-Audio\MultiCable`).
  **Não há duplicatas/ghosts** — os "8× Speakers (VB-Audio Voicemeeter VAIO)"
  do Get-PnpDevice são os 8 endpoints reais do driver com nome-cache genérico;
  os apps veem os nomes certos (abaixo).
- **Topologia real** (enumerada ao vivo via Chromium no Chrome dedicado):
  - *Playback (entradas virtuais do mixer)*: `Voicemeeter Input` (VAIO),
    `Voicemeeter AUX Input`, `Voicemeeter VAIO3 Input`, `Voicemeeter In 1..5`.
  - *Recording (taps de bus)*: `Voicemeeter Out A1..A5` (buses físicos),
    `Voicemeeter Out B1..B3` (buses virtuais).
- **Mixer instalado**: VoiceMeeter **Standard 1.1.3.0** — só endereça o VAIO
  (1 entrada virtual, 1 bus). **O duplex precisa de BANANA (ou Potato)** pra
  rotear AUX/VAIO3/In1-5 → B1/B2. Como o driver já é o da família VAIO8,
  instalar o Banana **não deve pedir reboot** (driver já presente) — conferir.
- **VoiceMeeter Standard está rodando** (a Luna iniciou, oculto, sem alterar
  nada — A1 não configurado, som do PC intocado).
- Dispositivos reais intactos: FxSound Speakers (default de saída), Speakers
  High Definition Audio, Steam Streaming, mic real.

## Checklist do owner (ordem)

1. **Instalar VoiceMeeter BANANA** por cima do Standard (download email-gated
   em <https://shop.vb-audio.com> — Banana é donationware, instala grátis).
   Driver de áudio já é o da família certa → se o instalador perguntar sobre
   reboot, pode **não precisar**; se pedir, reboot.
2. Abrir o Banana. Ele verá as 8 portas. Configuração da mixagem duplex:
   - **Hardware Input 1** = microfone real (opcional, pra você falar).
   - **Virtual Input (VAIO)** = "Voicemeeter Input" — aqui o Chrome do
     WhatsPlay (WhatsApp) manda a voz de Abner.
   - **AUX Input** = "Voicemeeter AUX Input" — aqui o Chrome do ChatGPT manda
     a voz do Operador.
   - **A1** = seus fones (monitor — você ouve tudo).
   - **B1** = "Voicemeeter Out B1" (VAIO out) — voz de Abner → micro do
     Chrome do ChatGPT.
   - **B2** = "Voicemeeter Out B2" (AUX out) — voz do Operador → micro da
     chamada WhatsApp (WhatsPlay).
3. **No Chrome do WhatsPlay (WhatsApp)**: microfone = `Voicemeeter Out B2`.
   (Em chamada: ⋮ → Definições → dispositivo de áudio.)
4. **No Chrome do ChatGPT**: microfone = `Voicemeeter Out B1`.
5. **Checkpoint 2**: ligue numa chamada de teste entre os dois chips — os
   medidores do Banana: AUX sobe com a voz de Abner, VAIO sobe com a voz do
   Operador, B1/B2 com as saídas.
6. **Checkpoint 3 (ponta a ponta)**: chamada real — o software do whatsplay
   atende sozinho e aciona o VoiceBridge (§3 do guia original abaixo).

> Sem Banana instalado, o Standard consegue no máximo 1 perna do duplex
> (VAIO→B1). Os "cabos" VB-Cable viraram desnecessários — o driver VAIO8 já é
> a fiação completa.

## 0. Inventário necessário (histórico)

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
