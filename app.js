/*-----------------------------------------------------------------------------
A simple Language Understanding (LUIS) bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require("botbuilder-azure");
const builder_cognitiveservices = require("botbuilder-cognitiveservices");
const path = require('path');
const ENV_FILE = path.join('./.env');
//const env = require('dotenv').config({ path: ENV_FILE });
const AdaptiveCards = require('adaptivecards');
const submitCard = require('./resources/adaptive_cards/submit.json');

const env = {
    LuisAppId: "336d8dfd-cee1-4192-965a-299323254dc1",
LuisAPIKey: "94fa6ec955cd4324a78f0c3a55d756d4",
LuisAPIHostName: "https://westeurope.api.cognitive.microsoft.com",
QnaKnowledgebaseId: "9765b391-08ba-4d46-8c75-4d8393ef768a",
QnaAuthKey: "10d00ba7-5606-4ff5-bc4f-5c7f663f0e25",
EndpointHostName: "https://helpidatabase.azurewebsites.net/qnamaker"
}

// Setup Restify Server
var server = restify.createServer();
server.listen(env.port || env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: env.MicrosoftAppId,
    appPassword: env.MicrosoftAppPassword,
    openIdMetadata: env.BotOpenIdMetadata 
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

// Recognizer and and Dialog for GA QnAMaker service
var qnaRecognizer = new builder_cognitiveservices.QnAMakerRecognizer({
    knowledgeBaseId: env.QnaKnowledgebaseId,
    authKey: env.QnaAuthKey, // Backward compatibility with QnAMaker (Preview)
    endpointHostName: env.EndpointHostName,
    defaultMessage: "Computer sagt Nein",
    top: 3,
    qnaThreshold: 0.2
});

const sendAdaptiveCard = (session, cardJSON) => {
    const message = new builder.Message(session);
    message.addAttachment({
        contentType: "application/vnd.microsoft.card.adaptive",
        content: cardJSON
    });
    session.send(message);
}

const requestQnAMaker = session => {
    qnaRecognizer.recognize(session, (error, results) => {
        console.log(results.answers);
        if (results && results.answers[0] && results.answers[0].score > 0.2) {
            session.send(results.answers[0].answer);
            return;
        }
        
        if (error) console.log(error);
        
        submitCard.body[2].value = session.message.text;
        sendAdaptiveCard(session, submitCard);
        session.endDialog();
    });
}

// Create your bot with a function to receive messages from the user
// This default message handler is invoked if the user's utterance doesn't
// match any intents handled by other dialogs.
var bot = new builder.UniversalBot(connector, function (session, args) {
    console.log("DEFAULTx123");
    
    requestQnAMaker(session);
});

bot.on('Error', function (message) {
    console.log("ERRORx123");
});

// Welcome Message
bot.on('conversationUpdate', function (message) {
    if (message.membersAdded) {
        message.membersAdded.forEach(function (identity) {
            if (identity.id === message.address.bot.id) {
                bot.send(new builder.Message()
                    .address(message.address)
                    .text("Hallo, ich bin Helpi.\nIch kann dir bei IT-Problemen helfen.\nBeschreibe dein Problem bitte in einem Satz, wie z.B. „Der Drucker druckt nicht“, oder „Kasse startet nicht“\n" + env.LuisAppId));
            }
        });
    }
});

// Make sure you add code to validate these fields
const LuisModelUrl = env.LuisAPIHostName + '/luis/v2.0/apps/' + env.LuisAppId + '?subscription-key=' + env.LuisAPIKey;

// Create a recognizer that gets intents from LUIS, and add it to the bot
var recognizer = new builder.LuisRecognizer(LuisModelUrl);
bot.recognizer(recognizer);

// Recognizer and and Dialog for preview QnAMaker service
var previewRecognizer = new builder_cognitiveservices.QnAMakerRecognizer({
    knowledgeBaseId: env.QnaKnowledgebaseId,
    authKey: env.QnaAuthKey
});

var basicQnAMakerPreviewDialog = new builder_cognitiveservices.QnAMakerDialog({
    recognizers: [previewRecognizer],
    defaultMessage: 'No match! Try changing the query terms! debug1245',
    qnaThreshold: 0.2
});

bot.dialog('basicQnAMakerPreviewDialog', basicQnAMakerPreviewDialog);

var basicQnAMakerDialog = new builder_cognitiveservices.QnAMakerDialog({
    recognizers: [qnaRecognizer],
    defaultMessage: 'No match! Try changing the query terms!',
    qnaThreshold: 0.5
});

bot.dialog('basicQnAMakerDialog', basicQnAMakerDialog);

// Add a dialog for each intent that the LUIS app recognizes.
// See https://docs.microsoft.com/en-us/bot-framework/nodejs/bot-builder-nodejs-recognize-intent-luis 
bot.dialog('AntwortDialog',
    (session) => {
        session.send('You reached the Antwort intent. You said \'%s\'.', session.message.text);
    }
).triggerAction({
    matches: 'Antwort'
})

bot.dialog('ErrorDialog',
    (session) => {
        session.send('You reached the Error intent. You said \'%s\'.', session.message.text);
        requestQnAMaker(session);
        session.endDialog();
    }
).triggerAction({
    matches: 'Error'
})

bot.dialog('HelpDialog',
    (session) => {
        session.send('You reached the Help intent. You said \'%s\'.', session.message.text);
        session.endDialog();
    }
).triggerAction({
    matches: 'Help'
})

bot.dialog('NoneDialog',
    (session) => {
        session.send('You reached the None intent. You said \'%s\'.', session.message.text);
        requestQnAMaker(session);
        session.endDialog();
        //start QnA
    }
).triggerAction({
    matches: 'None'
})

bot.dialog('TicketDialog',
    (session) => {
        session.send('You reached the Ticket intent. You said \'%s\'.', session.message.text);
        session.endDialog();
        //start QnA
    }
).triggerAction({
    matches: 'Ticket'
})

