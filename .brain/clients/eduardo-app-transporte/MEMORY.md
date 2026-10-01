# Memória — Eduardo (Dudu) — App de Transporte Caminhoneiros

> Append-only.

## 2026-10-01 — Luna

Grupo do projeto: "App de Transporte Caminhoneiros" (WhatsApp). Conv canônica registrada em grupos-clientes.md (9c372fb7); eventos recentes chegando com conv b50f4f34 — roteamento sempre pelo conversation_id do evento.

Respostas do cliente (01/10, autor ~jozee no grupo — possivelmente o próprio Eduardo ou sócio):
- Regiões de foco: Uberlândia, Uberaba + entorno (Triângulo Mineiro), Paracatu, Unaí, Brasília, Goiânia — "grandes lucros de carga"
- Base inicial de caminhoneiros e empresas: ZERO (partindo do zero)
- Data de lançamento do app: ainda não definida

Luna respondeu no grupo organizando os 3 pontos e propondo fechar o escopo do MVP antes de travar data.

Pendências: fechar escopo do MVP para só então definir prazo; contato novo ~jozee no grupo (confirmar identidade — Eduardo ou sócio?).

## 2026-10-01 ~09:47 — Luna
- Abner perguntou no grupo o que falta anotar no relatorio pra comecar a PREVIA do app. Luna respondeu com checklist de 5 pontos pendentes: (1) identidade/decisor do ~jozee, (2) nome/marca do app, (3) coracao do MVP na visao deles (oferta de cargas? candidatura? chat? notificacoes?), (4) referencias de apps (TruckPad/FreteBras?), (5) contatos iniciais de caminhoneiros/transportadoras p/ convite no lancamento. Aguardando respostas do cliente pra fechar escopo.

## 2026-10-01 ~09:52 — INCIidente: Central de Relatorios bloqueada p/ cliente BR
- Cliente Dudu reportou pagina bloqueada (provavelmente regra geo/WAF Cloudflare — dominio atras de CF, cf-ray confirmado; pra Luna abre 200 via PoP MAD). Pode afetar TODOS os clientes BR (Juninho, Leandro CCB, Dudu).
- ACAO HUMANA: Abner assumiu a investigacao (01/10 11:03, "esse error e interesante vou investigar"). Se precisar: Luna tem os headers/cf-ray coletados. Sem credencial CF no .env da Luna.
- Cliente respondido no grupo com alternativa (relatorio via WhatsApp). Time avisado no Production.

## Contexto do projeto (da reuniao 27/09 — fonte da verdade)
- ALMA DO APP (confirmada pelo cliente 01/10): matching automatico — software encontra o caminhoneiro certo pra carga certa com valor justo, automatico. Nada complexo, UX obvia, poucos cliques.
- Dashboard de gastos/ganhos no painel do caminhoneiro.
- 6 pilares: localizacao viva (ofertas de retorno por raio+direcao), historico duplo (caminhoneiro ve tudo, empresa ve basico — LGPD), paradas seguras (POIs com nota), contato proativo (plataforma dispara oferta), precificacao preditiva (media dos aceites), marketing empresa.
- Gratuito p/ caminhoneiros E empresas; monetizacao por anuncios; chat IA.

## 2026-10-01 ~10:10 — decisao do owner (Abner, no grupo do cliente)
- REFERENCIA DE UX DO MATCHING: estilo Tinder — arrasta pra esquerda (rejeita) ou direita (aceita) pra achar cargas ou caminhoneiros. Facilita procurar, rejeitar e aceitar; depois do match a pessoa le a descricao e os detalhes do servico oferecido. Registrar na previa!

## Mecanica do swipe (pesquisa Luna 01/10, pra previa)
- Deck de cartoes empilhados: 1 cartao na frente, proximos visiveis atras (bordas). Servidor manda lotes de ~10 cartoes ranqueados; prefetch quando restam ~3.
- Gestos: o cartao segue o dedo com leve rotacao; aparece selo visual ACEITO/REJEITADO conforme puxa. Ao passar da metade da tela e soltar, o cartao sai voando; abaixo disso, volta com elastico. Botoes X/coracao funcionam igual ao arraste.
- Direita = aceito/quero · Esquerda = rejeito/proximo. Rejeitado nao reaparece.
- Match = aceite mutuo (nos dois sentidos) -> tela de confirmacao -> libera detalhes completos + chat/contato.
- Toque no cartao = virar/expandir pra ver mais detalhes e fotos.
- Os aceites/rejeicoes alimentam o ranking: o app aprende o perfil e ranqueia as proximas ofertas.
- Aplicado ao app de transporte: cartao da carga (foto + empresa basica sem dado pessoal, km, origem/destino, tipo/peso/data) e cartao do caminhoneiro (perfil, reputacao, veiculo, regiao). Aceitar -> detalhes completos do servico.
