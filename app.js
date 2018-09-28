/*-----------------------------------------------------------------------------
A simple Language Understanding (LUIS) bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require('botbuilder-azure');
const builder_cognitiveservices = require('botbuilder-cognitiveservices');
const path = require('path');
const nodemailer = require('nodemailer');
const ENV_FILE = path.join('./.env');
const env = require('dotenv').config({ path: ENV_FILE });
const submitCard = require('./resources/cards/submit.json');
const SubmitCardBlacklist  = require('./submit-card-blacklist');
const KnowledgeBase = require('./knowledge-base');

//instatiate Knowledgebase
const qna = new KnowledgeBase();

// Setup luis url
const LuisModelUrl = process.env.LuisAPIHostName + '/luis/v2.0/apps/' + process.env.LuisAppId + '?subscription-key=' + process.env.LuisAPIKey;

// Setup email
const transporter = nodemailer.createTransport({
    host: process.env.SMTPHost,
    port: process.env.SMTPPort,
    secure: JSON.parse(process.env.SMTPSSL) || false,
    auth: {
        user: process.env.SMTPUser,
        pass: process.env.SMTPPass
    }
});



// Setup azure storage
var tableName = 'botdata';
var azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
var tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);

// Setup Restify Server
var server = restify.createServer();

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata 
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

// Generate unique id helper function
const uniqueId = () => {
    return Math.random().toString(36).substr(2, 16);
}

// Recognizer and and Dialog for GA QnAMaker service
var qnaRecognizer = new builder_cognitiveservices.QnAMakerRecognizer({
    knowledgeBaseId: process.env.QnaKnowledgebaseId,
    authKey: process.env.QnaAuthKey, // Backward compatibility with QnAMaker (Preview)
    endpointHostName: process.env.EndpointHostName,
    defaultMessage: "Computer sagt Nein",
    top: 3,
    qnaThreshold: 0.2
});

const sendAdaptiveCard = session => {
    submitCard.actions[0].data.id = uniqueId();
    submitCard.fallbackText = 'Ich hab dazu leider nichts gefunden.'
        + '\nDu kannst aber unseren Support unter ' + process.env.Email + ' kontaktieren.';
    submitCard.body[2].value = session.message.text;

    const message = new builder.Message(session);
    message.addAttachment({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: submitCard
    });
    session.send(message);
}


// Create your bot with a function to receive messages from the user
// This default message handler is invoked if the user's utterance doesn't
// match any intents handled by other dialogs.
const bot = new builder.UniversalBot(connector, function (session, args) {
    console.log('###UNIVERSALBOT')
    if (session.message && session.message.value && session.message.value.type == "ticket-submit") {
        const data = session.message.value;

        // Check if card is blacklisted
        SubmitCardBlacklist.contains(data.id, function (blacklisted) {
            console.log(blacklisted);
            if (blacklisted) {
                session.send('Der Support wurde bereits kontaktiert.');
            } else {
                // Create submit ticket
                const mailText = 'Name: ' + data.name + ' \nFiliale: ' + data.office + '\n\n' + data.message;
                const mailOptions = {
                    from: 'helpi@ullapopken.de',
                    to: process.env.Email,
                    subject: 'Helpi',
                    text: mailText
                };
                transporter.sendMail(mailOptions, function (error, info) {
                    if (error) {
                        console.log(error);
                    } else {
                        session.send('Vielen Dank :) Dein Anliegen wurde weiter gegeben.');

                        // Blacklist current card
                        SubmitCardBlacklist.add(data.id);
                    }
                });
            }
        });
    }
    
    requestQnAKB(session);
});

//Storage nur setzen wenn es online ist (damit es lokal testbar ist)
if (process.env.BotEnv == 'prod') bot.set('storage', tableStorage);

bot.dialog('/qna', function (session) {
    
});

const yesOrNo = string => {
    var answer = string.toLowerCase().trim();
    if ((answer.startsWith('j') || answer.startsWith('y')) && answer.length < 5) {
        return 'yes';
    }
    else if (answer.startsWith('n') && answer.length < 7) {
        return 'no';
    }
    else {
        return null;
    }
}

const askToCreateTicket = (session, results) => {
    switch (yesOrNo(results.response)) {
        case 'yes':
            session.endDialog('Ok. Versuchen wir es nochmal.');
            break;
        case 'no':
            builder.Prompts.text(session, 'Soll ich für dich ein Ticket aufgeben?');
            break;
        default:
            session.replaceDialog('NoneDialog');
            break;
    }
}
const ticketResponse = (session, results) => {
    switch (yesOrNo(results.response)) {
        case 'yes':
            sendAdaptiveCard(session);
            session.endDialog();
            break;
        case 'no':
            session.endDialog('Ok.');
            break;
        default:
            session.replaceDialog('NoneDialog');
            break;
    }
}


bot.dialog('/noAnswer',[
    function(session){
        builder.Prompts.text(session, 'Leider wurde keine Antwort gefunden.\nMöchtest du die Frage neu formulieren?');
    },
    askToCreateTicket,
    ticketResponse
]);
bot.dialog('/helpful', [
    // Ask if helpi was helpful
    function (session,args,next) {
        if(args && args.noAnswer == true){
            next({response:"no"});
        }
        else{
            builder.Prompts.text(session, 'Konnte ich dir damit weiter helfen?');
        }
    },
    // Ask to retry the question
    function (session, results,args) {

        switch (yesOrNo(results.response)) {
            case 'yes':
                session.endDialog('Geil.');
                break;
            case 'no':
                builder.Prompts.text(session, 'Möchtest du die Frage neu formulieren?');
                break;
            default:
                session.replaceDialog('NoneDialog');
                break;
        }
       
    },
    // Ask to create ticket
    askToCreateTicket,
    // Handle last question
    ticketResponse
]);

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
                    .text('Hallo, ich bin Helpi.\nIch kann dir bei IT-Problemen helfen.\nBeschreibe dein Problem bitte in einem Satz, wie z.B. „Der Drucker druckt nicht“, oder „Kasse startet nicht“\n'));
            }
        });
    }
});

// Create a recognizer that gets intents from LUIS, and add it to the bot
var recognizer = new builder.LuisRecognizer(LuisModelUrl);
bot.recognizer(recognizer);

// Recognizer and and Dialog for preview QnAMaker service
var previewRecognizer = new builder_cognitiveservices.QnAMakerRecognizer({
    knowledgeBaseId: process.env.QnaKnowledgebaseId,
    authKey: process.env.QnaAuthKey
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

bot.dialog('HelpDialog',
    (session) => {
        session.send('Hallo, ich bin Helpi.\nIch kann dir bei IT-Problemen helfen.\nBeschreibe dein Problem bitte in einem Satz, wie z.B. „Der Drucker druckt nicht“, oder „Kasse startet nicht“\n');
        session.endDialog();
    }
).triggerAction({
    matches: 'Help'
})

bot.dialog('NoneDialog',
    (session) => {
        qna.ask(session);
        session.endDialog();
    }
).triggerAction({
    matches: 'None'
})

bot.dialog('TicketDialog',
    (session) => {
        session.send('versuche zunächst eine frage zu stellen :)');
        session.endDialog();
        //start QnA
    }
).triggerAction({
    matches: 'Ticket'
})

// When everything is ready, start server
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log('%s listening to %s', server.name, server.url); 
 });