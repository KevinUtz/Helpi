/*-----------------------------------------------------------------------------
A simple Language Understanding (LUIS) bot for the Microsoft Bot Framework. 
-----------------------------------------------------------------------------*/

const restify = require('restify');
const builder = require('botbuilder');
const botbuilder_azure = require('botbuilder-azure');
const path = require('path');
const ENV_FILE = path.join('./.env');
const env = require('dotenv').config({ path: ENV_FILE });
const nodemailer = require('nodemailer');
const util = require('util');
const submitCard = require('./resources/cards/submit.json');
const messages = require('./resources/messages.json');
const SubmitCardBlacklist  = require('./submit-card-blacklist');
const KnowledgeBase = require('./knowledge-base');

//instatiate Knowledgebase
const qna = new KnowledgeBase();

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
    if (session.message && session.message.value && session.message.value.type == "ticket-submit") {
        handleTicketSubmit(session.message.value);
    }
    requestQnAKB(session);
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

const handleTicketSubmit = data => {
    // Check if card is blacklisted
    SubmitCardBlacklist.contains(data.id, function (blacklisted) {
        if (blacklisted) {
            session.send(messages.ticket.already_sent);
        } else {
            // Create submit ticket
            const mailOptions = {
                from: process.env.EmailSender,
                to: process.env.EmailRecipient,
                subject: messages.ticket.mail.subject,
                text: util.format(messages.ticket.mail.body, data.name, data.office, data.message)
            };
            transporter.sendMail(mailOptions, function (error, info) {
                if (error) {
                    console.log(error);
                } else {
                    session.send(messages.ticket.thank_you);

                    // Blacklist current card
                    SubmitCardBlacklist.add(data.id);
                }
            });
        }
    });
}

const sendSubmitCard = session => {
    submitCard.actions[0].data.id = Math.random().toString(36).substr(2, 16); // generate unique id
    submitCard.fallbackText = util.format(messages.ticket.submit_card.fallbackText, process.env.ToEmail);
    submitCard.body[0].value = messages.ticket.submit_card.subject;
    submitCard.body[1].value = messages.ticket.submit_card.text;
    submitCard.body[3].value = session.message.text;

    const message = new builder.Message(session);
    message.addAttachment({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: submitCard
    });
    session.send(message);
}

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
            session.endDialog(messages.retry.yes);
            break;
        case 'no':
            builder.Prompts.text(session, messages.ticket.question);
            break;
        default:
            session.replaceDialog('NoneDialog');
            break;
    }
}
const ticketResponse = (session, results) => {
    switch (yesOrNo(results.response)) {
        case 'yes':
            sendSubmitCard(session);
            session.endDialog();
            break;
        case 'no':
            session.endDialog(messages.ticket.no);
            break;
        default:
            session.replaceDialog('NoneDialog');
            break;
    }
}


bot.dialog('/noAnswer',[
    function(session){
        builder.Prompts.text(session, messages.retry.question);
    },
    askToCreateTicket,
    ticketResponse
]);

bot.dialog('/helpful', [
    // Ask if helpi was helpful
    function (session) {
        builder.Prompts.text(session, messages.helpful.question);
    },
    // Ask to retry the question
    function (session, results) {

        switch (yesOrNo(results.response)) {
            case 'yes':
                session.endDialog(messages.helpful.yes);
                break;
            case 'no':
                builder.Prompts.text(session, messages.retry.question);
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
                    .text(messages.welcome));
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