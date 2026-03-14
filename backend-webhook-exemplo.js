require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');

// INICIALIZAR FIREBASE ADMIN SDK
// ATENÇÃO: Para segurança (e por bloqueio do GitHub), não vamos usar o arquivo físico.
// Vamos passar o conteúdo do JSON como uma Variável de Ambiente chamada FIREBASE_SERVICE_ACCOUNT direto no Render.
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("🔥 Firebase Admin SDK inicializado via Variável de Ambiente!");
    } else {
        throw new Error("Variável FIREBASE_SERVICE_ACCOUNT não definida.");
    }
} catch (error) {
    console.warn("⚠️ ALERTA: Falha ao inicializar o Firebase Admin. Funções do banco falharão.", error.message);
}

const db = admin.apps.length ? admin.firestore() : null;
const app = express();
app.use(express.json());

// Rota de Teste (para quando abrir a URL no navegador pela Render)
app.get('/', (req, res) => {
    res.status(200).send("🔥 Servidor Webhook da Forja está ONLINE!");
});

// API Keys da Cakto (opcional, para assinar webhooks no futuro)
const CAKTO_CLIENT_SECRET = process.env.CAKTO_CLIENT_SECRET;

// Endpoint para receber o Webhook da Cakto
app.post('/webhook/cakto', async (req, res) => {
    try {
        const payload = req.body;
        console.log("🔔 Webhook recebido da Cakto. Evento:", payload.event);

        if (!db) {
            return res.status(500).send("Banco de dados não configurado (Falta a variável FIREBASE_SERVICE_ACCOUNT).");
        }

        // Recuperar o e-mail exato do comprador no payload da Cakto
        // Dependendo da versão da API da Cakto, o caminho pode variar:
        const customerEmail = payload.data?.customer?.email || payload.customer?.email;
        const customerName = payload.data?.customer?.name || payload.customer?.name || "Novo Forjador";
        
        if (!customerEmail) {
            console.log("⚠️ Evento ignorado: E-mail do cliente ausente no payload.");
            return res.status(200).send("Ignorado - sem e-mail");
        }

        const userRef = db.collection('forja_users').doc(customerEmail);

        // LÓGICA DE EVENTOS DA CAKTO
        const event = payload.event;
        if (event === 'payment.approved' || event === 'order.approved' || event === 'payment_approved' || event === 'order_approved' || event === 'subscription_approved' || event === 'subscription_active') {
            console.log(`✅ Pagamento Aprovado! Liberando/ativando acesso: ${customerEmail}`);
            
            // Set ou update no Firebase
            await userRef.set({
                name: customerName,
                email: customerEmail,
                status: 'active',
                level: 1, // Base
                lastLogin: "Nunca",
                activatedAt: new Date().toISOString()
            }, { merge: true }); // <--- merge: true preserva os dados se a conta já existir (ex: o lead já tiver a senha/whatsapp)

            res.status(200).send('Webhook: Acesso ATIVO processado com sucesso.');

        } else if (event === 'subscription.canceled' || event === 'payment.refunded' || event === 'chargeback' || event === 'subscription_canceled' || event === 'payment_refunded' || event === 'subscription_cancelled') {
            console.log(`❌ Cancelamento ou Estorno. Bloqueando acesso: ${customerEmail}`);

            // Bloqueia o acesso mudando o status para 'inactive' ou 'banned'
            await userRef.set({
                status: 'inactive',
                inactiveAt: new Date().toISOString(),
                inactiveReason: payload.event
            }, { merge: true });

            res.status(200).send('Webhook: Acesso INATIVO/BLOQUEADO processado.');
            
        } else {
            // Outros eventos (ex: boleto impresso, pix gerado, carrinho abandonado)
            console.log(`ℹ️ Evento informativo ignorado: ${payload.event}`);
            res.status(200).send('Webhook recebido, não altera acesso.');
        }

    } catch (error) {
        console.error("❌ Erro ao processar webhook:", error);
        res.status(500).send('Erro interno do servidor');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor backend do Forja rodando na porta ${PORT}`);
    console.log(`Aguardando webhooks em: http://localhost:${PORT}/webhook/cakto`);
});
