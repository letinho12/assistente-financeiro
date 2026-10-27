# Etapa 3: publicar o app

Endereço do app: https://letinho12.github.io/assistente-financeiro/

## 0. Ligar o GitHub Pages (uma vez)
No repositório, vá em **Settings > Pages**. Em "Build and deployment", escolha **Source: Deploy from a branch**, branch **main**, pasta **/ (root)**, e clique em **Save**. Em 1 ou 2 minutos o endereço acima passa a abrir.

## 1. Ligar a planilha ao app (no Apps Script)
1. Cole o `Sincronizacao.gs` novo no editor e salve.
2. Clique em **Implantar > Nova implantação**. Na engrenagem ao lado de "Selecionar tipo", escolha **App da Web**.
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Clique em **Implantar** e copie a URL que termina em `/exec`.
   (Sem o código de acesso, essa URL não entrega nenhum dado: ela responde "acesso negado".)
3. Na função `gerarLinkDoApp`, cole a URL `/exec` em `urlDoScript` (o endereço do app já vem preenchido). Escolha **gerarLinkDoApp** e clique em **Executar**.
4. O registro mostra um link. Abra esse link uma vez no celular e uma vez no computador. Pronto, o app fica conectado.

Quando você mudar o código do script depois, use **Implantar > Gerenciar implantações > editar (lápis) > Versão: Nova versão**, para a URL continuar a mesma.

## 2. Instalar no celular
- **Android (Chrome):** menu ⋮ > **Instalar app** (ou "Adicionar à tela inicial").
- **iPhone (Safari):** botão compartilhar > **Adicionar à Tela de Início**.
