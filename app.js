// post_commenter.js
require("dotenv").config();

const Snoowrap = require("snoowrap");
const fetch = require("node-fetch");
const cron = require("node-cron");

// Variáveis de ambiente (carregadas do .env file)
const redditClientId = process.env.REDDIT_CLIENT_ID;
const redditClientSecret = process.env.REDDIT_CLIENT_SECRET;
const redditUsername = process.env.REDDIT_USERNAME;
const redditPassword = process.env.REDDIT_PASSWORD;
const redditUserAgent = process.env.REDDIT_USER_AGENT;
const postWebhookUrl = process.env.POST_WEBHOOK_URL; // Webhook específico para posts

// Configuração da API do Reddit usando Snoowrap
let reddit;
try {
    console.log("Post Commenter Script Iniciado");
    console.log("Autenticando com Reddit API...");
    reddit = new Snoowrap({
        userAgent: redditUserAgent,
        clientId: redditClientId,
        clientSecret: redditClientSecret,
        username: redditUsername,
        password: redditPassword,
    });
    console.log("Autenticado com sucesso no Reddit API.");
} catch (authError) {
    console.error("Erro ao autenticar com Reddit API:", authError);
    process.exit(1); // Encerra o script se a autenticação falhar
}

// Lista de subreddits a serem monitorados
const subredditsToMonitor = [
    "solar", "solarenergy", "solarDy", "energy", "renewableenergy", "teslasolar",
    "futurology", "solarpower", "environment", "diysolar", "renawable", "science",
    "teslamortors", "powerwall", "climate", "energystorage", "enphase", "green",
    "solarcity", "photovoltaics", "eletricvehicles", "sustainability", "teslamotors",
    "teslamodel3", "teslamodely", "selfdrivingcars", "teslamodels", "teslamodelx",
    "modely", "rivian", "electriccars"
];

// Keywords para filtrar posts (título, corpo e flair)
const keywordsToFilter = ["solar quote", "solar quotes"];

// Variável para armazenar o tempo da última execução do monitoramento
let lastRunTimePosts = null; // Variável específica para o script de posts

// Função para configurar o agendamento diário usando cron
function setupDailySchedulePosts() { // Função de agendamento específica para posts
    console.log("Configurando agendamento diário para Post Commenter...");
    const timezone = "America/Los_Angeles";
    const runDuration = 60 * 60 * 1000; // 60 minutos
    const scheduleTimes = ["0 9 * * *", "0 13 * * *", "0 20 * * *"]; // Horários agendados
    const intervalTime = 5 * 60 * 1000; // Intervalo de 5 minutos

    scheduleTimes.forEach((time) => {
        cron.schedule(
            time,
            async () => {
                const logTime = time.split(" ")[1];
                console.log(`Post Commenter: Executando tarefa agendada às ${logTime}h por 60 minutos...`);

                const endTime = Date.now() + runDuration;
                console.log(`Post Commenter: Tempo de término calculado: ${new Date(endTime)}`);

                async function runInterval() {
                    if (Date.now() > endTime) {
                        console.log("Post Commenter: Tempo limite atingido. Cancelando intervalo.");
                        return;
                    }
                    try {
                        await monitorRedditPosts(endTime); // Chama função específica para monitorar posts
                    } catch (error) {
                        console.error("Post Commenter: Erro durante monitoramento e envio:", error);
                    }
                }

                await runInterval();
                const intervalId = setInterval(async () => {
                    await runInterval();
                    if (Date.now() > endTime) {
                        clearInterval(intervalId);
                        console.log("Post Commenter: Intervalo cancelado devido ao tempo limite.");
                    }
                }, intervalTime);
            },
            {
                scheduled: true,
                timezone: timezone,
            }
        );
    });
    console.log("Post Commenter: Agendamento diário configurado.");
}

// Função principal para monitorar posts no Reddit (ESPECÍFICA PARA POSTS)
async function monitorRedditPosts(endTime) {
    console.log("Post Commenter: Iniciando monitoramento de posts...");
    const allPosts = [];
    let postCount = 0;
    const processedItems = new Set();
    const now = Date.now();

    try {
        for (const subreddit of subredditsToMonitor) {
            if (Date.now() > endTime) {
                console.log(`Post Commenter: Tempo limite atingido durante subreddits. Saindo. (${subreddit})`);
                break;
            }
            console.log(`Post Commenter: Verificando subreddit: ${subreddit}`);

            try {
                const newPosts = await reddit.getSubreddit(subreddit).getNew({ limit: 100 });

                for (const post of newPosts) {
                    if (Date.now() > endTime) {
                        console.log(`Post Commenter: Tempo limite atingido durante posts. Saindo. (${subreddit}, ${post.id})`);
                        break;
                    }
                    if (processedItems.has(post.id)) {
                        console.log(`Post Commenter: Post já processado nesta execução: ${post.id}, ignorando.`);
                        continue;
                    }

                    const createdTimestamp = post.created_utc * 1000;
                    if (lastRunTimePosts !== null && (createdTimestamp <= lastRunTimePosts || createdTimestamp > now)) {
                        console.log(`Post Commenter: Post "${post.title}" fora da janela de tempo (${new Date(createdTimestamp)}), ignorando.`);
                        continue;
                    }

                    const postTitleLower = post.title.toLowerCase();
                    const postContentLower = post.selftext ? post.selftext.toLowerCase() : "";
                    const postFlairLower = post.link_flair_text ? post.link_flair_text.toLowerCase() : "";
                    const containsKeywords = keywordsToFilter.some(keyword =>
                        postTitleLower.includes(keyword) || postContentLower.includes(keyword) || postFlairLower.includes(keyword)
                    );

                    if (!containsKeywords) {
                        console.log(`Post Commenter: Novo post: "${post.title}" - Sem keywords, ignorando.`);
                        continue;
                    }

                    processedItems.add(post.id);
                    console.log(`Post Commenter: Novo post com keywords: ${post.title}`);
                    postCount++;

                    allPosts.push({
                        type: "post",
                        id: post.id,
                        title: post.title,
                        content: post.selftext,
                        author: post.author.name,
                        subreddit: post.subreddit_name_prefixed.replace("r/", ""),
                        url: post.url,
                        permalink: `https://reddit.com${post.permalink}`,
                        flair: post.link_flair_text || null,
                    });
                }
            } catch (subredditError) {
                console.error(`Post Commenter: Erro ao iterar subreddit ${subreddit}:`, subredditError);
            }
        }

        if (allPosts.length > 0) {
            console.log(`Post Commenter: Enviando ${allPosts.length} posts para o webhook...`);
            await sendPostsToWebhook(allPosts);
        } else {
            console.log("Post Commenter: Nenhum post novo encontrado.");
        }
    } catch (overallError) {
        console.error("Post Commenter: Erro geral no monitoramento de posts:", overallError);
    }
    console.log(`Post Commenter: Monitoramento de posts concluído. Posts processados: ${postCount}`);
    lastRunTimePosts = now; // Atualiza variável de tempo específica para posts
    console.log(`Post Commenter: Tempo da última execução atualizado para: ${new Date(lastRunTimePosts)}`);
}

// Função para enviar array de posts para o webhook (ESPECÍFICA PARA POSTS)
async function sendPostsToWebhook(data) {
    if (data.length === 0) {
        console.log("Post Commenter: Nenhum post para enviar para o webhook.");
        return;
    }
    try {
        console.log("Post Commenter: Enviando dados para o webhook de posts...");
        const response = await fetch(postWebhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            console.error(`Post Commenter: Erro HTTP ao enviar posts para o webhook! Status: ${response.status}`);
            throw new Error(`Post Commenter: Erro HTTP! status: ${response.status}`);
        }
        console.log("Post Commenter: Dados de posts enviados com sucesso para o webhook.");

    } catch (error) {
        console.error("Post Commenter: Erro ao enviar posts para webhook:", error);
    }
}


// Função principal para iniciar o serviço de monitoramento de posts
async function startMonitoringPosts() { // Função de inicialização específica para posts
    console.log("Post Commenter: Serviço de monitoramento de posts iniciado...");
    setupDailySchedulePosts(); // Configura o agendamento diário para posts
    console.log("Post Commenter: Heartbeat: App está rodando em:", new Date());
}

// Inicia o monitoramento de posts e trata quaisquer erros no início
startMonitoringPosts().catch((error) => {
    console.error("Post Commenter: Erro ao iniciar o monitoramento de posts:", error);
});