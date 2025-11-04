import express from 'express';
import { config } from './utils/config';
import { WebhookController } from './layers/user-interface/webhook.controller';
import { pool } from '../src/utils/database';
import cors from 'cors';

const app = express();

const corsOptions = {
  origin: 'https://e-dukate.up.railway.app',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(express.json());

const webhookController = new WebhookController();
app.get('/webhook', (req, res) => webhookController.verifyWebhook(req, res));
app.post('/webhook', (req, res) => webhookController.handleWebhook(req, res));

app.post('/api/notify-whatsapp', (req, res) => webhookController.handleApprovalNotification(req, res));

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Chatbot Edukate funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

async function startServer() {
  try {

    const PORT = config.server.port;
    app.listen(PORT, () => {
      console.log(`🤖 Chatbot Edukate ejecutándose en puerto ${PORT}`);
      console.log(`🌐 Webhook: http://localhost:${PORT}/webhook`);
      console.log(`📨 Notifications: http://localhost:${PORT}/api/notify-whatsapp`);
      console.log(`❤️  Health: http://localhost:${PORT}/health`);
      console.log(`💬 Conectado a WhatsApp + Gemini AI`);
    });
  } catch (error) {
    console.error('❌ Error iniciando la aplicación:', error);
    process.exit(1);
  }
}

startServer();