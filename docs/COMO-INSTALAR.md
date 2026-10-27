# Etapa 2: como instalar a sincronização automática

Leva uns 15 minutos. Você só faz isso uma vez.

## 1. Converter a planilha para Google Sheets
O arquivo que você subiu ainda está como `.xlsx`, e o script só roda em planilha nativa do Google.
Abra o `Controle Financeiro (1).xlsx` no Drive, vá em **Arquivo > Salvar como Planilhas Google** e passe a usar essa nova cópia. Depois você pode apagar o `.xlsx`.

## 2. Pegar as chaves na Pluggy
O acesso pessoal e gratuito é pelo **Meu Pluggy**. Não precisa de aprovação da Pluggy, mas tem um detalhe importante: **as contas precisam ser conectadas no Meu Pluggy enquanto o período de teste (trial) da sua conta na Pluggy estiver ativo.** Depois que o trial acaba, as conexões que já existem continuam funcionando, mas não dá mais para adicionar bancos.

1. Entre em https://dashboard.pluggy.ai, crie um time e depois uma aplicação em **Applications**. Copie o **Client ID** e o **Client Secret**.
2. Entre em https://meu.pluggy.ai e conecte o **Nubank**, o **Itaú** e a **BTG**. Cada banco abre o próprio app para você autorizar o compartilhamento pelo Open Finance. É a mesma autorização que você daria a qualquer app financeiro, e ela vale por até 12 meses.
3. Volte ao dashboard, abra sua aplicação e clique em **Ir para Demo**. No menu de três pontos, use **Copiar Item ID** para cada conexão.

## 3. Colar o script
1. Na planilha convertida, abra **Extensões > Apps Script**.
2. Apague tudo o que estiver em `Código.gs`, cole o conteúdo de `Sincronizacao.gs` e salve (Ctrl+S).

## 4. Colocar as chaves e rodar (um passo só)
1. No editor do Apps Script, logo no começo do código, tem um bloco assim:
   ```
   PLUGGY_CLIENT_ID: '',
   PLUGGY_CLIENT_SECRET: '',
   PLUGGY_ITEM_IDS: '',
   ```
2. Cole cada valor **entre as aspas**. Exemplo: `PLUGGY_CLIENT_ID: 'abc123-...',`
   - Em `PLUGGY_ITEM_IDS`, coloque os 3 Item IDs na mesma linha, separados por vírgula: `'id1,id2,id3'`.
   - `BTC_XPUB` é opcional. Na BlueWallet: abra a carteira > ⋯ > Mostrar XPUB.
3. Salve (Ctrl+S).
4. Na barra de cima do editor tem uma caixinha com o nome de uma função. Escolha **configurar** e clique em **▶ Executar**.
5. O Google vai pedir autorização: **Revisar permissões** > escolha sua conta > aparece "O Google não verificou este app" (normal, porque o app é seu) > **Avançado** > **Acessar Controle Financeiro (não seguro)** > **Permitir**.
6. Pronto. Isso guarda as chaves, ajusta o fuso para São Paulo, ativa a atualização diária às 6h e já faz a primeira sincronização (últimos 90 dias). Volte à planilha e confira as abas.
7. Opcional: apague os valores que você colou entre as aspas e salve. Eles já ficaram guardados no script.

Se aparecer um erro em vermelho embaixo do editor, copie a mensagem e me mande.

Sobre o Bitcoin: o xpub permite ver saldo e histórico, mas não permite mover nada. Ele é consultado no site blockchair.com. Se preferir, deixe em branco e digite a quantidade de BTC à mão na aba Investimentos. O script continua atualizando a cotação.

## O que conferir depois da primeira sincronização
- **Transações:** cada compra chega classificada. Pagamento de fatura vira "Transferência" para não contar duas vezes. Compra parcelada vira "Parcela". Só o que fica como "Variável" desconta do quanto você pode gastar. Você pode corrigir a classificação à mão, e o script não sobrescreve.
- **Parcelados:** as compras parceladas do Nubank entram aqui sozinhas e alimentam a aba Faturas Futuras.
- **Mensalidades:** cobranças que se repetem todo mês aparecem com a observação "Detectada automaticamente". Revise e mude "Ativa?" para "Não" se alguma estiver errada.
- **Contas e Investimentos:** saldo do Itaú, fatura atual e limite do Nubank, posições da BTG e o Bitcoin.

Se der algum erro, copie a mensagem em **Execuções** no Apps Script e me mande.
