const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Webhook do QA TEAM
const QA_TEAM_WEBHOOK_URL = 'https://chat.googleapis.com/v1/spaces/AAAA3RoYK_Q/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=xhPplp6I3aFiQB54EqvYNM1tgBd6V_-hjSarXHmeW_Q';

// Rota padrão
app.get('/', (req, res) => {
    res.send("Bot NotifiQA está funcionando!");
});

// Webhook para receber mensagens
app.post('/webhook', async (req, res) => {
    const messageText = req.body.message.text;

    if (messageText.includes("@NotifiQA")) {
        await notifyQaTeam("Um novo deploy foi solicitado!");
        return res.send({ text: "Notificando o QA TEAM..." });
    }

    return res.send({ text: "Mensagem não reconhecida." });
});

// Função para notificar o QA TEAM
async function notifyQaTeam(message) {
    const payload = { text: message };
    await axios.post(QA_TEAM_WEBHOOK_URL, payload);
}

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
