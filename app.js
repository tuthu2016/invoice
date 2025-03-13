require("dotenv").config();
console.log("CLIENT_ID:", process.env.REDDIT_CLIENT_ID);
console.log("CLIENT_SECRET:", process.env.REDDIT_CLIENT_SECRET);
console.log("USERNAME:", process.env.REDDIT_USERNAME);
console.log("PASSWORD:", process.env.REDDIT_PASSWORD);
console.log("USER_AGENT:", process.env.REDDIT_USER_AGENT);
console.log("WEBHOOK_URL:", process.env.N8N_WEBHOOK_URL);

const Snoowrap = require("snoowrap");
const fetch = require("node-fetch");

// Configure Reddit API credentials
const reddit = new Snoowrap({
  userAgent: process.env.REDDIT_USER_AGENT,
  clientId: process.env.REDDIT_CLIENT_ID,
  clientSecret: process.env.REDDIT_CLIENT_SECRET,
  username: process.env.REDDIT_USERNAME,
  password: process.env.REDDIT_PASSWORD,
});

// Your n8n webhook URL
const webhookUrl = process.env.N8N_WEBHOOK_URL;

// Subreddits to monitor
const subredditsToMonitor = [
  "solar",
  "solarenergy",
  "solarDy",
  "energy",
  "renewableenergy",
  "teslasolar",
  "futurology",
  "solarpower",
  "environment",
  "diysolar",
  "renawable",
  "science",
  "teslamortors",
  "powerwall",
  "climate",
  "energystorage",
  "enphase",
  "green",
  "solarcity",
  "photovoltaics",
  "eletricvehicles",
  "sustainability",
  "teslamotors",
  "teslamodel3",
  "teslamodely",
  "selfdrivingcars",
  "teslamodels",
  "teslamodelx",
  "modely",
  "rivian",
  "electriccars",
];

// Keywords to filter for (título, corpo e flair)
const keywordsToFilter = ["solar quote", "solar quotes"];

// Track processed items to avoid duplicates
const processedItems = new Set();

// Function to monitor new posts
async function monitorPosts() {
  try {
    for (const subreddit of subredditsToMonitor) {
      console.log(`Checking for new posts in r/${subreddit}...`);

      // Get new posts from subreddit
      const newPosts = await reddit
        .getSubreddit(subreddit)
        .getNew({ limit: 25 });

      for (const post of newPosts) {
        // Skip if already processed
        if (processedItems.has(post.id)) continue;

        // **FILTRO DE KEYWORDS ADICIONADO PARA FLAIR:**
        const postTitleLower = post.title.toLowerCase();
        const postContentLower = post.selftext
          ? post.selftext.toLowerCase()
          : "";
        const postFlairLower = post.link_flair_text
          ? post.link_flair_text.toLowerCase()
          : ""; // Obtém o texto da flair, se existir
        const containsKeywords = keywordsToFilter.some((keyword) => {
          return (
            postTitleLower.includes(keyword) ||
            postContentLower.includes(keyword) ||
            postFlairLower.includes(keyword)
          );
        });

        if (!containsKeywords) {
          // Se não contiver as keywords em nenhum lugar, ignora o post
          console.log(
            `New post found: "${post.title}" - Does not contain keywords (title, body, or flair), ignoring.`
          );
          continue; // Pula para o próximo post
        }
        // **FIM DO FILTRO DE KEYWORDS PARA FLAIR**

        // Mark as processed
        processedItems.add(post.id);

        console.log(
          `New post found with keywords (including flair check): ${post.title}`
        );

        // Send to n8n webhook
        await sendToWebhook({
          type: "post",
          id: post.id,
          title: post.title,
          content: post.selftext,
          author: post.author.name,
          subreddit: post.subreddit_name_prefixed.replace("r/", ""),
          url: post.url,
          permalink: `https://reddit.com${post.permalink}`,
          flair: post.link_flair_text || null, // Envia a flair para o n8n (pode ser null)
        });
      }
    }
  } catch (error) {
    console.error("Error monitoring posts:", error);
  }
}

// Function to monitor comments on your posts (sem alterações nesta função)
async function monitorComments() {
  try {
    // Get your username
    const myUsername = await reddit.getMe().name;

    // Get your recent submissions
    const myPosts = await reddit
      .getUser(myUsername)
      .getSubmissions({ limit: 10 });

    for (const post of myPosts) {
      // Expand comments for this post
      const comments = await post.expandReplies({ limit: 25, depth: 1 });

      if (comments && comments.comments) {
        for (const comment of comments.comments) {
          // Skip if already processed or if it's your own comment
          if (
            processedItems.has(comment.id) ||
            comment.author.name === myUsername
          )
            continue;

          // Mark as processed
          processedItems.add(comment.id);

          console.log(`New comment found on your post: ${post.title}`);

          // Send to n8n webhook
          await sendToWebhook({
            type: "comment",
            id: comment.id,
            content: comment.body,
            author: comment.author.name,
            postId: post.id,
            postTitle: post.title,
            subreddit: post.subreddit_name_prefixed.replace("r/", ""),
            permalink: `https://reddit.com${comment.permalink}`,
          });
        }
      }
    }
  } catch (error) {
    console.error("Error monitoring comments:", error);
  }
}

async function sendToWebhook(data) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const responseData = await response.json();

    // If n8n returns a response to post as a comment
    if (responseData.resposta) {
      try {
        if (data.type === "post") {
          // Reply to post
          await reddit.getSubmission(data.id).reply(responseData.resposta);
          console.log(`Replied to post ${data.id}`);
        } else if (data.type === "comment") {
          // Reply to comment
          await reddit.getComment(data.id).reply(responseData.resposta);
          console.log(`Replied to comment ${data.id}`);
        }
      } catch (replyError) {
        console.error("Error replying to Reddit:", replyError);
      }
    }
  } catch (error) {
    console.error("Error sending to webhook:", error);
  }
}
// Limit the size of processedItems to prevent memory issues
function cleanupProcessedItems() {
  if (processedItems.size > 1000) {
    const itemsArray = Array.from(processedItems);
    const itemsToKeep = itemsArray.slice(itemsArray.length - 500);
    processedItems.clear();
    itemsToKeep.forEach((item) => processedItems.add(item));
  }
}

// Run monitoring at regular intervals
async function startMonitoring() {
  // Initial run
  await monitorPosts();
  await monitorComments();

  // Clean up processed items periodically
  setInterval(cleanupProcessedItems, 3600000); // Every 60 minutes

  // Set up intervals for monitoring
  setInterval(monitorPosts, 3600000); // Every 60 minutes
  setInterval(monitorComments, 300000); // Every 5 minutes

  console.log("Monitoring started...");
}

// Start the monitoring process
startMonitoring().catch((error) => {
  console.error("Error starting monitoring:", error);
});
