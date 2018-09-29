const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require('botbuilder-azure');
const path = require('path');
const ENV_FILE = path.join('./.env');
const env = require('dotenv').config({ path: ENV_FILE });
const util = require('util');
const messages = require('../resources/messages.json');
const SubmitCard  = require('./submit-card');
const KnowledgeBase = require('./knowledge-base');

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata 
});

// Setup Restify Server
const server = restify.createServer();
server.post('/api/messages', connector.listen());

// Initialize bot, also callback for action submits
const bot = new builder.UniversalBot(connector, function (session, args) {
    session.send('#######UNIVERSAL');
    if (session.message && session.message.value && session.message.value.type == "ticket-submit") {
        SubmitCard.handleSubmit(session, session.message.value);
    }
    
    qna.ask(session);
});

// Set azure storage if on production
var tableName = 'botdata';
var azureTableClient = new botbuilder_azure.AzureTableClient(tableName, process.env['AzureWebJobsStorage']);
var tableStorage = new botbuilder_azure.AzureBotStorage({ gzipData: false }, azureTableClient);
if (process.env.BotEnv == 'prod') bot.set('storage', tableStorage);

// Setup luis
const LuisModelUrl = process.env.LuisAPIHostName + '/luis/v2.0/apps/' + process.env.LuisAppId + '?subscription-key=' + process.env.LuisAPIKey;
var recognizer = new builder.LuisRecognizer(LuisModelUrl);
bot.recognizer(recognizer);

// Setup QnA
const qna = new KnowledgeBase();

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

bot.dialog('Helpful', [
    // Ask if helpi was helpful
    function (session) {
        builder.Prompts.text(session, messages.helpful.question);
    },
    // Handle response
    function (session, results) {
        switch (yesOrNo(results.response)) {
            case 'yes':
                session.endDialog(messages.helpful.yes);
                break;
            case 'no':
                session.replaceDialog('Retry');
                break;
            default:      
                session.endDialog(messages.invalid_input);
                session.beginDialog('Helpful');
                break;
        }
    }
]);

bot.dialog('Retry', [
    // Ask to retry the question
    function (session, args) {
        if (!session.userData.retryCounter) session.userData.retryCounter = 0;

        if (session.userData.retryCounter >= 3) {
            session.userData.retryCounter = 0;
            session.replaceDialog('CreateTicket', { quit: true });
        } else {
            session.userData.retryCounter++;

            var msg = messages.retry.question;
            if (args && args.noAnswer) {
                msg = messages.retry.nothing_found + '\n' + msg;
            }
            builder.Prompts.text(session, msg);
        }
    },
    // Handle response
    function (session, results) {
        switch (yesOrNo(results.response)) {
            case 'yes':
                session.endDialog(messages.retry.yes);
                break;
            case 'no':
                session.replaceDialog('CreateTicket');
                break;
            default:
                session.endDialog(messages.invalid_input);
                session.beginDialog('Retry');
                break;
        }
    }
]);

bot.dialog('CreateTicket', [
    // Ask if ticket should be created
    function (session, args) {
        if (args && args.quit) {
            builder.Prompts.text(session, messages.ticket.quit_question);
        } else {
            builder.Prompts.text(session, messages.ticket.question);
        }
    },
    // Handle response
    function (session, results) {
        switch (yesOrNo(results.response)) {
            case 'yes':
                const card = new SubmitCard(session);
                card.send(session);
                session.endDialog();
                break;
            case 'no':
                session.endDialog(messages.ticket.no);
                break;
            default:
                session.endDialog(messages.invalid_input);
                session.beginDialog('CreateTicket');
                break;
        }
    }
]);

bot.dialog('initialize', function (session) {
    session.userData.retryCounter = 0;
    session.endDialog();
});

// Welcome Message
bot.on('conversationUpdate', function (message) {
    if (message.membersAdded) {
        message.membersAdded.forEach(function (identity) {
            if (identity.id === message.address.bot.id) {
                bot.beginDialog(message.address, 'initialize');

                const currentDate = new Date();
                let greeting = 'Hallo';
                if (currentDate.getHours() < 10) {
                    greeting = 'Guten Morgen';
                } else if (currentDate.getHours() < 17) {
                    greeting = 'Guten Tag';
                } else {
                    greeting = 'Guten Abend';
                }

                bot.send(new builder.Message()
                    .address(message.address)
                    .text(util.format(messages.welcome, greeting)));
            }
        });
    }
});

bot.dialog('HelpDialog',
    (session) => {
        session.send(messages.welcome);
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
        session.send(messages.ticket.deny);
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