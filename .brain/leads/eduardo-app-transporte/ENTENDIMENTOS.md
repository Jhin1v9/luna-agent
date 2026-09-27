# Entendimentos — Eduardo (App de Transporte)

Tudo o que entendemos, as ideias que surgiram e o sentimento das conversas.
Documento vivo: o que fica, o que sai — decidimos depois, juntos. Append-only.

## Ideias capturadas (brainstorm 27/09/2026)

### 1. LOCALIZAÇÃO VIVA
Motorista com rota ativa (ex.: Uberlândia→SP) recebe oferta de retorno exatamente
onde ele está. Matching por **raio + direção**, não oferta genérica.

### 2. HISTÓRICO DUPLO (regra de ouro)
- **Caminhoneiro:** tudo dele — corridas, empresa, quanto ganhou, km, rota, paradas.
  Painel completo; o dado é dele.
- **Empresa:** só o básico da corrida, zero dado pessoal.
- Aqui a gente ganha de lavada na **LGPD**.

### 3. PARADAS SEGURAS sempre no mapa
Camada fixa de POIs no mapa, com prioridade para quem tem melhor nota.

### 4. CONTATO PROATIVO (diferencial de urgência)
A plataforma **NÃO espera** o caminhoneiro aceitar. Ela dispara a oferta direto
para os melhores da lista, por WhatsApp/push. Motor de matching + notificação outbound.

### 5. PRECIFICAÇÃO PREDITIVA
Média dos últimos aceites do caminhoneiro (aceitou 7k, 8k, 9k → base ~8k).
A empresa chega pronta: "fulano costuma aceitar R$ 8.000 nessa distância, montar
proposta?" — ouro para taxa de fechamento.

### 6. MARKETING PRA EMPRESA (ideia original do grupo)
Oferecer o sistema às empresas **ou** analisar as propostas atuais delas para obter
um meio de informação → virar o **sistema de rotas e preços do mercado**.

### 7. LICENÇAS APPLE + GOOGLE
Pedido explícito do grupo: providenciar licenças Apple Developer e Google Play
para lançar o app. (Ação operacional da Nexo.)

## Escopo proposto (Luna)
- **MVP:** matching por localização + notificação proativa + preço sugerido.
- **Ciclo 2:** histórico duplo + paradas seguras.

## Definições fechadas (27/09, grupo Production)
1. **Notificação proativa: AMBOS** — push + WhatsApp, com **configuração no próprio app** pra pessoa definir o que quer receber (Abner confirmou: "not proativa ambos push ou WhatsApp ou os dois").
2. **Avaliação MÚTUA** — caminhoneiro avalia empresa E empresa avalia caminhoneiro (Enoque confirmou).
3. Google Maps: **já têm a conta/API** — Enoque vai configurar ("ja temos maps, vou configurar ele e colocar top").

## Sentimento da conversa
- Tom muito positivo e informal ("aee sim lunaaaaaaaaa", risadas, "manda aeee").
- Grupo em modo **captura de ideias** ("só vou anotando as ideias", "manda que a luna vai entendendo e anotando").
- Confiança na Luna como membro do time (pedem explicitamente que ela entenda e documente).
- Vontade de estruturar conhecimento "do jeito que os grandes fazem".

## O que falta descobrir (para a reunião)
- Quem é o Eduardo (empresa, frota própria ou agregados, região de operação)
- Dor atual: como ele fecha fretes hoje (WhatsApp? tabelas? embarcadores?)
- Budget e modelo de receita imaginado (assinatura empresa? % por frete?)
- Concorrentes/referências que ele usa ou admira
- Prazo esperado para MVP

data + autor: Luna · 2026-09-27
